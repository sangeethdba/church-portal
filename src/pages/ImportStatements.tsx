import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOutletContext } from "react-router-dom";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Trash2,
  CheckCircle2,
  Circle,
  XCircle,
  Banknote,
  Receipt,
  Loader2,
  ArrowDownUp,
  AlertTriangle,
  Download,
  Shield,
  CheckCheck,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { Button, Card, CardBody, CardHeader, Badge, EmptyState, Select, Input, toast } from "@/components/ui";
import { supabase, isAdminRole, type Profile, type Donor, type DonationKind, type ExpenseCategory, EXPENSE_CATEGORIES } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

type TxDirection = "expense" | "donation";

interface ParsedTransaction {
  id: string;                     // temp client-side id
  date: string;                   // YYYY-MM-DD
  description: string;
  amount: number;                  // positive number
  direction: TxDirection;
  category: string;               // expense_category or donation_kind
  donorId: string | null;         // donor UUID — only for donation rows
  paymentMethod: string;
  checkNumber: string;
  raw: string;                    // original line for debugging
  approved: boolean;              // user has reviewed and approved this row for import
}

const DONATION_TYPES: { value: DonationKind; label: string }[] = [
  { value: "tithe", label: "Tithe" },
  { value: "offering", label: "Offering" },
  { value: "building", label: "Building" },
  { value: "missions", label: "Missions" },
  { value: "other", label: "Other" },
];

const PAYMENT_METHODS = ["online", "card", "check", "cash"];

// ── Bank statement type detection ─────────────────────────────────────

interface BankFormat {
  name: string;
  dateCol: number;
  descCol: number;
  amtCol: number;     // signed amount column; -1 means unknown
  balanceCol: number;  // running-balance column to skip; -1 means absent
}

/** Detect the bank CSV format from the header row.
 *  Returns column indices for the standard BofA layout:
 *    Date (0), Description (1), Amount (2), Running Bal. (3)
 *  Also handles Chase, Wells Fargo, and generic CSV formats. */
function detectBankFormat(header: string): BankFormat {
  const h = header.toLowerCase();
  const cols = header.split(",").map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ""));

  // Bank of America: "Date, Description, Amount, Running Bal."
  if (h.includes("running bal") || h.includes("running balance")) {
    const dateI = cols.findIndex((c) => c === "date");
    const descI = cols.findIndex((c) => c === "description");
    const amtI = cols.findIndex((c) => c === "amount");
    const balI = cols.findIndex((c) => c.includes("running"));
    return {
      name: "Bank of America",
      dateCol: dateI >= 0 ? dateI : 0,
      descCol: descI >= 0 ? descI : 1,
      amtCol: amtI >= 0 ? amtI : 2,
      balanceCol: balI >= 0 ? balI : (cols.length > 3 ? 3 : -1),
    };
  }

  // Chase: "Transaction Date, Post Date, Description, Category, Type, Amount, Memo"
  if (h.includes("transaction date") || h.includes("post date")) {
    const dateI = cols.findIndex((c) => c.includes("date"));
    const descI = cols.findIndex((c) => c === "description");
    const amtI = cols.findIndex((c) => c === "amount");
    return {
      name: "Chase",
      dateCol: dateI >= 0 ? dateI : 0,
      descCol: descI >= 0 ? descI : 2,
      amtCol: amtI >= 0 ? amtI : 5,
      balanceCol: -1,
    };
  }

  // Wells Fargo: "Date, Amount, Star, Blank, Description" (sometimes reversed)
  if (h.includes("star") || h.includes("wells")) {
    const dateI = cols.findIndex((c) => c === "date");
    const descI = cols.findIndex((c) => c === "description");
    const amtI = cols.findIndex((c) => c === "amount");
    return {
      name: "Wells Fargo",
      dateCol: dateI >= 0 ? dateI : 0,
      descCol: descI >= 0 ? descI : (cols.length - 1),
      amtCol: amtI >= 0 ? amtI : 1,
      balanceCol: -1,
    };
  }

  // Generic detection: look for date/amount/description keywords
  const dateI = cols.findIndex((c) => /date|posted|trans/.test(c));
  const descI = cols.findIndex((c) => /desc|memo|payee|narration|name/.test(c));
  const amtI = cols.findIndex((c) => /amount|sum|value/.test(c));
  const balI = cols.findIndex((c) => /bal|running/.test(c));

  return {
    name: "Generic CSV",
    dateCol: dateI >= 0 ? dateI : 0,
    descCol: descI >= 0 ? descI : 1,
    amtCol: amtI >= 0 ? amtI : 2,
    balanceCol: balI >= 0 ? balI : -1,
  };
}

