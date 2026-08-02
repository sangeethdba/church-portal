import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOutletContext } from "react-router-dom";
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Trash2,
  CheckCircle2,
  XCircle,
  Banknote,
  Receipt,
  Loader2,
  ArrowDownUp,
  AlertTriangle,
  Download,
  Shield,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { Button, Card, CardBody, CardHeader, Badge, EmptyState, Select, Input, toast } from "@/components/ui";
import { supabase, isAdminRole, type Profile, type DonationKind, type ExpenseCategory, EXPENSE_CATEGORIES } from "@/lib/supabase";
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
  paymentMethod: string;
  checkNumber: string;
  raw: string;                    // original line for debugging
}

const DONATION_TYPES: { value: DonationKind; label: string }[] = [
  { value: "tithe", label: "Tithe" },
  { value: "offering", label: "Offering" },
  { value: "building", label: "Building" },
  { value: "missions", label: "Missions" },
  { value: "other", label: "Other" },
];

const PAYMENT_METHODS = ["online", "card", "check", "cash"];

// ── CSV / PDF parsers ──────────────────────────────────────────────────

/** Parse CSV text into transaction rows. Expects: Date,Description,Amount */
function parseCSV(text: string): Omit<ParsedTransaction, "id" | "direction" | "category" | "paymentMethod" | "checkNumber">[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Detect header — skip if first line has "date" in it
  const header = lines[0].toLowerCase();
  const hasHeader = /date|posted|transaction|amount|description|debit|credit/.test(header);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      // Try comma, tab, or pipe delimiters
      const delim = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
      const cols = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));

      if (cols.length < 2) return null;

      // Find columns by position or heuristics
      let dateIdx = 0;
      let descIdx = -1;
      let amtIdx = -1;

      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(c) || /^\d{4}-\d{2}-\d{2}$/.test(c)) {
          dateIdx = i;
        } else if (/^-?\$?[\d,]+\.?\d*$/.test(c.replace(/[()]/g, ""))) {
          // Account for parentheses notation for negative: (123.45) = -123.45
          amtIdx = i;
        } else if (i !== dateIdx && i !== amtIdx && descIdx === -1) {
          descIdx = i;
        }
      }

      if (amtIdx === -1) return null;

      const rawAmount = cols[amtIdx].replace(/[$,]/g, "");
      const isNegative = rawAmount.startsWith("(") || rawAmount.startsWith("-");
      const amt = Math.abs(parseFloat(rawAmount.replace(/[()\-]/g, "")));
      if (isNaN(amt) || amt === 0) return null;

      // Parse date
      let date = "";
      const rawDate = cols[dateIdx];
      const m = rawDate.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m) {
        const mm = m[1].padStart(2, "0");
        const dd = m[2].padStart(2, "0");
        const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
        date = `${yy}-${mm}-${dd}`;
      } else {
        date = new Date().toISOString().slice(0, 10);
      }

      const desc = descIdx >= 0 ? cols[descIdx] : cols.slice(1).filter((_, i) => i !== amtIdx - 1).join(" ");

      return {
        date,
        description: desc || "Unknown transaction",
        amount: amt,
        raw: line,
      };
    })
    .filter(Boolean) as Omit<ParsedTransaction, "id" | "direction" | "category" | "paymentMethod" | "checkNumber">[];
}

