import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, CheckCircle2, XCircle, Receipt as ReceiptIcon, Sparkles, Upload, Paperclip, X, Banknote, Trash2, ListPlus, Eye, CalendarRange, AlertTriangle, MessageSquare, UploadCloud, FileSpreadsheet, Pencil, ChevronDown, Loader2 } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Select,
  Textarea,
  Badge,
  EmptyState,
  TableWrap,
  THead,
  Tr,
  Th,
  Td,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  toast,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import ReceiptViewer from "@/components/ReceiptViewer";
import ReceiptThumbs from "@/components/ReceiptThumbs";
import { supabase, isAdminRole, isPastorRole, buildReceiptPath, normalizeLineItems, EXPENSE_CATEGORIES, EVENT_SUGGESTIONS, type Expense, type ExpenseSource, type ExpenseStatus, type Profile } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { notifyPortal } from "@/lib/notify";

const sampleExpenses: Expense[] = [
  {
    id: "demo-e1",
    source: "church_direct",
    title: "Electricity — November",
    amount: 184.32,
    category: "utilities",
    description: "Monthly utility bill",
    receipt_paths: [],
    transfer_receipt_path: null,
    user_id: null,
    status: "auto_paid",
    submitted_at: new Date(Date.now() - 9 * 86400000).toISOString(),
    approved_by: null,
    approved_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    paid_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    paid_by: null,
    notes: null,
    created_at: new Date(Date.now() - 9 * 86400000).toISOString(),
  },
  {
    id: "demo-e2",
    source: "member_submitted",
    title: "Sunday school supplies",
    amount: 47.5,
    category: "supplies",
    description: "Markers, construction paper, glue",
    receipt_paths: [],
    transfer_receipt_path: null,
    user_id: null,
    status: "pending",
    submitted_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    approved_by: null,
    approved_at: null,
    paid_at: null,
    paid_by: null,
    notes: "For Christmas pageant craft kits",
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: "demo-e3",
    source: "member_submitted",
    title: "Outreach lunch",
    amount: 120,
    category: "events",
    description: "Saturday community meal",
    receipt_paths: [],
    transfer_receipt_path: null,
    user_id: null,
    status: "approved",
    submitted_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    approved_by: null,
    approved_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    paid_at: null,
    paid_by: null,
    notes: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
];

const SUPABASE_FN_URL = "https://qjoxqfkdyugwmgzgjzir.supabase.co/functions/v1/send-reimbursement-email";

async function notifyMember(expenseId: string) {
  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    await fetch(SUPABASE_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ expense_id: expenseId }),
    });
  } catch {
    // email notification is best-effort — don't block the UI
    console.warn("Email notification failed; the status update was still saved.");
  }
}