/** Parse a MM/DD/YYYY or DD/MM/YYYY date string into YYYY-MM-DD. */
function normalizeDate(raw: string): string {
  const m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return new Date().toISOString().slice(0, 10);

  const a = parseInt(m[1]), b = parseInt(m[2]);
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];

  // BofA uses MM/DD/YYYY — month ≤ 12 always
  // If a > 12 it's DD/MM/YYYY, otherwise assume MM/DD/YYYY
  const [mm, dd] = a > 12 ? [String(b).padStart(2, "0"), String(a).padStart(2, "0")]
                           : [String(a).padStart(2, "0"), String(b).padStart(2, "0")];
  return `${yy}-${mm}-${dd}`;
}

// ── CSV / PDF parsers ──────────────────────────────────────────────────

/** Parse CSV text into transaction rows.
 *  Supports Bank of America (Date,Description,Amount,Running Bal.),
 *  Chase, Wells Fargo, and generic CSV formats.
 *  Auto-detects expense vs donation from the sign of the Amount column. */
function parseCSV(text: string): Omit<ParsedTransaction, "id" | "direction" | "category" | "donorId" | "paymentMethod" | "checkNumber" | "approved">[] {
  let lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // ── Step 1: Skip BofA-style summary / metadata rows ────────────────
  // BofA CSVs sometimes prepend account summary lines like:
  //   "Account number: XXXX1234", "Statement period: ...", "Beginning balance: ..."
  // Find the actual header row and skip everything before it.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const l = lines[i].toLowerCase();
    // Match BofA header: "Date, Description, Amount, Running Bal." or similar
    if (/date.*(?:desc|memo|narration|payee)/.test(l) ||
        /(?:desc|memo|narration).*amount/.test(l) ||
        /date.*amount.*(?:bal|running)/.test(l) ||
        /date.*description.*amount/.test(l)) {
      headerIdx = i;
      break;
    }
  }

  // If we found a header, use it; otherwise assume the first line is the header
  const headerLine = lines[headerIdx];
  const hasHeader = /date|posted|transaction|amount|description|debit|credit/.test(headerLine.toLowerCase());
  const dataLines = hasHeader ? lines.slice(headerIdx + 1) : lines;

  if (dataLines.length === 0) return [];

  // ── Step 2: Detect bank format ──────────────────────────────────────
  const delim = headerLine.includes("\t") ? "\t" : ",";
  const fmt: BankFormat = hasHeader
    ? detectBankFormat(headerLine)
    : { name: "No header", dateCol: 0, descCol: 1, amtCol: 2, balanceCol: 3 };

  // ── Step 3: Parse each data line using column indices ───────────────
  const results: Omit<ParsedTransaction, "id" | "direction" | "category" | "donorId" | "paymentMethod" | "checkNumber" | "approved">[] = [];

  for (const line of dataLines) {
    const cols = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));

    // Need at least enough columns for date + amount
    if (cols.length <= fmt.amtCol) continue;

    // Parse amount (signed — negative = debit/expense, positive = credit/donation)
    const rawAmt = cols[fmt.amtCol].replace(/[$,]/g, "");
    // Handle parentheses negative notation: (123.45) = -123.45
    const isNegative = rawAmt.startsWith("(") || rawAmt.startsWith("-");
    const parsedAmt = Math.abs(parseFloat(rawAmt.replace(/[()\-]/g, "")));
    if (isNaN(parsedAmt) || parsedAmt === 0) continue;

    // Parse date
    const date = normalizeDate(cols[fmt.dateCol]);

    // Parse description — skip amount and balance columns
    const descParts: string[] = [];
    for (let i = 0; i < cols.length; i++) {
      if (i === fmt.dateCol) continue;
      if (i === fmt.amtCol) continue;
      if (i === fmt.balanceCol) continue;
      if (cols[i]) descParts.push(cols[i]);
    }
    const description = descParts.join(" ") || "Unknown transaction";

    results.push({
      date,
      description: description.length > 200 ? description.slice(0, 200) : description,
      amount: parsedAmt,
      raw: line,
      // Pass sign info for auto-detecting direction
      _isNegative: isNegative,
    } as any);
  }

  return results;
}