/** Parse PDF text via pdfjs-dist and try to extract tabular transaction data. */
async function parsePDF(file: File): Promise<Omit<ParsedTransaction, "id" | "direction" | "category" | "paymentMethod" | "checkNumber">[]> {
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
  const results: Omit<ParsedTransaction, "id" | "direction" | "category" | "paymentMethod" | "checkNumber">[] = [];
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
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: number } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileMode, setFileMode] = useState<"csv" | "pdf">("csv");

  // ── File handling ──────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setParseError(null);
    setParsing(true);
    setImportResult(null);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let raw: Omit<ParsedTransaction, "id" | "direction" | "category" | "paymentMethod" | "checkNumber">[];

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

      // Convert raw to ParsedTransaction with direction guessed from sign
      const parsed: ParsedTransaction[] = raw.map((r) => {
        // Default: debits = expenses, credits = donations for bank statements
        // But we can't always tell from CSV, so default to expense for debits
        const dir: TxDirection = "expense";
        return {
          id: nextId(),
          date: r.date,
          description: r.description,
          amount: r.amount || 0,
          direction: dir,
          category: dir === "expense" ? "other" : "offering",
          paymentMethod: "online",
          checkNumber: "",
          raw: r.raw,
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

  // ── Import ─────────────────────────────────────────────────────────

  async function handleImport() {
    if (transactions.length === 0) return;
    setImporting(true);
    setImportResult(null);

    try {
      const payload = transactions.map((t) => ({
        type: t.direction,
        amount: t.amount,
        description: t.description,
        date: t.date,
        category: t.category,
        payment_method: t.paymentMethod,
        check_number: t.checkNumber || null,
      }));

      const { error } = await supabase.rpc("batch_import_transactions", {
        p_transactions: payload,
      });

      if (error) throw error;

      setImportResult({ imported: transactions.length, errors: 0 });
      setTransactions([]);
      toast(`${transactions.length} transactions imported successfully!`, "success");
    } catch (e: any) {
      setImportResult({ imported: 0, errors: transactions.length });
      toast(e?.message || "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────

  const expenseTotal = transactions
    .filter((t) => t.direction === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const donationTotal = transactions
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
                    CSV files work best — just export from your bank. <br />
                    PDF statements are also supported as a fallback.
                  </p>
                  <div className="mt-6 flex gap-3">
                    <Badge tone="neutral" className="text-xs">
                      <FileSpreadsheet className="mr-1 h-3 w-3" />
                      CSV (recommended)
                    </Badge>
                    <Badge tone="neutral" className="text-xs">
                      <FileText className="mr-1 h-3 w-3" />
                      PDF
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
              <span className="text-sm font-medium text-[#3C2A1E]">Set all as:</span>
              <Button variant="outline" size="sm" onClick={() => setAllDirection("expense")}>
                <Receipt className="h-3.5 w-3.5" />
                All expenses
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAllDirection("donation")}>
                <Banknote className="h-3.5 w-3.5" />
                All donations
              </Button>
              <div className="ml-auto flex items-center gap-4 text-sm">
                <span className="text-[#78716C]">
                  <span className="font-medium text-rose-600">{formatCurrency(expenseTotal)}</span> expenses
                </span>
                <span className="text-[#78716C]">
                  <span className="font-medium text-emerald-600">{formatCurrency(donationTotal)}</span> donations
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
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Description</th>
                    <th className="px-3 py-2.5 text-right font-medium text-[#78716C]">Amount</th>
                    <th className="px-3 py-2.5 text-center font-medium text-[#78716C]">Type</th>
                    <th className="px-3 py-2.5 text-left font-medium text-[#78716C]">Category</th>
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
                      className="border-b border-[#F5F0E8] transition hover:bg-[#FDF2E9]/40"
                    >
                      <td className="px-3 py-2.5">
                        <Input
                          type="date"
                          value={tx.date}
                          onChange={(e) => updateTx(tx.id, { date: e.target.value })}
                          className="h-8 w-36 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          value={tx.description}
                          onChange={(e) => updateTx(tx.id, { description: e.target.value })}
                          className="h-8 text-xs"
                          placeholder="Description"
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
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => toggleDirection(tx.id)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                            tx.direction === "expense"
                              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                              : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          }`}
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
                disabled={importing || transactions.length === 0 || transactions.some((t) => t.amount <= 0)}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {importing ? "Importing…" : `Import ${transactions.length} transaction${transactions.length !== 1 ? "s" : ""}`}
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
