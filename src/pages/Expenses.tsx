import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, CheckCircle2, XCircle, Receipt as ReceiptIcon, Sparkles, Upload, Paperclip, X, Banknote, Trash2, ListPlus, Eye, CalendarRange, AlertTriangle, MessageSquare } from "lucide-react";
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
      if (error) console.warn("Update expense failed:", error);
    }
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
      await supabase.rpc("admin_update_expense", {
        p_expense_id: payExpenseId,
        p_status: "paid",
        p_payment_method: payMethod,
        p_transfer_receipt_path: transferPath,
      });
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

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track what flows out — both member reimbursements and church-direct outlays."
        badge={`${formatCurrency(total)} total · ${pending} pending`}
        actions={
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
                  <span className="text-xs text-stone-500 capitalize">{e.payment_method || "—"}</span>
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