/** Parse PDF text via pdfjs-dist and try to extract tabular transaction data. */
async function parsePDF(file: File): Promise<Omit<ParsedTransaction, "id" | "direction" | "category" | "donorId" | "paymentMethod" | "checkNumber" | "approved">[]> {
  // Dynamic import to avoid bundling pdfjs for users who only use CSV
  const pdfjsLib = await import("pdfjs-dist");
  // Use the bundled worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;

  const lines: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(" ");
    lines.push(...pageText.split(/\n/).filter((l) => l.trim()));
  }

  // Try to find transaction rows — lines containing dates and amounts
  const txLines = lines.filter((l) =>
    /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(l) &&
    /\d[\d,]*\.?\d*/.test(l)
  );

  if (txLines.length === 0) {
    // Fallback: return all non-empty lines as potential descriptions
    // with the user manually entering amounts
    return lines
      .filter((l) => l.trim().length > 5)
      .map((l) => ({
        date: new Date().toISOString().slice(0, 10),
        description: l.trim().slice(0, 120),
        amount: 0,
        raw: l.trim(),
      }));
  }

  // Parse each line to extract date, description, amount
  const results: Omit<ParsedTransaction, "id" | "direction" | "category" | "donorId" | "paymentMethod" | "checkNumber" | "approved">[] = [];
  for (const line of txLines) {
    const dateM = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    const dateStr = dateM ? dateM[1] : "";
    let date = "";
    const m = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      date = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    } else {
      date = new Date().toISOString().slice(0, 10);
    }

    // Remove the date from the line to get description
    let desc = line.replace(dateStr, "").trim();

    // Extract amount(s) — last number in the line is usually the amount
    const amounts = desc.match(/-?\$?[\d,]+\.?\d*/g);
    let amt = 0;
    if (amounts) {
      const lastAmt = amounts[amounts.length - 1].replace(/[$,]/g, "");
      const isNeg = lastAmt.startsWith("-");
      amt = Math.abs(parseFloat(lastAmt.replace("-", "")) || 0);
      // Remove amount from description
      desc = desc.replace(amounts[amounts.length - 1], "").trim();
    }

    results.push({ date, description: desc.slice(0, 200) || "Unknown", amount: amt, raw: line });
  }

  return results;
}

// ── Component ──────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `tx-${Date.now()}-${++idCounter}`;
}