export default function Expenses() {
  const ctx = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  // Church-direct (bank auto-debits) is an admin-only flow — members only submit
  // their own reimbursements, so they must never see or pick the church-direct source.
  const isAdmin = isAdminRole(ctx.profile?.role);
  // The pastor sees every expense like an admin, but has no review actions —
  // read-only oversight while still being able to submit their own bills.
  const canSeeAll = isAdmin || isPastorRole(ctx.profile?.role);
  const [expenses, setExpenses] = useState<Expense[]>(sampleExpenses);
  const [loading, setLoading] = useState(true);
  const [viewExpense, setViewExpense] = useState<Expense | null>(null);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    source: "member_submitted" as ExpenseSource,
    title: "",
    amount: "",
    category: "other" as Expense["category"],
    event_name: "",
    description: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [checkImage, setCheckImage] = useState<File | null>(null);
  const [checkNumber, setCheckNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("online");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkImageRef = useRef<HTMLInputElement>(null);

  // ── Line items (batch bills for member_submitted) ─────────────────────
  interface LineItemDraft { key: string; description: string; amount: string; file: File | null; noReceiptNote: string; }
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);

  const addLineItem = () => setLineItems((prev) => [...prev, { key: `li${Date.now()}`, description: "", amount: "", file: null, noReceiptNote: "" }]);
  const removeLineItem = (key: string) => setLineItems((prev) => prev.filter((li) => li.key !== key));
  const updateLineItem = (key: string, patch: Partial<LineItemDraft>) =>
    setLineItems((prev) => prev.map((li) => (li.key === key ? { ...li, ...patch } : li)));
  const lineItemTotal = lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const [formError, setFormError] = useState("");

  // "Ask clarification" dialog state — admin questions a submission before approving/rejecting
  const [clarifyExpense, setClarifyExpense] = useState<Expense | null>(null);
  const [clarifyNote, setClarifyNote] = useState("");
  const [clarifySaving, setClarifySaving] = useState(false);

  const handleRequestClarification = async () => {
    if (!clarifyExpense || !clarifyNote.trim()) return;
    setClarifySaving(true);
    const patch = { admin_note: clarifyNote.trim(), admin_note_at: new Date().toISOString() };
    setExpenses((rows) => rows.map((r) => (r.id === clarifyExpense.id ? { ...r, ...patch } : r)));
    if (supabase) {
      const { error } = await supabase.rpc("admin_update_expense", {
        p_expense_id: clarifyExpense.id,
        p_admin_note: clarifyNote.trim(),
      });
      if (error) console.warn("Clarification update failed:", error);
    }
    setClarifySaving(false);
    setClarifyExpense(null);
    setClarifyNote("");
  };

  // "Mark Paid" dialog state
  const [payOpen, setPayOpen] = useState(false);
  const [payExpenseId, setPayExpenseId] = useState<string | null>(null);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payMethod, setPayMethod] = useState("online");
  const transferInputRef = useRef<HTMLInputElement>(null);

  // "Edit expense" dialog state — fix description, category, amount, date, etc.
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    amount: "",
    category: "other" as Expense["category"],
    date: "",
    paymentMethod: "",
    checkNumber: "",
    cardLast4: "",
    eventName: "",
    notes: "",
    memberId: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // "Delete expense" dialog state
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  // ── Bulk import state ────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTab, setBulkTab] = useState<"csv" | "paste" | "boa">("paste");
  const [bulkRaw, setBulkRaw] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkError, setBulkError] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  // Member profiles for linking Zelle-to-member rows as reimbursements
  const [memberOptions, setMemberOptions] = useState<{ id: string; name: string }[]>([]);
  interface BulkRow {
    key: string;
    date: string;
    description: string;
    amount: string;
    category: string;
    method: string;
    checkNumber: string;
    notes: string;
    /** Payee name from "Zelle payment to <NAME>" — used to link member reimbursements. */
    recipient: string;
    /** Matched member profile id (Zelle payment made TO this member). */
    memberId: string | null;
    memberName: string | null;
    /** Card last 4 from the "Card account # XXXX XXXX XXXX 5375" section. */
    cardLast4: string;
  }

  const emptyBulkRow = (): BulkRow => ({
    key: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: "",
    description: "",
    amount: "",
    category: "utilities",
    method: "online",
    recipient: "",
    memberId: null,
    memberName: null,
    cardLast4: "",
    checkNumber: "",
    notes: "",
  });

  // Categories the expense_category enum actually accepts. Anything else falls
  // back to "other" so a parsed row can ALWAYS import — the RPC casts the value
  // to the enum and throws if it isn't a member (e.g. 'software' before the
  // enum migration runs), which silently fails that row on import.
  const VALID_CATEGORIES = new Set(EXPENSE_CATEGORIES.map((c) => c.value));
  const safeCategory = (cat: string): string =>
    VALID_CATEGORIES.has(cat as Expense["category"]) ? cat : "other";

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .rpc("list_expenses")
      .then(({ data, error }) => {
        if (!error && data) setExpenses(data as Expense[]);
        setLoading(false);
      });
  }, []);

  const [showOnlyDirection, setShowOnlyDirection] = useState<"all" | ExpenseSource>("all");
  const [filterMethod, setFilterMethod] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(
    () => expenses.filter((e) => {
      if (showOnlyDirection !== "all" && e.source !== showOnlyDirection) return false;
      if (filterMethod !== "all" && e.payment_method !== filterMethod) return false;
      const d = (e.submitted_at ?? "").slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    }),
    [expenses, showOnlyDirection, filterMethod, dateFrom, dateTo],
  );
  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
  const pending = expenses.filter((e) => e.status === "pending").length;

  // ── My expenses (current user's submissions) ──────────────────────────
  const myExpenses = useMemo(
    () => filtered.filter((e) => e.source === "member_submitted" && e.user_id === ctx.profile?.id),
    [filtered, ctx.profile?.id],
  );
  const myPending = myExpenses.filter((e) => e.status === "pending").length;
  const myReimbursed = myExpenses.filter((e) => e.status === "paid").reduce((s, e) => s + Number(e.amount || 0), 0);

  /** Re-fetch the truth from the DB after a transition so a failed RPC can
   *  never leave the UI showing a status the database doesn't have. */
  const resyncExpenses = async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("list_expenses");
    if (data) setExpenses(data as Expense[]);
  };

  const transition = async (id: string, status: ExpenseStatus) => {
    const patch: Partial<Expense> = { status };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status === "paid" || status === "auto_paid") {
      patch.paid_at = new Date().toISOString();
    }
    setExpenses((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (supabase) {
      const { error } = await supabase.rpc("admin_update_expense", {
        p_expense_id: id,
        p_status: status,
      });
      if (error) {
        console.warn("Update expense failed:", error);
        toast(`Could not ${status === "approved" ? "approve" : status === "rejected" ? "reject" : "update"} — ${error.message}`, "error");
        await resyncExpenses();
        return;
      }
      toast(
        status === "approved" ? "Expense approved."
          : status === "rejected" ? "Expense rejected."
          : "Expense status updated.",
        "success",
      );
    }
  };

  // ── Edit an expense record (description, category, amount, date, …) ──
  const openEdit = async (e: Expense) => {
    if (memberOptions.length === 0) await loadMemberOptions();
    setEditForm({
      title: e.title ?? "",
      description: e.description ?? "",
      amount: String(e.amount ?? ""),
      category: e.category || "other",
      date: (e.submitted_at ?? "").slice(0, 10),
      paymentMethod: e.payment_method ?? "",
      checkNumber: e.check_number ?? "",
      cardLast4: e.card_last4 ?? "",
      eventName: e.event_name ?? "",
      notes: e.notes ?? "",
      // Only member_submitted rows show a member — church-direct rows must never
      // look "linked" to whoever imported them.
      memberId: e.source === "member_submitted" ? (e.user_id ?? "") : "",
    });
    setEditError("");
    setEditExpense(e);
  };

  const saveEdit = async () => {
    if (!editExpense) return;
    const amount = Number(editForm.amount);
    if (!editForm.title.trim() && !editForm.description.trim()) {
      setEditError("Add a title or description.");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setEditError("Enter a valid amount greater than zero.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    const memberId = editForm.memberId || null;
    const currentlyLinked = !!editExpense.user_id;
    const patch: Partial<Expense> = {
      title: editForm.title.trim() || null,
      description: editForm.description.trim() || null,
      amount,
      category: editForm.category,
      payment_method: editForm.paymentMethod || null,
      check_number: editForm.checkNumber || null,
      card_last4: editForm.cardLast4 || null,
      event_name: editForm.eventName || null,
      notes: editForm.notes.trim() || null,
      submitted_at: editForm.date ? new Date(editForm.date + "T12:00:00").toISOString() : editExpense.submitted_at,
    };
    if (memberId) { patch.source = "member_submitted"; patch.user_id = memberId; }
    else if (currentlyLinked) { patch.source = "church_direct"; patch.user_id = null; }
    // Back-dating an auto-settled import: submitted/approved/paid move together
    // so the list's "settled" line matches the new statement date.
    if (editExpense.status === "auto_paid") {
      patch.approved_at = patch.submitted_at;
      patch.paid_at = patch.submitted_at;
    }
    setExpenses((rows) => rows.map((r) => (r.id === editExpense.id ? { ...r, ...patch } : r)));
    if (supabase) {
      const { error } = await supabase.rpc("admin_update_expense", {
        p_expense_id: editExpense.id,
        p_title: patch.title ?? null,
        p_description: patch.description ?? null,
        p_amount: amount,
        p_category: editForm.category,
        p_payment_method: patch.payment_method ?? null,
        p_check_number: patch.check_number ?? null,
        p_card_last4: patch.card_last4 ?? null,
        p_event_name: patch.event_name ?? null,
        p_notes: patch.notes ?? null,
        p_submitted_at: patch.submitted_at,
        p_user_id: memberId,
        p_clear_member: !memberId && currentlyLinked,
      });
      if (error) {
        console.warn("Edit expense failed:", error);
        setEditError(error.message || "Could not save changes — please try again.");
        setEditSaving(false);
        return;
      }
    }
    setEditSaving(false);
    setEditExpense(null);
    toast("Expense updated — description, category, and totals refreshed.", "success");
  };

  const handleDeleteExpense = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    setExpenses((rows) => rows.filter((r) => r.id !== deleteTarget.id));
    if (supabase) {
      const { error } = await supabase.rpc("admin_delete_expense", { p_expense_id: deleteTarget.id });
      if (error) {
        console.warn("Delete expense failed:", error);
        setExpenses((rows) => (rows.some((r) => r.id === deleteTarget.id) ? rows : [deleteTarget, ...rows]));
        toast("Could not delete this expense — please try again.", "error");
      } else {
        toast("Expense deleted — totals and reports updated.", "success");
      }
    } else {
      toast("Expense deleted (demo).", "success");
    }
    setDeleteSaving(false);
    setDeleteTarget(null);
  };

  const handleMarkPaid = async () => {
    if (!payExpenseId) return;
    setPaySaving(true);

    let transferPath: string | null = null;

    // Upload transfer receipt if provided
    if (transferFile && supabase) {
      const safeName = transferFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${ctx.profile?.id ?? "admin"}/transfers/${payExpenseId}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage
        .from("receipts")
        .upload(path, transferFile, { cacheControl: "3600", upsert: false });
      if (!error) transferPath = path;
    }

    const patch: Partial<Expense> = {
      status: "paid",
      paid_at: new Date().toISOString(),
      ...(transferPath ? { transfer_receipt_path: transferPath } : {}),
    };

    setExpenses((rows) =>
      rows.map((r) => (r.id === payExpenseId ? { ...r, ...patch } : r)),
    );

    if (supabase) {
      const { error } = await supabase.rpc("admin_update_expense", {
        p_expense_id: payExpenseId,
        p_status: "paid",
        p_payment_method: payMethod,
        p_transfer_receipt_path: transferPath,
      });
      if (error) {
        console.warn("Mark paid failed:", error);
        toast(`Could not mark paid — ${error.message}`, "error");
        setPaySaving(false);
        setPayOpen(false);
        setPayExpenseId(null);
        setTransferFile(null);
        await resyncExpenses();
        return;
      }
      toast("Expense marked as paid — receipt saved.", "success");
      // Best-effort email notification
      notifyMember(payExpenseId);
    }

    setPaySaving(false);
    setPayOpen(false);
    setPayExpenseId(null);
    setTransferFile(null);
  };

  const uploadReceipts = async (expenseId: string): Promise<string[]> => {
    if (!supabase || receiptFiles.length === 0) return [];
    const paths: string[] = [];
    for (const file of receiptFiles) {
      const path = buildReceiptPath(ctx.profile?.id, "receipts", file.name, expenseId);
      const { error } = await supabase.storage.from("receipts").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (!error) paths.push(path);
      else console.warn("Receipt upload failed:", error);
    }
    return paths;
  };

  const handleCreate = async () => {
    setSaving(true);
    setFormError("");
    if (form.source === "member_submitted" && lineItems.length === 0) {
      setFormError("Add at least one bill — each purchase needs its amount, plus a receipt (or a note explaining why there isn't one).");
      setSaving(false);
      return;
    }
    const missingNotes = lineItems.filter((li) => !li.file && !li.noReceiptNote.trim());
    if (missingNotes.length > 0) {
      setFormError(`Add a "No receipt?" explanation for ${missingNotes.length} bill${missingNotes.length === 1 ? "" : "s"} without a receipt.`);
      setSaving(false);
      return;
    }
    // Use line item total if present, otherwise form amount
    const value = lineItems.length > 0 ? lineItemTotal : Number(form.amount);
    if (!value || value <= 0) { setSaving(false); return; }

    // Upload check image if present
    let checkImagePath: string | null = null;
    if (paymentMethod === "check" && checkImage && supabase) {
      const path = buildReceiptPath(ctx.profile?.id, "check-images", checkImage.name);
      const { error } = await supabase.storage.from("receipts").upload(path, checkImage, { cacheControl: "3600", upsert: false });
      if (!error) checkImagePath = path;
    }

    // Upload line item receipts
    const lineItemsData: { description: string; amount: number; receipt_path: string | null; no_receipt_note: string | null }[] = [];
    if (supabase) {
      for (const li of lineItems) {
        let receiptPath: string | null = null;
        if (li.file) {
          const path = buildReceiptPath(ctx.profile?.id, "line-items", li.file.name);
          const { error } = await supabase.storage.from("receipts").upload(path, li.file, { cacheControl: "3600", upsert: false });
          if (!error) receiptPath = path;
        }
        lineItemsData.push({
          description: li.description || "Bill",
          amount: Number(li.amount) || 0,
          receipt_path: receiptPath,
          no_receipt_note: li.noReceiptNote.trim() || null,
        });
      }
    }

    const baseRow: Expense = {
      id: `local-${Date.now()}`,
      source: form.source,
      title: form.title || (form.source === "church_direct" ? null : form.description?.slice(0, 60)),
      amount: value,
      category: form.category,
      event_name: form.event_name.trim() || null,
      description: form.description || null,
      receipt_paths: [],
      user_id: null,
      status: form.source === "church_direct" ? "auto_paid" : "pending",
      submitted_at: new Date().toISOString(),
      approved_by: null,
      approved_at: form.source === "church_direct" ? new Date().toISOString() : null,
      paid_at: form.source === "church_direct" ? new Date().toISOString() : null,
      paid_by: null,
      notes: form.notes || null,
      created_at: new Date().toISOString(),
      payment_method: paymentMethod,
      check_number: checkNumber || null,
      line_items: lineItemsData.length > 0 ? lineItemsData : null,
    };
    if (supabase) {
      let expenseId: string | null = null;
      let error: unknown = null;

      if (form.source === "member_submitted") {
        const rpcResult = await supabase.rpc("submit_expense", {
          p_title: baseRow.title ?? null,
          p_amount: baseRow.amount,
          p_category: baseRow.category,
          p_description: baseRow.description ?? null,
          p_notes: baseRow.notes ?? null,
          p_event_name: baseRow.event_name ?? null,
          p_line_items: lineItemsData.length > 0 ? lineItemsData : null,
        });
        expenseId = rpcResult.data as string | null;
        error = rpcResult.error;
      } else {
        const rpcResult = await supabase.rpc("admin_insert_expense", {
          p_title: baseRow.title ?? null,
          p_amount: baseRow.amount,
          p_category: baseRow.category,
          p_description: baseRow.description ?? null,
          p_notes: baseRow.notes ?? null,
          p_event_name: baseRow.event_name ?? null,
          p_payment_method: paymentMethod ?? null,
          p_check_number: checkNumber || null,
        });
        expenseId = rpcResult.data as string | null;
        error = rpcResult.error;
      }

      if (!error && expenseId) {
        // Fetch the full expense record back (member expenses_self_read or admin can read)
        const { data: inserted } = await supabase
          .from("expenses")
          .select()
          .eq("id", expenseId)
          .maybeSingle();
        if (inserted) {
          const expense = inserted as Expense;
          // Attach check image to receipt_paths if uploaded
          if (checkImagePath) {
            await supabase.from("expenses").update({ receipt_paths: [checkImagePath] }).eq("id", expense.id);
            expense.receipt_paths = [checkImagePath];
          }
          if (receiptFiles.length > 0) {
            setUploading(true);
            const paths = await uploadReceipts(expense.id);
            if (paths.length > 0) {
              await supabase
                .from("expenses")
                .update({ receipt_paths: paths })
                .eq("id", expense.id);
              expense.receipt_paths = paths;
            }
            setUploading(false);
          }
          setExpenses((rows) => [expense, ...rows]);
        }
      }
      // Notify admins that a member submitted a reimbursement request
      if (form.source === "member_submitted" && expenseId) {
        notifyPortal({ type: "expense_submitted", expense_id: expenseId });
      }
      if (error) console.warn("Insert expense failed:", error);
    } else {
      setExpenses((rows) => [baseRow, ...rows]);
    }
    setSaving(false);
    setOpen(false);
    setReceiptFiles([]);
    setForm({ source: "member_submitted", title: "", amount: "", category: "other", event_name: "", description: "", notes: "" });
    setReceiptFiles([]);
    setCheckImage(null);
    setCheckNumber("");
    setPaymentMethod("online");
    setLineItems([]);
  };

  // ── Bulk import: detect bank columns from header row ─────────────────
  // ── BOA / plain-text statement parser (Zelle, card, check, transfers) ─
  const parseBoaStatement = (raw: string): BulkRow[] => {
    // Normalize: insert newlines before dates that appear mid-text
    // e.g. "800.0001/02/26" → "800.00\n01/02/26"
    const normalized = raw
      .replace(/(\.\d{2})(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g, "$1\n$2")
      // Also break amounts glued to section footers: "-14.44Subtotal…" or "-$1,457.78Card account…"
      .replace(/(-?\$?[\d,]+\.\d{2})(?=Subtotal|Card account|Total |Daily balance|Your checking|Beginning balance|Ending balance)/gi, "$1\n");
    const lines = normalized.split(/\n/);
    const entries: { date: string; desc: string; amount: string; method: string; recipient: string; cardLast4: string; checkNumber: string }[] = [];
    let i = 0;
    // Current card section — BOA groups purchases under "Card account # XXXX 5375".
    let currentCard = "";
    // Only parse the withdrawals/debits section — skip the deposits section
    let inDebits = false;
    // First pass: detect the "Total withdrawals" or card account sections
    for (let j = 0; j < lines.length; j++) {
      if (/total withdrawals|card account|withdrawals and other debits/i.test(lines[j])) {
        inDebits = true;
      }
      // Stop at next major section
      if (inDebits && /^\s*(Deposits|Daily balance|Page \d|Your checking|Service charges|Overdraft)/i.test(lines[j]) && j > 0) {
        break;
      }
    }

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }

      // Track which card section we're in (last 4 digits of the card header)
      // so every purchase below it is attributed to that card.
      const cardHdr = line.match(/^Card account #.*?(\d{4})\s*$/i);
      if (cardHdr) {
        currentCard = cardHdr[1];
        i++; continue;
      }

      // Skip section headers, page numbers, account numbers
      if (/^(Page \d|ATLANTA LITTLE FLOCK|Account #|Subtotal|Total |Deposits|Your checking|Daily balance|Service charge|Beginning balance|Ending balance|Number of |Statement period|Card account #)/i.test(line)) {
        i++; continue;
      }

      // Match: MM/DD/YY (or MM/DD/YYYY) at start
      const dateMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
      if (!dateMatch) { i++; continue; }
      const rawDate = dateMatch[1];
      // Normalize to YYYY-MM-DD
      const dateParts = rawDate.split("/");
      let y = dateParts[2];
      if (y.length === 2) y = "20" + y;
      const date = `${y}-${dateParts[0].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}`;

      let desc = line.slice(dateMatch[0].length).trim();

      // Skip deposits (Zelle payment FROM, Deposit, REFUND) — including BOA's
      // "Zelle Recurring payment from" qualifier for scheduled Zelle gifts.
      if (/zelle\s+(?:recurring\s+)?payment from\b|\bdeposit\b|purchase refund/i.test(desc) && !/zelle\s+(?:recurring\s+)?payment to\b/i.test(desc)) {
        i++; continue;
      }

      // Check if this line has an amount at the end (possibly negative)
      let amount = "";
      const amtMatch = desc.match(/(-?\$?[\d,]+\.\d{2})\s*$/);
      if (amtMatch) {
        amount = amtMatch[1].replace(/[$,\s]/g, "");
        desc = desc.slice(0, amtMatch.index).trim();
      } else {
        // Look ahead up to 3 lines for standalone amount (BOA splits amt after Conf#).
        // Match an amount at the START of the line so it also catches glued
        // footers like "-14.44Subtotal…" that normalization may have missed.
        for (let look = 1; look <= 3 && i + look < lines.length; look++) {
          const nextLine = lines[i + look]?.trim() || "";
          const nextAmt = nextLine.match(/^(-?\$?[\d,]+\.\d{2})/);
          if (nextAmt) {
            amount = nextAmt[1].replace(/[$,\s]/g, "");
            i += look; // consume the amount line
            break;
          }
        }
      }

      // Clean up description: remove confirmation numbers, card reference numbers
      desc = desc
        .replace(/;?\s*Conf#\s*\S+/g, "")
        .replace(/CKCD\s*\d+\s*X+\d*/g, "")
        .replace(/\bCKCD\b/g, "") // stray "CKCD" tokens left when digits are on the next line
        .replace(/\d{15,}/g, "")  // long transaction IDs
        .replace(/\b\d{2,4}\s+X+\s*\d{2,4}\b/g, "") // card masks
        .replace(/\s{2,}/g, " ")
        .trim();

      // Skip if it's a deposit (positive amount and "payment from" in description)
      const numAmt = amount ? parseFloat(amount) : 0;
      if (amount && numAmt > 0) { i++; continue; } // expenses should be negative in BOA statements

      // Extract a clean title from the description. Two-pass like the Donations
      // parser: first REQUIRE the "for" memo (so lazy matching can't stop at one
      // char), then fall back to capturing the whole name for memos without one.
      let title = desc;
      let zelleTo = desc.match(/Zelle payment to\s+(.+?)\s+for\s+["']([^"']+)["']/i);
      if (!zelleTo) zelleTo = desc.match(/Zelle payment to\s+(.+)/i);
      if (zelleTo) {
        const name = zelleTo[1].trim();
        const reason = zelleTo[2]?.trim();
        title = reason || `Zelle to ${name}`;
        // Truncate long titles
        if (title.length > 200) title = title.slice(0, 197) + "...";
      }
      // Who did we pay? Used to link Zelle-to-member rows as reimbursements.
      const zelleRecipient = zelleTo ? zelleTo[1].trim() : "";

      // No amount found (pasted fragment / unusual layout): keep the row with an
      // empty amount so the reviewer can type it in — never silently drop an expense.
      const absAmt = amount ? Math.abs(numAmt) : NaN;

      // Method detection from the raw description (title strips the "Zelle/CHECKCARD"
      // prefixes, so method must be derived here before the title replaces desc).
      let method = "online";
      if (/checkcard|purchase|debit/i.test(desc)) method = "card";
      else if (/^check\b|check #|check no/i.test(desc)) method = "check";
      else if (/cash/i.test(desc)) method = "cash";

      // Extract check number from BOA check lines: "CHECK 1053 VENDOR…" / "Check 0001053"
      const checkNo = desc.match(/\bcheck\s+#?\s*(\d+)/i)?.[1] ?? "";

      entries.push({ date, desc: title, amount: amount ? String(absAmt) : "", method, recipient: zelleRecipient, cardLast4: currentCard, checkNumber: checkNo });
      i++;
    }

    return entries.map((e) => ({
      ...emptyBulkRow(),
      date: e.date,
      description: e.desc.slice(0, 200),
      amount: e.amount,
      recipient: e.recipient,
      cardLast4: e.cardLast4,
      checkNumber: e.checkNumber,
      category: safeCategory((() => {
        const t = e.desc.toLowerCase();
        if (/\bvbs\b|vacation bible/.test(t)) return "vbs";
        if (/sunday school/.test(t)) return "sunday_school";
        if (/book room|\bbooks\b/.test(t)) return "books";
        if (/adjustment|correction|reversal/.test(t)) return "bank_fees";
        if (/amazon/.test(t)) return "amazon_purchases";
        if (/sunday snacks/.test(t)) return "sunday_snacks";
        if (/food|grocery|restaurant|catering|lunch|dinner|indifresh|water|yogurt|milk|juice|drinks|snacks/.test(t)) return "food_expenses";
        if (/phone|internet/.test(t)) return "internet_phone";
        if (/utility|electric|water|gas|power/.test(t)) return "utilities";
        if (/supply|office|staples|walmart|usps|postage/.test(t)) return "supplies";
        if (/insurance/.test(t)) return "insurance";
        if (/reimburs/.test(t)) return "reimbursements";
        if (/salary|stipend|payroll/.test(t)) return "salaries";
        if (/gift|benevolen|helping famil/.test(t)) return "benevolence";
        if (/travel|hotel|flight|baggage/.test(t)) return "travel";
        if (/software|subscription|zoom|hosting/.test(t)) return "software";
        if (/western union|wire/.test(t)) return "benevolence";
        if (/kingswood|university|school|college/.test(t)) return "education";
        if (/rent|lease|mortgage/.test(t)) return "rent";
        return "other";
      })()),
      method: e.method || "online",
    }));
  };

  /**
   * Load member profiles (with linked-donor name fallback) for reimbursement linking.
   */
  const loadMemberOptions = async (): Promise<{ id: string; name: string }[]> => {
    if (!supabase) return [];
    const [profilesRes, donorsRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, linked_donor_id"),
      supabase.from("donors").select("id, first_name, last_name"),
    ]);
    const profiles = (profilesRes.data ?? []) as { id: string; full_name: string | null; linked_donor_id: string | null }[];
    const donors = (donorsRes.data ?? []) as { id: string; first_name: string; last_name: string }[];
    const list = profiles
      .map((p) => {
        const linked = p.linked_donor_id ? donors.find((d) => d.id === p.linked_donor_id) : null;
        const name = p.full_name?.trim() || (linked ? `${linked.first_name} ${linked.last_name}`.trim() : "");
        return { id: p.id, name };
      })
      .filter((m) => m.name.length > 0);
    setMemberOptions(list);
    return list;
  };

  /**
   * Link "Zelle payment to <NAME>" rows to the matching member profile so they
   * import as that member's reimbursement (shows under "My giving & bills").
   * Matching is tolerant: exact, prefix, all-token (ignores middle names),
   * same last name, or same first name — and falls back to the linked donor name.
   */
  const enrichMemberReimbursements = async (rows: BulkRow[]): Promise<BulkRow[]> => {
    if (!supabase) return rows;
    const list = await loadMemberOptions();
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const tok = (s: string) => norm(s).split(" ").filter(Boolean);
    const findProfile = (name: string) => {
      const qn = norm(name);
      const qt = tok(name);
      if (!qn || qt.length === 0) return undefined;
      return list.find((m) => {
        const cn = norm(m.name);
        const ct = tok(m.name);
        if (cn === qn) return true;                                     // exact
        if (cn.startsWith(qn) || qn.startsWith(cn)) return true;        // prefix / suffix
        if (qt.length >= 2 && qt.every((t) => ct.includes(t))) return true; // all tokens → ignores middle names / order
        const qLast = qt[qt.length - 1] ?? "";
        const cLast = ct[ct.length - 1] ?? "";
        if (qLast.length >= 4 && cLast === qLast) return true;          // same last name
        const qFirst = qt[0] ?? "";
        const cFirst = ct[0] ?? "";
        if (qFirst.length >= 4 && qFirst === cFirst) return true;       // same first name
        return false;
      });
    };
    // Candidate names to try: the Zelle recipient plus any "for <Name>"
    // fragment in check/misc rows (e.g. `Check #1183 "for Saritha Gummadi Food
    // Expenses"`) so those can auto-link as member reimbursements too.
    const candidatesFor = (desc: string): string[] => {
      const out: string[] = [];
      // "for <Name>" fragments (checks/memos) and Western Union "INDN:<Name>"
      // recipients — both can be member reimbursements.
      const re = /(?:for\s+["']?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})|INDN:\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*))/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(desc))) out.push(m[1] ?? m[2]);
      return out;
    };
    return rows.map((r) => {
      if (r.memberId) return r; // reviewer already picked a member
      const names = [
        ...(r.recipient ? [r.recipient] : []),
        ...candidatesFor(r.description),
      ];
      for (const name of names) {
        const p = findProfile(name);
        if (p) return { ...r, memberId: p.id, memberName: p.name };
      }
      return r;
    });
  };

  const handleParseBoa = async () => {
    setBulkError("");
    const rows = await enrichMemberReimbursements(parseBoaStatement(bulkRaw));
    if (rows.length === 0) {
      setBulkError("No expense entries detected. Paste the full BOA statement text including the withdrawals/debits section.");
      setBulkRows([]);
      return;
    }
    setBulkRows(rows);
  };

  const COMMON_COLUMNS: Record<string, { dateCols: string[]; descCols: string[]; amtCols: string[] }> = {
    chase: { dateCols: ["Posting Date", "Post Date", "Transaction Date", "Date"], descCols: ["Description"], amtCols: ["Amount"] },
    bofa: { dateCols: ["Date", "Posted Date"], descCols: ["Description", "Payee"], amtCols: ["Amount", "Running Bal."] },
    wells: { dateCols: ["Date", "Transaction Date"], descCols: ["Description", "Memo"], amtCols: ["Amount"] },
    generic: { dateCols: ["Date", "date", "DATE", "Posted", "Trans Date", "Transaction Date"], descCols: ["Description", "description", "DESCRIPTION", "Payee", "payee", "Narrative", "Memo", "Name", "Title"], amtCols: ["Amount", "amount", "AMOUNT", "Debit", "Credit", "Value", "Sum"] },
  };

  const parsePastedData = (raw: string): BulkRow[] => {
    const lines = raw.split(/\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    // Detect delimiter: tab or comma
    const delim = lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(delim).map((h) => h.toLowerCase().replace(/^["']|["']$/g, "").trim());

    // Detect bank format
    let format = COMMON_COLUMNS.generic;
    for (const [_, cfg] of Object.entries(COMMON_COLUMNS)) {
      const match = cfg.dateCols.some((dc) => headers.some((h) => h.includes(dc.toLowerCase())));
      if (match) { format = cfg; break; }
    }

    // Map columns
    const dateIdx = headers.findIndex((h) => format.dateCols.some((dc) => h.includes(dc.toLowerCase())));
    const descIdx = headers.findIndex((h) => format.descCols.some((dc) => h.includes(dc.toLowerCase())));
    const amtIdx = headers.findIndex((h) => format.amtCols.some((dc) => h.includes(dc.toLowerCase())));

    if (descIdx < 0 || amtIdx < 0) return [];

    return lines.slice(1).map((line) => {
      const cells = line.split(delim).map((c) => c.replace(/^["']|["']$/g, "").trim());
      const desc = cells[descIdx] || "";
      let amt = cells[amtIdx] || "";
      // Clean amount: remove $, commas, spaces, handle parentheses (negative)
      const isNeg = /^\(.*\)$/.test(amt);
      amt = amt.replace(/[$,\s()]/g, "");
      if (isNeg) amt = "-" + amt;
      const dateRaw = dateIdx >= 0 ? cells[dateIdx] : "";
      const date = dateRaw ? normalizeDate(dateRaw) : "";
      // Auto-detect category from description keywords
      let cat = "other";
      const dLower = desc.toLowerCase();
      if (/electric|power|utility|water|gas|internet|phone/.test(dLower)) cat = "utilities";
      else if (/food|grocery|restaurant|catering|lunch|dinner/.test(dLower)) cat = "food_expenses";
      else if (/amazon/.test(dLower)) cat = "amazon_purchases";
      else if (/walmart|target|costco|supply|office|staples/.test(dLower)) cat = "supplies";
      else if (/rent|lease|mortgage/.test(dLower)) cat = "facility_rent";
      else if (/insurance/.test(dLower)) cat = "insurance";
      else if (/salary|payroll|stipend/.test(dLower)) cat = "salaries";
      else if (/restaurant|catering|food|lunch|dinner/.test(dLower)) cat = "food_expenses";
      else if (/travel|hotel|flight|airline|uber|lyft/.test(dLower)) cat = "travel";
      else if (/software|subscription|hosting|domain|zoom|slack/.test(dLower)) cat = "software";
      else if (/bank fee|service charge|wire|transfer fee/.test(dLower)) cat = "bank_fees";

      return { ...emptyBulkRow(), date, description: desc.slice(0, 200), amount: amt, category: safeCategory(cat), method: "online" };
    }).filter((r) => r.description && !isNaN(Number(r.amount)) && Number(r.amount) !== 0);
  };

  const handleParseData = async () => {
    setBulkError("");
    const rows = await enrichMemberReimbursements(parsePastedData(bulkRaw));
    if (rows.length === 0) {
      setBulkError("Could not detect columns. Paste a spreadsheet with headers like 'Date, Description, Amount' or upload a CSV file.");
      setBulkRows([]);
      return;
    }
    setBulkRows(rows);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      setBulkRaw(text);
      const rows = await enrichMemberReimbursements(parsePastedData(text));
      if (rows.length === 0) {
        setBulkError("Could not parse CSV. Make sure it has a header row with Date, Description, and Amount columns.");
        setBulkRows([]);
        return;
      }
      setBulkRows(rows);
      setBulkError("");
    };
    reader.readAsText(file);
  };

  const handleBulkImport = async () => {
    const valid = bulkRows.filter((r) => r.description && r.amount && !isNaN(Number(r.amount)) && Number(r.amount) !== 0);
    if (valid.length === 0) { setBulkError("No valid rows to import."); return; }
    setBulkSaving(true);
    setBulkError("");
    let imported = 0;
    let failed = 0;
    const newExpenses: Expense[] = [];
    for (const row of valid) {
      const amount = Math.abs(Number(row.amount));
      try {
        if (supabase) {
          // Zelle payments TO a matched member import as that member's
          // reimbursement (auto-settled) instead of a church-direct outlay.
          // p_user_id is only sent when a member matched, so plain church-direct
          // imports keep working even before the RPC migration is applied.
          // Historical statement imports carry no receipt images — flag that on
          // member reimbursements so an empty receipt is never mistaken for a
          // missing upload.
          const reimbNote =
            row.memberId
              ? [row.notes, "Imported from bank statement — no receipt on file"].filter(Boolean).join(" — ")
              : row.notes || null;
          const rpcParams: Record<string, unknown> = {
            p_title: row.description.slice(0, 200),
            p_amount: amount,
            p_category: row.category,
            p_description: row.description,
            p_notes: reimbNote,
            p_event_name: null,
            p_payment_method: row.method || "online",
            p_check_number: row.checkNumber || null,
            p_card_last4: row.cardLast4 || null,
          };
          if (row.memberId) rpcParams.p_user_id = row.memberId;
          // Use the date printed on the bank statement (posted date), not today —
          // so reports and member YTD figures land in the right month/year.
          if (row.date) rpcParams.p_submitted_at = new Date(row.date + "T12:00:00").toISOString();
          const { data, error } = await supabase.rpc("admin_insert_expense", rpcParams);
          if (!error && data) {
            const { data: inserted } = await supabase.from("expenses").select().eq("id", data as string).maybeSingle();
            if (inserted) newExpenses.push(inserted as Expense);
            imported++;
          } else {
            failed++;
            console.warn("Bulk import row failed:", error, row.description);
          }
        } else {
          newExpenses.push({
            id: `local-bulk-${Date.now()}-${imported}`,
            source: row.memberId ? "member_submitted" : "church_direct",
            title: row.description.slice(0, 200),
            amount,
            category: row.category as Expense["category"],
            description: row.description,
            receipt_paths: [],
            transfer_receipt_path: null,
            user_id: row.memberId || null,
            status: "auto_paid",
            card_last4: row.cardLast4 || null,
            submitted_at: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
            approved_by: null,
            approved_at: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
            paid_at: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
            paid_by: null,
            notes: row.memberId
              ? [row.notes, "Imported from bank statement — no receipt on file"].filter(Boolean).join(" — ")
              : row.notes || null,
            created_at: new Date().toISOString(),
            payment_method: row.method || "online",
          });
          imported++;
        }
      } catch {
        failed++;
      }
    }
    if (newExpenses.length > 0) setExpenses((rows) => [...newExpenses, ...rows]);
    setBulkSaving(false);
    const msg = imported > 0
      ? `Imported ${imported} expense${imported === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}.`
      : `Import failed for all ${failed} rows.`;
    if (imported > 0 && failed === 0) {
      setBulkOpen(false);
      setBulkRaw("");
      setBulkRows([]);
      toast(msg, "success");
    } else {
      setBulkError(msg);
    }
  };

  const statusTone = (s: ExpenseStatus) =>
    s === "auto_paid" || s === "paid"
      ? "emerald"
      : s === "rejected"
        ? "rose"
        : s === "approved"
          ? "indigo"
          : "amber";

  const openPayDialog = (id: string) => {
    setPayExpenseId(id);
    setTransferFile(null);
    setPayMethod("online");
    setPayOpen(true);
  };

  // Normalize various date formats to YYYY-MM-DD
  const normalizeDate = (raw: string): string => {
    const d = raw.replace(/^["']|["']$/g, "").trim();
    // Try MM/DD/YYYY or MM-DD-YYYY
    const us = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (us) {
      const y = us[3].length === 2 ? "20" + us[3] : us[3];
      return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    }
    // Try YYYY-MM-DD
    const iso = d.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    // Try DD/MM/YYYY
    const dmy = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return d;
  };

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track what flows out — both member reimbursements and church-direct outlays."
        badge={`${formatCurrency(total)} total · ${pending} pending`}
        actions={
          <>
            <Dialog open={bulkOpen} onOpenChange={(v) => { setBulkOpen(v); if (!v) { setBulkError(""); } }}>
              <DialogTrigger asChild>
                <Button variant="outline" iconLeft={<UploadCloud className="h-4 w-4" />}>Bulk import</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Bulk import expenses</DialogTitle>
                  <DialogDescription>
                    Import church-direct expenses from your bank statement CSV or paste from a spreadsheet. All entries are created as <strong>church-direct</strong> (auto-settled).
                  </DialogDescription>
                </DialogHeader>                  <Tabs value={bulkTab} onValueChange={(v) => setBulkTab(v as "csv" | "paste" | "boa")}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="paste">Paste spreadsheet</TabsTrigger>
                    <TabsTrigger value="csv">Upload CSV</TabsTrigger>
                    <TabsTrigger value="boa">BOA statement</TabsTrigger>
                  </TabsList>
                  <TabsContent value="paste">
                    <div>
                      <Label htmlFor="bulk-paste">Paste from spreadsheet (tab-separated or CSV)</Label>
                      <Textarea
                        id="bulk-paste"
                        rows={6}
                        value={bulkRaw}
                        onChange={(e) => setBulkRaw(e.target.value)}
                        className="mt-1.5 font-mono text-xs"
                        placeholder={`Date\tDescription\tAmount\n2024-01-15\tElectric Company\t-184.32\n2024-01-16\tAmazon - Supplies\t-47.50\n2024-01-17\tChurch Insurance Co\t-320.00`}
                      />
                      <p className="mt-1 text-xs text-stone-400">Copy cells from Excel/Google Sheets and paste here. Best results if your sheet has Date, Description, and Amount columns.</p>
                      <Button
                        className="mt-3"
                        onClick={handleParseData}
                        disabled={!bulkRaw.trim()}
                        iconLeft={<FileSpreadsheet className="h-4 w-4" />}
                      >
                        Parse data
                      </Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="csv">
                    <div>
                      <Label>Upload bank CSV file</Label>
                      <div className="mt-2">
                        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center hover:bg-stone-100 transition-colors">
                          <UploadCloud className="h-8 w-8 text-stone-400" />
                          <span className="text-sm text-stone-600">Click to upload a .csv file</span>
                          <span className="text-xs text-stone-400">Works with Chase, Bank of America, Wells Fargo, and generic bank exports</span>
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={handleCsvUpload}
                          />
                        </label>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="boa">
                    <div>
                      <Label htmlFor="bulk-boa">Paste Bank of America statement text</Label>
                      <Textarea
                        id="bulk-boa"
                        rows={10}
                        value={bulkRaw}
                        onChange={(e) => setBulkRaw(e.target.value)}
                        className="mt-1.5 font-mono text-xs"
                        placeholder={`01/02/26 Zelle payment to Suved Akipogu for "Jan 1st Food expenses"; Conf# wuynd181l -800.00\n01/05/26 USPS PO 120410 01/05 #000903598 PURCHASE USPS PO 120410004 ATLANTA GA -21.95\n01/22/26 WESTERN UNION DES: CAPTURE ID:602281243601713 INDN:EPARAIM -500.99`}
                      />
                      <p className="mt-1 text-xs text-stone-400">Copy the full monthly statement from BOA's website and paste here. Parses Zelle payments, card purchases, checks, Western Union — skips deposits automatically.</p>
                      <Button
                        className="mt-3"
                        onClick={handleParseBoa}
                        disabled={!bulkRaw.trim()}
                        iconLeft={<FileSpreadsheet className="h-4 w-4" />}
                      >
                        Parse BOA statement
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>

                {bulkError && (
                  <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {bulkError}
                  </div>
                )}

                {bulkRows.length > 0 && (
                  <>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-stone-600">
                        {bulkRows.length} row{bulkRows.length === 1 ? "" : "s"} detected — review and edit before importing
                      </span>
                      <span className="text-sm font-medium text-stone-700">
                        Total: {formatCurrency(bulkRows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0))}
                      </span>
                    </div>
                    {bulkRows.some((r) => !r.amount) && (
                      <div className="mt-1 text-xs font-medium text-amber-600">
                        {bulkRows.filter((r) => !r.amount).length} row{bulkRows.filter((r) => !r.amount).length === 1 ? "" : "s"} missing a dollar amount (your paste probably cut it off) — type the amount to include it.
                      </div>
                    )}
                    <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-stone-200">
                      <table className="w-full min-w-[860px] text-xs">
                        <thead className="sticky top-0 bg-stone-50">
                          <tr className="border-b border-stone-200 text-stone-500">
                            <th className="px-2 py-2 text-left font-medium">Date</th>
                            <th className="px-2 py-2 text-left font-medium">Description</th>
                            <th className="px-2 py-2 text-right font-medium w-20">Amount</th>
                            <th className="px-2 py-2 text-left font-medium w-28">Category</th>
                            <th className="px-2 py-2 text-left font-medium w-20">Method</th>
                            <th className="px-2 py-2 text-center font-medium w-16">Check #</th>
                            <th className="px-2 py-2 text-center font-medium w-14">Card</th>
                            <th className="px-2 py-2 text-left font-medium w-32">Notes</th>
                            <th className="px-2 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkRows.map((row, i) => (
                            <tr key={row.key} className="border-b border-stone-100 hover:bg-stone-50/50">
                              <td className="px-2 py-1">
                                <input
                                  type="date"
                                  value={row.date}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], date: e.target.value };
                                    setBulkRows(next);
                                  }}
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  value={row.description}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], description: e.target.value };
                                    setBulkRows(next);
                                  }}
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                                />
                                {memberOptions.length > 0 && (row.recipient || row.memberId || /for\s+["']?[A-Z]|reimburs|(?:payment|paid)\s+to\s+[A-Z]/i.test(row.description)) && (
                                  <div className="mt-1">
                                    <select
                                      value={row.memberId ?? ""}
                                      onChange={(e) => {
                                        const next = [...bulkRows];
                                        const id = e.target.value;
                                        const m = id ? memberOptions.find((x) => x.id === id) : null;
                                        next[i] = { ...next[i], memberId: id || null, memberName: m?.name ?? null };
                                        setBulkRows(next);
                                      }}
                                      className={`w-full rounded border px-1 py-0.5 text-[10px] ${row.memberId ? "border-indigo-200 bg-indigo-50 font-medium text-indigo-800" : row.recipient ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-200 text-stone-600"}`}
                                    >
                                      {row.recipient
                                        ? <option value="">Zelle to member — pick member…</option>
                                        : <option value="">Church-direct — not a member reimbursement</option>}
                                      {memberOptions.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                      ))}
                                    </select>
                                    {row.memberId ? (
                                      <div className="mt-0.5 text-[10px] font-medium text-indigo-600">
                                        Reimbursement → {row.memberName} — shows under their "My giving & bills".
                                      </div>
                                    ) : row.recipient ? (
                                      <div className="mt-0.5 text-[10px] text-stone-400">
                                        No registered member with this name — will import as church-direct.
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.amount}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], amount: e.target.value };
                                    setBulkRows(next);
                                  }}
                                  placeholder="0.00"
                                  className={`w-full rounded border px-1 py-0.5 text-xs text-right ${row.amount === "" ? "border-amber-400 bg-amber-50" : "border-stone-200"}`}
                                />
                                {row.amount === "" && (
                                  <div className="mt-0.5 text-[10px] font-medium text-amber-600">Missing — type amount to import</div>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                <select
                                  value={row.category}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], category: e.target.value };
                                    setBulkRows(next);
                                  }}
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                                >
                                  {EXPENSE_CATEGORIES.map((c) => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <select
                                  value={row.method}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], method: e.target.value };
                                    setBulkRows(next);
                                  }}
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                                >
                                  <option value="online">Online</option>
                                  <option value="debit">Debit</option>
                                  <option value="card">Card</option>
                                  <option value="check">Check</option>
                                  <option value="cash">Cash</option>
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={row.cardLast4}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], cardLast4: e.target.value.replace(/\D/g, "").slice(0, 4) };
                                    setBulkRows(next);
                                  }}
                                  placeholder="••••"
                                  title="Card used (last 4 digits)"
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-center text-xs"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  value={row.checkNumber}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], checkNumber: e.target.value.replace(/\D/g, "").slice(0, 10) };
                                    setBulkRows(next);
                                  }}
                                  placeholder="#"
                                  title="Check number (check payments)"
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-center text-xs"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="text"
                                  value={row.notes}
                                  onChange={(e) => {
                                    const next = [...bulkRows];
                                    next[i] = { ...next[i], notes: e.target.value };
                                    setBulkRows(next);
                                  }}
                                  placeholder="Comment…"
                                  title="Comment / what this expense is for"
                                  className="w-full rounded border border-stone-200 px-1 py-0.5 text-xs"
                                />
                              </td>
                              <td className="px-1 py-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = [...bulkRows];
                                    next.splice(i, 1);
                                    setBulkRows(next);
                                  }}
                                  className="rounded p-1 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                                  title="Remove row"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <Button variant="outline" onClick={() => { setBulkOpen(false); setBulkRaw(""); setBulkRows([]); setBulkError(""); }}>
                        Cancel
                      </Button>
                      <Button onClick={handleBulkImport} disabled={bulkSaving}>
                        {bulkSaving ? <>Importing…</> : (() => {
                          const importable = bulkRows.filter((r) => r.description && r.amount && !isNaN(Number(r.amount)) && Number(r.amount) !== 0).length;
                          return <>Import {importable} of {bulkRows.length} expense{bulkRows.length === 1 ? "" : "s"}</>;
                        })()}
                      </Button>
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setFormError(""); } }}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>New expense</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record an expense</DialogTitle>
                <DialogDescription>
                  {isAdmin ? (
                    <>Two kinds of entries: <strong>member reimbursement</strong> — you spent your own money, upload each bill and the church pays you back after approval — or <strong>church-direct</strong>, a bank auto-debit the admin logs (auto-settled).</>
                  ) : (
                    <>Submit a <strong>member reimbursement</strong> — you spent your own money, upload each bill with its receipt, and the church pays you back after admin approval.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {isAdmin ? (
                  <div className="col-span-2">
                    <Label>Source</Label>
                    <Select
                      value={form.source}
                      onChange={(e) =>
                        setForm({ ...form, source: e.target.value as ExpenseSource })
                      }
                      className="mt-1.5"
                    >
                      <option value="church_direct">Church-direct — auto-debited from bank account (admin)</option>
                      <option value="member_submitted">Member reimbursement — my own money, church pays me back</option>
                    </Select>
                  </div>
                ) : (
                  <div className="col-span-2 flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                    <Banknote className="h-4 w-4 shrink-0 text-emerald-600" />
                    Member reimbursement — the church pays you back after admin approval.
                  </div>
                )}

                {formError && (
                  <div className="col-span-2 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {formError}
                  </div>
                )}

                {/* Payment method (church-direct) */}
                {form.source === "church_direct" && (
                  <>
                  <div>
                    <Label>Payment method</Label>
                    <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="mt-1.5">
                      <option value="online">Online / Auto-debit</option>
                      <option value="check">Check</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                    </Select>
                  </div>
                  {paymentMethod === "check" && (
                    <div>
                      <Label htmlFor="check-no">Check #</Label>
                      <Input id="check-no" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)}
                        className="mt-1.5" placeholder="#4502" />
                    </div>
                  )}
                  </>
                )}
                {form.source !== "member_submitted" && (
                <div>
                  <Label htmlFor="amt">Amount (USD)</Label>
                  <Input
                    id="amt"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="mt-1.5"
                    required
                  />
                </div>
                )}

                <div>
                  <Label htmlFor="cat">Category</Label>
                  <Select
                    id="cat"
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as Expense["category"] })
                    }
                    className="mt-1.5"
                  >
                    {["Facility", "People", "Ministry", "Events", "Travel & booking", "Other"].map((group) => (
                      <optgroup key={group} label={group}>
                        {EXPENSE_CATEGORIES.filter((c) => c.group === group).map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="event-name">Event (optional)</Label>
                  <Input
                    id="event-name"
                    list="event-suggestions"
                    value={form.event_name}
                    onChange={(e) => setForm({ ...form, event_name: e.target.value })}
                    className="mt-1.5"
                    placeholder="e.g. VBS, Annual Conference, Youth Meeting"
                  />
                  <datalist id="event-suggestions">
                    {EVENT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                {/* ── Line items (member_submitted batch bills) ────────── */}
                {form.source === "member_submitted" && (
                  <div className="col-span-2 rounded-lg border border-stone-200 bg-stone-50/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-stone-600">
                        <ListPlus className="h-3.5 w-3.5" /> Bills ({lineItems.length}/10 — add each bill separately)
                      </span>
                      <Button size="sm" variant="outline" onClick={addLineItem} disabled={lineItems.length >= 10}>+ Add bill</Button>
                    </div>
                    {lineItems.length === 0 && (
                      <p className="text-xs text-stone-400">No bills added yet. Click "Add bill" to enter each receipt.</p>
                    )}
                    {lineItems.map((li) => (
                      <div key={li.key} className="mt-2 flex flex-wrap items-start gap-2 rounded border border-stone-200 bg-white p-2">
                        <div className="flex-1 min-w-[140px]">
                          <Label className="text-xs">Description</Label>
                          <Input placeholder="e.g. Groceries for event" value={li.description}
                            onChange={(e) => updateLineItem(li.key, { description: e.target.value })}
                            className="mt-1 h-8 text-sm" />
                        </div>
                        <div className="w-24">
                          <Label className="text-xs">Amount</Label>
                          <Input type="number" min="0" step="0.01" placeholder="0.00" value={li.amount}
                            onChange={(e) => updateLineItem(li.key, { amount: e.target.value })}
                            className="mt-1 h-8 text-sm" />
                        </div>
                        <div className="w-32">
                          <Label className="text-xs">Receipt</Label>
                          <label className="mt-1 flex h-8 cursor-pointer items-center rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-500 hover:bg-stone-50">
                            <Upload className="mr-1 h-3 w-3" />
                            {li.file ? "✓ Uploaded" : "Attach"}
                            <input type="file" accept="image/*,.pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                              onChange={(e) => { if (e.target.files?.[0]) updateLineItem(li.key, { file: e.target.files[0] }); }} />
                          </label>
                        </div>
                        {!li.file && (
                          <div className="w-full">
                            <Label className="text-xs text-amber-700">No receipt? Explain why (required for review)</Label>
                            <Input placeholder="e.g. Lost the paper receipt — paid in cash" value={li.noReceiptNote}
                              onChange={(e) => updateLineItem(li.key, { noReceiptNote: e.target.value })}
                              className="mt-1 h-8 text-sm" />
                          </div>
                        )}
                        <button onClick={() => removeLineItem(li.key)}
                          className="mt-5 rounded p-1 text-stone-400 hover:bg-rose-100 hover:text-rose-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {lineItems.length > 0 && (
                      <div className="mt-2 flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm">
                        <span className="text-stone-600">Reimbursement amount (sum of bills)</span>
                        <span className="font-serif text-lg font-semibold text-emerald-800">{formatCurrency(lineItemTotal)}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="col-span-2">
                  <Label htmlFor="ttl">Title</Label>
                  <Input
                    id="ttl"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="mt-1.5"
                    placeholder="Electricity — December"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="desc">Description</Label>
                  <Textarea
                    id="desc"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="n">Notes</Label>
                  <Input
                    id="n"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                {/* Check image upload */}
                {form.source === "church_direct" && paymentMethod === "check" && (
                  <div className="col-span-2">
                    <Label>Check image</Label>
                    <div className="mt-1.5">
                      <input ref={checkImageRef} type="file" accept="image/*,.pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => { if (e.target.files?.[0]) setCheckImage(e.target.files[0]); }}
                        className="hidden" />
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => checkImageRef.current?.click()}
                        iconLeft={<Upload className="h-4 w-4" />}>
                        {checkImage ? "Change check image" : "Upload check image"}
                      </Button>
                      {checkImage && (
                        <span className="ml-2 text-xs text-emerald-600">✓ {checkImage.name}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Generic receipts — admin church-direct entries only. Members
                    already attach receipts per bill in the Bills section above. */}
                {form.source === "church_direct" && (
                  <div className="col-span-2">
                    <Label>Receipts (optional)</Label>
                    <div className="mt-1.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => {
                          if (e.target.files) {
                            setReceiptFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                          }
                        }}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        iconLeft={<Upload className="h-4 w-4" />}
                      >
                        Attach receipts
                      </Button>
                      {receiptFiles.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {receiptFiles.map((f, i) => (
                            <div
                              key={`${f.name}-${i}`}
                              className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-stone-400" />
                              <span className="flex-1 truncate text-stone-700">{f.name}</span>
                              <span className="text-xs text-stone-400">
                                {(f.size / 1024).toFixed(0)} KB
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setReceiptFiles((prev) => prev.filter((_, j) => j !== i))
                                }
                                className="ml-1 rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-600"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setOpen(false); setReceiptFiles([]); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={saving || uploading}>
                  {uploading
                    ? "Uploading…"
                    : saving
                      ? (form.source === "member_submitted" ? "Submitting…" : "Saving…")
                      : (form.source === "member_submitted" ? "Submit expense" : "Save expense")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      {/* Ask clarification dialog */}
      <Dialog open={clarifyExpense !== null} onOpenChange={(v) => { if (!v) setClarifyExpense(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask for clarification</DialogTitle>
            <DialogDescription>
              Send a note to the submitting member before you approve or reject. The expense stays
              pending until they reply — then you can approve or reject with full information.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="clarify-note">Your question / note</Label>
            <Textarea
              id="clarify-note"
              rows={4}
              value={clarifyNote}
              onChange={(e) => setClarifyNote(e.target.value)}
              className="mt-1.5"
              placeholder="e.g. Could you upload the receipt for the grocery bill? The amount looks higher than expected."
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClarifyExpense(null)}>Cancel</Button>
            <Button onClick={handleRequestClarification} disabled={clarifySaving || !clarifyNote.trim()}>
              {clarifySaving ? "Sending…" : "Send clarification request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear reimbursement — upload bank transfer receipt dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear reimbursement — upload bank transfer receipt</DialogTitle>
            <DialogDescription>
              After making the manual bank transfer to the member, upload the transaction
              receipt here to clear the reimbursement. The member will be notified by email
              and can verify the receipt anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>How is the church paying this reimbursement?</Label>
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="mt-1.5">
                <option value="online">Online / Direct bank transfer</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
              </Select>
            </div>
            <div>
              <Label>Bank transfer receipt</Label>
              <div className="mt-1.5">
                <input
                  ref={transferInputRef}
                  type="file"
                  accept="image/*,.pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setTransferFile(e.target.files[0]);
                  }}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => transferInputRef.current?.click()}
                  iconLeft={<Upload className="h-4 w-4" />}
                >
                  {transferFile ? "Change file" : "Upload transfer receipt"}
                </Button>
                {transferFile && (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-stone-400" />
                    <span className="flex-1 truncate text-stone-700">{transferFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setTransferFile(null)}
                      className="rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <Banknote className="mb-1 h-4 w-4" />
              This clears the reimbursement: the expense is marked paid, the transfer
              receipt is attached for auditing, and the submitting member is notified by email.
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setPayOpen(false); setTransferFile(null); }}>
              Cancel
            </Button>
            <Button onClick={handleMarkPaid} disabled={paySaving}>
              {paySaving ? "Saving…" : "Confirm & clear reimbursement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit expense record dialog */}
      <Dialog open={editExpense !== null} onOpenChange={(v) => { if (!v) setEditExpense(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit expense record</DialogTitle>
            <DialogDescription>
              Correct the details of this record — description, category, amount, or the statement date. Changes flow into the ledger, reports, and member statements.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editError && (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertTriangle className="h-4 w-4" /> {editError}
              </div>
            )}
            <div>
              <Label htmlFor="edit-title">Title / payee</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. PURCHASE ZOOM.COM"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-desc">Description</Label>
              <Input
                id="edit-desc"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Full description from the statement"
                className="mt-1.5"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="edit-amount">Amount</Label>
                <Input
                  id="edit-amount"
                  type="number" min="0.01" step="0.01"
                  value={editForm.amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="edit-date">Statement date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="edit-method">Method</Label>
                <Select
                  id="edit-method"
                  value={editForm.paymentMethod}
                  onChange={(e) => setEditForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  className="mt-1.5"
                >
                  <option value="">—</option>
                  <option value="online">Online / Zelle</option>
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-category">Category</Label>
                <Select
                  id="edit-category"
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value as Expense["category"] }))}
                  className="mt-1.5"
                >
                  {EXPENSE_CATEGORIES.reduce<{ group: string; items: typeof EXPENSE_CATEGORIES }[]>((acc, c) => {
                    const g = acc.find((x) => x.group === c.group);
                    if (g) g.items.push(c); else acc.push({ group: c.group, items: [c] });
                    return acc;
                  }, []).map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div>
                {editForm.paymentMethod === "check" ? (
                  <>
                    <Label htmlFor="edit-check">Check #</Label>
                    <Input
                      id="edit-check"
                      value={editForm.checkNumber}
                      onChange={(e) => setEditForm((f) => ({ ...f, checkNumber: e.target.value }))}
                      className="mt-1.5"
                    />
                  </>
                ) : editForm.paymentMethod === "card" ? (
                  <>
                    <Label htmlFor="edit-card">Card last 4</Label>
                    <Input
                      id="edit-card"
                      value={editForm.cardLast4}
                      maxLength={4}
                      onChange={(e) => setEditForm((f) => ({ ...f, cardLast4: e.target.value.replace(/\D/g, "") }))}
                      className="mt-1.5"
                    />
                  </>
                ) : (
                  <div>
                    <Label>Event (optional)</Label>
                    <Input
                      value={editForm.eventName}
                      onChange={(e) => setEditForm((f) => ({ ...f, eventName: e.target.value }))}
                      placeholder="e.g. VBS, Sunday Snacks"
                      className="mt-1.5"
                    />
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="edit-member">Member (reimbursement)</Label>
              <Select
                id="edit-member"
                value={editForm.memberId}
                onChange={(e) => setEditForm((f) => ({ ...f, memberId: e.target.value }))}
                className="mt-1.5"
              >
                <option value="">Church-direct — not a member reimbursement</option>
                {memberOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-stone-400">Link this expense to a member and it shows under their "My expenses" as a settled reimbursement.</p>
            </div>
            <div>
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                className="mt-1.5"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditExpense(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving</> : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete expense confirm dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this expense?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{deleteTarget?.title ?? "this expense"}</strong>{deleteTarget ? ` (${formatCurrency(deleteTarget.amount)})` : ""} from the ledger, reports, and any linked member records. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDeleteExpense} disabled={deleteSaving}>
              {deleteSaving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Deleting</> : "Delete expense"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Expense audit viewer */}
      <ReceiptViewer
        expense={viewExpense}
        open={viewExpense !== null}
        onOpenChange={(v) => { if (!v) setViewExpense(null); }}
      />

      {/* ── Date range & method filter ─────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="border-b border-stone-100">
          <div className="flex items-center gap-2 text-sm">
            <CalendarRange className="h-4 w-4 text-stone-400" />
            <span className="text-stone-500">Filter by date range & method</span>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="exp-from">From</Label>
              <Input id="exp-from" type="date" value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)} className="mt-1.5 w-44" />
            </div>
            <div>
              <Label htmlFor="exp-to">To</Label>
              <Input id="exp-to" type="date" value={dateTo}
                onChange={(e) => setDateTo(e.target.value)} className="mt-1.5 w-44" />
            </div>
            <div>
              <Label htmlFor="exp-method">Payment method</Label>
              <Select id="exp-method" value={filterMethod}
                onChange={(e) => setFilterMethod(e.target.value)} className="mt-1.5 w-36">
                <option value="all">All methods</option>
                <option value="online">Online</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="debit">Debit</option>
              </Select>
            </div>
            {(dateFrom || dateTo || filterMethod !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setFilterMethod("all"); }}>
                Clear
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {canSeeAll && (
            <TabsTrigger value="my">
              My expenses
              {(myPending > 0 || myReimbursed > 0) && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[10px]">
                  {myPending > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">{myPending} pending</span>
                  )}
                  {myReimbursed > 0 && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">{formatCurrency(myReimbursed)} paid</span>
                  )}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="member_submitted">Member-side</TabsTrigger>
          {isAdmin && <TabsTrigger value="church_direct">Church-direct</TabsTrigger>}
        </TabsList>

        <TabsContent value="all">
          <ExpenseList
            rows={filtered}
            canAct={isAdmin}
            title={canSeeAll ? "All expenses" : "My reimbursements"}
            onTransition={transition}
            onMarkPaid={openPayDialog}
            onView={setViewExpense}
            onClarify={(e) => { setClarifyExpense(e); setClarifyNote(""); }}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            statusTone={statusTone}
            hideSource={!canSeeAll}
          />
        </TabsContent>
        {canSeeAll && (
          <TabsContent value="my">
            <ExpenseList
              rows={myExpenses}
              canAct={isAdmin}
              title={`My reimbursements${myExpenses.length > 0 ? ` \u00b7 ${formatCurrency(myExpenses.reduce((s, e) => s + Number(e.amount || 0), 0))} total` : ""}`}
              onTransition={transition}
              onMarkPaid={openPayDialog}
              onView={setViewExpense}
              onClarify={(e) => { setClarifyExpense(e); setClarifyNote(""); }}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              statusTone={statusTone}
              hideSource
            />
          </TabsContent>
        )}
        <TabsContent value="member_submitted">
          <ExpenseList
            rows={filtered.filter((e) => e.source === "member_submitted")}
            canAct={isAdmin}
            title={canSeeAll ? "Member reimbursements" : "My reimbursements"}
            onTransition={transition}
            onMarkPaid={openPayDialog}
            onView={setViewExpense}
            onClarify={(e) => { setClarifyExpense(e); setClarifyNote(""); }}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            statusTone={statusTone}
            hideSource
          />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="church_direct">
            <ExpenseList
              rows={filtered.filter((e) => e.source === "church_direct")}
              canAct
              title="Church-direct expenses"
              onTransition={transition}
              onMarkPaid={openPayDialog}
              onView={setViewExpense}
              onClarify={(e) => { setClarifyExpense(e); setClarifyNote(""); }}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              statusTone={statusTone}
              hideSource
            />
          </TabsContent>
        )}
      </Tabs>

      {!supabase && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Running with mock data. Connect Supabase to persist entries across team members.
        </div>
      )}
    </div>
  );
}

function ExpenseList({
  rows,
  canAct,
  title,
  onTransition,
  onMarkPaid,
  onView,
  onClarify,
  onEdit,
  onDelete,
  statusTone,
  hideSource,
}: {
  rows: Expense[];
  /** Only the admin trio gets review actions (Ask/Approve/Reject/Clear).
   *  Pastors see every row read-only; members only see their own submission. */
  canAct: boolean;
  title: string;
  onTransition: (id: string, status: ExpenseStatus) => void;
  onMarkPaid: (id: string) => void;
  onView: (e: Expense) => void;
  onClarify: (e: Expense) => void;
  onEdit?: (e: Expense) => void;
  onDelete?: (e: Expense) => void;
  statusTone: (s: ExpenseStatus) => "neutral" | "indigo" | "amber" | "emerald" | "rose";
  hideSource?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ReceiptIcon className="h-6 w-6" />}
        title="No expenses here yet"
        description="Once expenses are logged they'll appear in this list."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <h2 className="font-serif text-lg font-semibold text-stone-900">{title}</h2>
      </CardHeader>
      <CardBody className="px-0 py-2">
        <TableWrap className="min-w-[640px] border-0 shadow-none">
          <THead>
            <Tr>
              <Th>Title</Th>
              <Th>Category</Th>
              {!hideSource && <Th>Source</Th>}
              <Th>Method</Th>
              <Th>Status</Th>
              <Th className="text-right">Amount</Th>
              <Th>Actions</Th>
            </Tr>
          </THead>
          <tbody>
            {rows.map((e) => (
              <Tr key={e.id}>
                <Td>
                  <div className="font-medium text-stone-900">
                    {e.title ?? e.description?.slice(0, 60) ?? "—"}
                  </div>
                  <div className="text-xs text-stone-500">Logged {formatDate(e.submitted_at)}</div>
                  {e.transfer_receipt_path && (
                    <div className="mt-1 text-xs text-emerald-700">✓ Transfer receipt attached</div>
                  )}
                  {normalizeLineItems(e.line_items).length > 0 && (
                    <div className="mt-1 text-xs text-stone-500">
                      {normalizeLineItems(e.line_items).length} bill{normalizeLineItems(e.line_items).length === 1 ? "" : "s"} attached
                    </div>
                  )}
                  <ReceiptThumbs
                    paths={[
                      ...normalizeLineItems(e.line_items).map((li) => li.receipt_path).filter((p): p is string => !!p),
                      ...(e.receipt_paths ?? []),
                    ]}
                    onOpen={() => onView(e)}
                  />
                  {e.admin_note && !e.member_reply && (
                    <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                      <MessageSquare className="h-3 w-3" /> Clarification requested
                    </div>
                  )}
                  {e.member_reply && (
                    <div className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Member replied
                    </div>
                  )}
                </Td>
                <Td>
                  <span className="text-stone-600">{e.category}</span>
                </Td>
                {!hideSource && (
                  <Td>
                    <Badge tone={e.source === "church_direct" ? "indigo" : "neutral"}>
                      {e.source === "church_direct" ? "Direct" : "Submitted"}
                    </Badge>
                  </Td>
                )}
                <Td>
                  <span className="text-xs text-stone-500 capitalize">
                    {e.payment_method || "—"}
                    {e.card_last4 ? ` · card ${e.card_last4}` : ""}
                    {e.check_number ? ` · check #${e.check_number}` : ""}
                  </span>
                </Td>
                <Td>
                  <Badge tone={statusTone(e.status)}>{e.status.replace("_", " ")}</Badge>
                </Td>
                <Td className="text-right font-serif text-base font-semibold text-stone-900">
                  {formatCurrency(e.amount)}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onView(e)}
                      iconLeft={<Eye className="h-3.5 w-3.5" />}
                    >
                      View
                    </Button>
                    {onEdit && canAct && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(e)}
                        iconLeft={<Pencil className="h-3.5 w-3.5" />}
                      >
                        Edit
                      </Button>
                    )}
                    {onDelete && canAct && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(e)}
                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                      >
                        Delete
                      </Button>
                    )}
                    {canAct && e.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onClarify(e)}
                          iconLeft={<MessageSquare className="h-3.5 w-3.5" />}
                          title="Ask the member a question before approving or rejecting"
                        >
                          Ask
                        </Button>
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => onTransition(e.id, "approved")}
                          iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => onTransition(e.id, "rejected")}
                          iconLeft={<XCircle className="h-3.5 w-3.5" />}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {canAct && e.status === "approved" && (
                      <Button
                        size="sm"
                        variant="warm"
                        onClick={() => onMarkPaid(e.id)}
                        iconLeft={<Banknote className="h-3.5 w-3.5" />}
                      >
                        Clear reimbursement
                      </Button>
                    )}
                    {!canAct && e.status === "pending" && (
                      <span className="text-xs text-stone-400">Awaiting admin review</span>
                    )}
                    {!canAct && e.status === "approved" && (
                      <span className="text-xs text-amber-700">Awaiting payment</span>
                    )}
                    {e.status === "rejected" && (
                      <span className="text-xs text-stone-400">— no further action</span>
                    )}
                    {(e.status === "paid" || e.status === "auto_paid") && (
                      <span className="text-xs text-emerald-700">
                        ✓ settled {formatDate(e.paid_at)}
                      </span>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </CardBody>
    </Card>
  );
}
