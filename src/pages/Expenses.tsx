import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, CheckCircle2, XCircle, Receipt as ReceiptIcon, Sparkles, Upload, Paperclip, X } from "lucide-react";
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
import { supabase, type Expense, type ExpenseSource, type ExpenseStatus } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

const sampleExpenses: Expense[] = [
  {
    id: "demo-e1",
    source: "church_direct",
    title: "Electricity — November",
    amount: 184.32,
    category: "utilities",
    description: "Monthly utility bill",
    receipt_paths: [],
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

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>(sampleExpenses);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    source: "church_direct" as ExpenseSource,
    title: "",
    amount: "",
    category: "other" as Expense["category"],
    description: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from("expenses")
      .select("*")
      .order("submitted_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setExpenses(data as Expense[]);
        setLoading(false);
      });
  }, []);

  const [showOnlyDirection, setShowOnlyDirection] = useState<"all" | ExpenseSource>("all");

  const filtered = useMemo(
    () => expenses.filter((e) => showOnlyDirection === "all" || e.source === showOnlyDirection),
    [expenses, showOnlyDirection],
  );
  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
  const pending = expenses.filter((e) => e.status === "pending").length;

  const transition = async (id: string, status: ExpenseStatus) => {
    const patch: Partial<Expense> = { status };
    if (status === "approved") patch.approved_at = new Date().toISOString();
    if (status === "paid" || status === "auto_paid") {
      patch.paid_at = new Date().toISOString();
    }
    setExpenses((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (supabase) {
      const { error } = await supabase.from("expenses").update(patch).eq("id", id);
      if (error) console.warn("Update expense failed:", error);
    }
  };

  const uploadReceipts = async (expenseId: string): Promise<string[]> => {
    if (!supabase || receiptFiles.length === 0) return [];
    const paths: string[] = [];
    for (const file of receiptFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${expenseId}/${Date.now()}-${safeName}`;
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
    const value = Number(form.amount);
    if (!value || value <= 0) {
      setSaving(false);
      return;
    }
    const baseRow: Expense = {
      id: `local-${Date.now()}`,
      source: form.source,
      title: form.title || (form.source === "church_direct" ? null : form.description?.slice(0, 60)),
      amount: value,
      category: form.category,
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
    };
    if (supabase) {
      const { data, error } = await supabase
        .from("expenses")
        .insert({
          source: baseRow.source,
          title: baseRow.title,
          amount: baseRow.amount,
          category: baseRow.category,
          description: baseRow.description,
          notes: baseRow.notes,
          status: baseRow.status,
        })
        .select()
        .maybeSingle();
      if (data) {
        const expense = data as Expense;
        // Upload receipts if any files were attached
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
      if (error) console.warn("Insert expense failed:", error);
    } else {
      setExpenses((rows) => [baseRow, ...rows]);
    }
    setSaving(false);
    setOpen(false);
    setReceiptFiles([]);
    setForm({
      source: "church_direct",
      title: "",
      amount: "",
      category: "other",
      description: "",
      notes: "",
    });
  };

  const statusTone = (s: ExpenseStatus) =>
    s === "auto_paid" || s === "paid"
      ? "emerald"
      : s === "rejected"
        ? "rose"
        : s === "approved"
          ? "indigo"
          : "amber";

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track what flows out — both member reimbursements and church-direct outlays."
        badge={`${formatCurrency(total)} total · ${pending} pending`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>New expense</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record an expense</DialogTitle>
                <DialogDescription>
                  Church-admin entries are auto-flagged as auto-paid once logged.
                  Member-submitted refunds stay pending until a treasurer approves them.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Source</Label>
                  <Select
                    value={form.source}
                    onChange={(e) =>
                      setForm({ ...form, source: e.target.value as ExpenseSource })
                    }
                    className="mt-1.5"
                  >
                    <option value="church_direct">Church-direct (admin/treasurer)</option>
                    <option value="member_submitted">Member-submitted reimbursement</option>
                  </Select>
                </div>
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
                    <option value="utilities">Utilities</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="supplies">Supplies</option>
                    <option value="missions">Missions</option>
                    <option value="events">Events</option>
                    <option value="staff">Staff</option>
                    <option value="benevolence">Benevolence</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
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
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setOpen(false); setReceiptFiles([]); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={saving || uploading}>
                  {uploading ? "Uploading…" : saving ? "Saving…" : "Save expense"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="member_submitted">Member-side</TabsTrigger>
          <TabsTrigger value="church_direct">Church-direct</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <ExpenseList
            rows={filtered}
            onTransition={transition}
            statusTone={statusTone}
          />
        </TabsContent>
        <TabsContent value="member_submitted">
          <ExpenseList
            rows={filtered.filter((e) => e.source === "member_submitted")}
            onTransition={transition}
            statusTone={statusTone}
            hideSource
          />
        </TabsContent>
        <TabsContent value="church_direct">
          <ExpenseList
            rows={filtered.filter((e) => e.source === "church_direct")}
            onTransition={transition}
            statusTone={statusTone}
            hideSource
          />
        </TabsContent>
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
  onTransition,
  statusTone,
  hideSource,
}: {
  rows: Expense[];
  onTransition: (id: string, status: ExpenseStatus) => void;
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
        <h2 className="font-serif text-lg font-semibold text-stone-900">All expenses</h2>
      </CardHeader>
      <CardBody className="px-0 py-2">
        <TableWrap className="border-0 shadow-none">
          <THead>
            <Tr>
              <Th>Title</Th>
              <Th>Category</Th>
              {!hideSource && <Th>Source</Th>}
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
                  <Badge tone={statusTone(e.status)}>{e.status.replace("_", " ")}</Badge>
                </Td>
                <Td className="text-right font-serif text-base font-semibold text-stone-900">
                  {formatCurrency(e.amount)}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {e.status === "pending" && (
                      <>
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
                    {e.status === "approved" && (
                      <Button
                        size="sm"
                        variant="warm"
                        onClick={() => onTransition(e.id, "auto_paid")}
                        iconLeft={<Sparkles className="h-3.5 w-3.5" />}
                      >
                        Mark auto-paid
                      </Button>
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