export default function ImportStatements() {
  const ctx = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const isAdmin = isAdminRole(ctx.profile?.role);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileMode, setFileMode] = useState<"csv" | "pdf">("csv");

  // ── Fetch donors for donation-row attribution ──────────────────────

  useEffect(() => {
    if (!supabase || !isAdmin) return;
    supabase
      .from("donors")
      .select("id, first_name, last_name")
      .order("last_name")
      .then(({ data }) => {
        if (data) setDonors(data as Donor[]);
      });
  }, [isAdmin]);

  // ── File handling ──────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setParseError(null);
    setParsing(true);
    setImportResult(null);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let raw: Omit<ParsedTransaction, "id" | "direction" | "category" | "donorId" | "paymentMethod" | "checkNumber" | "approved">[];

      if (ext === "csv" || ext === "txt") {
        const text = await file.text();
        raw = parseCSV(text);
        setFileMode("csv");
      } else if (ext === "pdf") {
        raw = await parsePDF(file);
        setFileMode("pdf");
      } else {
        setParseError(`Unsupported file type: .${ext}. Please use CSV or PDF.`);
        setParsing(false);
        return;
      }

      if (raw.length === 0) {
        setParseError("No transactions found in the file. Check the format and try again.");
        setParsing(false);
        return;
      }

      // Convert raw to ParsedTransaction — auto-detect direction from sign
      // BofA CSV: negative = debit/expense, positive = credit/donation
      const parsed: ParsedTransaction[] = raw.map((r: any) => {
        const isDebit = r._isNegative === true;
        const dir: TxDirection = isDebit ? "expense" : "donation";
        return {
          id: nextId(),
          date: r.date,
          description: r.description,
          amount: r.amount || 0,
          direction: dir,
          category: dir === "expense" ? "other" : "offering",
          donorId: null,           // user picks donor for donation rows
          paymentMethod: "online",
          checkNumber: "",
          raw: r.raw,
          approved: true,           // all parsed rows start approved
        };
      });

      setTransactions(parsed);
      toast(`${parsed.length} transactions parsed`, "success");
    } catch (e: any) {
      setParseError(e?.message || "Failed to parse file");
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [processFile],
  );

  // ── Transaction editing ────────────────────────────────────────────

  function updateTx(id: string, patch: Partial<ParsedTransaction>) {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function removeTx(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  function toggleDirection(id: string) {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const newDir: TxDirection = t.direction === "expense" ? "donation" : "expense";
        return {
          ...t,
          direction: newDir,
          category: newDir === "expense" ? "other" : "offering",
        };
      }),
    );
  }

  function setAllDirection(dir: TxDirection) {
    setTransactions((prev) =>
      prev.map((t) => ({
        ...t,
        direction: dir,
        category: dir === "expense" ? t.category : "offering",
      })),
    );
  }

  function toggleApproved(id: string) {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, approved: !t.approved } : t)));
  }

  function setAllApproved(val: boolean) {
    setTransactions((prev) => prev.map((t) => ({ ...t, approved: val })));
  }

  function removeSkipped() {
    setTransactions((prev) => prev.filter((t) => t.approved));
  }

  // ── Import ─────────────────────────────────────────────────────────

  async function handleImport() {
    if (approved.length === 0) return;
    setImporting(true);
    setImportResult(null);

    try {
      const payload = approved.map((t) => ({
        type: t.direction,
        amount: t.amount,
        description: t.description,
        date: t.date,
        category: t.category,
        donor_id: t.donorId || null,
        payment_method: t.paymentMethod,
        check_number: t.checkNumber || null,
      }));

      const { error } = await supabase.rpc("batch_import_transactions", {
        p_transactions: payload,
      });

      if (error) throw error;

      const count = approved.length;
      setImportResult({ imported: count, errors: 0 });
      // Only remove approved rows — skipped rows stay for further review
      setTransactions((prev) => prev.filter((t) => !t.approved));
      toast(`${count} transaction${count !== 1 ? "s" : ""} imported successfully!`, "success");
    } catch (e: any) {
      setImportResult({ imported: 0, errors: approved.length });
      toast(e?.message || "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  // ── Totals (approved rows only) ───────────────────────────────────

  const approved = transactions.filter((t) => t.approved);
  const skippedCount = transactions.length - approved.length;

  const expenseTotal = approved
    .filter((t) => t.direction === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const donationTotal = approved
    .filter((t) => t.direction === "donation")
    .reduce((s, t) => s + t.amount, 0);

  // ── Guard ───────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={<Shield className="h-12 w-12" />}
          title="Admin access required"
          description="Only administrators can import bank statements."
        />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import statements"
        subtitle="Upload a CSV bank statement or PDF to batch-import expenses and donations. Review each transaction before saving."
        badge={transactions.length > 0 ? `${transactions.length} parsed` : undefined}
      />

      {/* Upload zone */}
      {transactions.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card
            className={`cursor-pointer transition-all duration-200 ${
              dragOver ? "border-[#C67B5C] bg-[#FDF2E9] shadow-lg" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <CardBody className="flex flex-col items-center justify-center py-16 text-center">
              {parsing ? (
                <>
                  <Loader2 className="mb-4 h-12 w-12 animate-spin text-[#C67B5C]" />
                  <h3 className="font-serif text-xl font-semibold text-[#3C2A1E]">Parsing file…</h3>
                  <p className="mt-2 text-sm text-[#78716C]">Extracting transactions from your statement</p>
                </>
              ) : (
                <>
                  <div className="mb-4 rounded-2xl bg-[#FDF2E9] p-4">
                    <Upload className="h-10 w-10 text-[#C67B5C]" />
                  </div>
                  <h3 className="font-serif text-xl font-semibold text-[#3C2A1E]">Drop your bank statement here</h3>
                  <p className="mt-2 text-sm text-[#78716C]">
                    Export your bank statement as CSV, then drop it here. <br />
                    Works with Bank of America, Chase, Wells Fargo, and more.
                  </p>
                  <div className="mt-6 flex gap-3">
                    <Badge tone="neutral" className="text-xs">
                      <FileSpreadsheet className="mr-1 h-3 w-3" />
                      Bank of America
                    </Badge>
                    <Badge tone="neutral" className="text-xs">
                      <FileSpreadsheet className="mr-1 h-3 w-3" />
                      Chase
                    </Badge>
                    <Badge tone="neutral" className="text-xs">
                      <FileText className="mr-1 h-3 w-3" />
                      PDF fallback
                    </Badge>
                  </div>
                  {parseError && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {parseError}
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
        </motion.div>
      )}

      {/* Transaction review table */}
      <AnimatePresence>
        {transactions.length > 0 && (
          <>
            {/* Summary bar */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#EDE4D8] bg-white px-4 py-3"
            >
              <span className="text-sm font-medium text-[#3C2A1E]">Set all:</span>
              <Button variant="outline" size="sm" onClick={() => setAllDirection("expense")}>
                <Receipt className="h-3.5 w-3.5" />
                All expenses
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAllDirection("donation")}>
                <Banknote className="h-3.5 w-3.5" />
                All donations
              </Button>
              <span className="mx-1 text-[#EDE4D8]">|</span>
              <Button variant="outline" size="sm" onClick={() => setAllApproved(true)}>
                <CheckCheck className="h-3.5 w-3.5" />
                Approve all
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAllApproved(false)}>
                <XCircle className="h-3.5 w-3.5" />
                Skip all
              </Button>
              {skippedCount > 0 && (
                <Button variant="ghost" size="sm" onClick={removeSkipped} className="text-[#78716C]">
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove {skippedCount} skipped
                </Button>
              )}
              <div className="ml-auto flex items-center gap-4 text-sm">
                <span className="text-[#78716C]">
                  <span className="font-semibold text-rose-600">{formatCurrency(expenseTotal)}</span> expenses
                </span>
                <span className="text-[#78716C]">
                  <span className="font-semibold text-emerald-600">{formatCurrency(donationTotal)}</span> donations
                </span>
                <span className="text-xs text-[#C4A77D]">
                  {approved.length}/{transactions.length} approved
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTransactions([]);
                    setImportResult(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear all
                </Button>
              </div>
            </motion.div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-[#EDE4D8] bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EDE4D8] bg-[#FDF8F2]">
                    <th className="w-10 px-2 py-2.5 text-center font-medium text-[#78716C]" title="Approve for import">✓</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Description</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[#78716C]">Amount</th>
                    <th className="px-3 py-2.5 text-center font-medium text-[#78716C]">Type</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Category</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Donor</th>
                    <th className="px-3 py-2.5 text-center font-medium text-[#78716C] w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, idx) => (
                    <motion.tr
                      key={tx.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.02, duration: 0.2 }}
                      className={`border-b border-[#F5F0E8] transition ${
                        tx.approved
                          ? "hover:bg-[#FDF2E9]/40"
                          : "bg-stone-50/50 opacity-60 hover:opacity-80"
                      }`}
                    >
                      {/* Approve / skip toggle */}
                      <td className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => toggleApproved(tx.id)}
                          title={tx.approved ? "Click to skip this row" : "Click to approve for import"}
                          className="transition"
                        >
                          {tx.approved ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600 hover:text-emerald-700" />
                          ) : (
                            <Circle className="h-5 w-5 text-[#C4A77D] hover:text-[#78716C]" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="date"
                          value={tx.date}
                          onChange={(e) => updateTx(tx.id, { date: e.target.value })}
                          className="h-8 w-36 text-xs"
                          disabled={!tx.approved}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          value={tx.description}
                          onChange={(e) => updateTx(tx.id, { description: e.target.value })}
                          className="h-8 text-xs"
                          placeholder="Description"
                          disabled={!tx.approved}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={tx.amount || ""}
                          onChange={(e) => updateTx(tx.id, { amount: parseFloat(e.target.value) || 0 })}
                          className="h-8 w-28 text-right text-xs"
                          disabled={!tx.approved}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => toggleDirection(tx.id)}
                          disabled={!tx.approved}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                            tx.direction === "expense"
                              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                              : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          } ${!tx.approved ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <ArrowDownUp className="h-3 w-3" />
                          {tx.direction === "expense" ? "Expense" : "Donation"}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          value={tx.category}
                          onChange={(e) => updateTx(tx.id, { category: e.target.value })}
                          className="h-8 text-xs"
                          disabled={!tx.approved}
                        >
                          {tx.direction === "expense"
                            ? EXPENSE_CATEGORIES.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))
                            : DONATION_TYPES.map((d) => (
                                <option key={d.value} value={d.value}>
                                  {d.label}
                                </option>
                              ))}
                        </Select>
                      </td>
                      {/* Donor selector — donation rows only */}
                      <td className="px-3 py-2.5">
                        {tx.direction === "donation" ? (
                          <Select
                            value={tx.donorId || ""}
                            onChange={(e) => updateTx(tx.id, { donorId: e.target.value || null })}
                            className="h-8 min-w-[160px] text-xs"
                            disabled={!tx.approved}
                          >
                            <option value="">Unlinked (name only)</option>
                            {donors.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.first_name} {d.last_name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-xs text-[#C4A77D]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => removeTx(tx.id)}
                          className="rounded-md p-1 text-[#C4A77D] hover:bg-red-50 hover:text-red-500 transition"
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Import action */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-4 flex items-center justify-between rounded-xl border border-[#EDE4D8] bg-white px-4 py-3"
            >
              <div>
                {importResult && importResult.imported > 0 && (
                  <span className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {importResult.imported} transactions imported
                  </span>
                )}
                {importResult && importResult.errors > 0 && (
                  <span className="flex items-center gap-2 text-sm text-red-700">
                    <XCircle className="h-4 w-4" />
                    {importResult.errors} errors — please review and retry
                  </span>
                )}
              </div>
              <Button
                variant="solid"
                onClick={handleImport}
                disabled={importing || approved.length === 0 || approved.some((t) => t.amount <= 0)}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {importing
                  ? "Importing…"
                  : `Import ${approved.length} approved`}
              </Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Download template link */}
      {transactions.length === 0 && !parsing && (
        <div className="mt-6 text-center">
          <p className="text-xs text-[#C4A77D]">
            Need a template?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const csv = "Date,Description,Amount\n2026-01-15,Church Rent,2500.00\n2026-01-16,Amazon - Supplies,89.99\n2026-01-20,Online Tithe - John Doe,500.00";
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "import-template.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="font-medium text-[#C67B5C] hover:underline"
            >
              Download sample CSV template
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
