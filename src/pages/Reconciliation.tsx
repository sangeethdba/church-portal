import { useEffect, useMemo, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import {
  CheckCircle,
  Circle,
  Calculator,
  CalendarRange,
  Banknote,
  Receipt,
  Plus,
  Save,
  Lock,
} from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Label,
  EmptyState,
  Badge,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isAdminRole } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

/* ── Types ─────────────────────────────────────────────────────────── */
type ReconItem = {
  id: string;
  reconciliation_id: string;
  entity_type: "deposit" | "expense";
  entity_id: string;
  is_cleared: boolean;
  cleared_at: string | null;
  // joined fields
  date?: string;
  label?: string;
  amount?: number;
  method?: string;
};

type Recon = {
  id: string;
  period_start: string;
  period_end: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
};

/* ── Component ──────────────────────────────────────────────────────── */
export default function Reconciliation() {
  const ctx = useOutletContext<{ profile: { id?: string; role?: string } | null }>();
  const isAdmin = isAdminRole(ctx.profile?.role);

  const [recons, setRecons] = useState<Recon[]>([]);
  const [activeRecon, setActiveRecon] = useState<Recon | null>(null);
  const [items, setItems] = useState<ReconItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // new recon form
  const [showNew, setShowNew] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadRecons = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase
      .from("bank_reconciliations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setRecons((data as Recon[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRecons();
  }, [loadRecons]);

  const openRecon = useCallback(
    async (recon: Recon) => {
      setActiveRecon(recon);
      if (!supabase) return;

      // Fetch existing items
      const { data: existing } = await supabase
        .from("reconciliation_items")
        .select("*")
        .eq("reconciliation_id", recon.id)
        .order("entity_type");

      const existingItems = (existing as ReconItem[]) ?? [];

      // If no items yet (first open), auto-populate from deposits & expenses
      if (existingItems.length === 0) {
        // Deposits: offerings with deposit_status = 'deposited' in date range
        const { data: deposits } = await supabase
          .from("offerings")
          .select("id, service_date, total")
          .eq("deposit_status", "deposited")
          .gte("service_date", recon.period_start)
          .lte("service_date", recon.period_end)
          .order("service_date");

        // Expenses: paid/auto_paid in date range
        const { data: expenses } = await supabase
          .from("expenses")
          .select("id, title, description, amount, payment_method, paid_at, status")
          .in("status", ["paid", "auto_paid"])
          .gte("paid_at", recon.period_start)
          .lte("paid_at", `${recon.period_end}T23:59:59.999Z`)
          .order("paid_at");

        const insertItems: {
          reconciliation_id: string;
          entity_type: string;
          entity_id: string;
        }[] = [];

        (deposits ?? []).forEach((d: Record<string, unknown>) =>
          insertItems.push({
            reconciliation_id: recon.id,
            entity_type: "deposit",
            entity_id: d.id as string,
          }),
        );

        (expenses ?? []).forEach((e: Record<string, unknown>) =>
          insertItems.push({
            reconciliation_id: recon.id,
            entity_type: "expense",
            entity_id: e.id as string,
          }),
        );

        if (insertItems.length > 0) {
          await supabase.from("reconciliation_items").insert(insertItems);
        }

        // Re-fetch after insert
        const { data: fresh } = await supabase
          .from("reconciliation_items")
          .select("*")
          .eq("reconciliation_id", recon.id)
          .order("entity_type");

        // Enrich with join data
        const enriched = await enrichItems(
          fresh as ReconItem[],
          deposits as Record<string, unknown>[],
          expenses as Record<string, unknown>[],
        );
        setItems(enriched);
      } else {
        // Enrich existing items
        const { data: deposits } = await supabase
          .from("offerings")
          .select("id, service_date, total")
          .in(
            "id",
            existingItems.filter((i) => i.entity_type === "deposit").map((i) => i.entity_id),
          );

        const { data: expenses } = await supabase
          .from("expenses")
          .select("id, title, description, amount, payment_method, paid_at, status")
          .in(
            "id",
            existingItems.filter((i) => i.entity_type === "expense").map((i) => i.entity_id),
          );

        const enriched = await enrichItems(
          existingItems,
          deposits as Record<string, unknown>[],
          expenses as Record<string, unknown>[],
        );
        setItems(enriched);
      }
    },
    [],
  );

  // Enrich items with join data
  const enrichItems = async (
    raw: ReconItem[],
    deposits: Record<string, unknown>[],
    expenses: Record<string, unknown>[],
  ): Promise<ReconItem[]> => {
    const depMap = new Map(deposits.map((d) => [d.id as string, d]));
    const expMap = new Map(expenses.map((e) => [e.id as string, e]));
    return raw.map((item) => {
      if (item.entity_type === "deposit") {
        const d = depMap.get(item.entity_id);
        return {
          ...item,
          date: d?.service_date as string,
          label: `Sunday Offering`,
          amount: Number(d?.total ?? 0),
          method: "deposit",
        };
      } else {
        const e = expMap.get(item.entity_id);
        return {
          ...item,
          date: e?.paid_at as string,
          label: (e?.title ?? e?.description ?? "Expense") as string,
          amount: Number(e?.amount ?? 0),
          method: (e?.payment_method ?? "unknown") as string,
        };
      }
    });
  };

  const toggleCleared = async (item: ReconItem) => {
    if (!supabase || !activeRecon || activeRecon.status === "closed") return;
    const newCleared = !item.is_cleared;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, is_cleared: newCleared, cleared_at: newCleared ? new Date().toISOString() : null }
          : i,
      ),
    );
    await supabase
      .from("reconciliation_items")
      .update({
        is_cleared: newCleared,
        cleared_at: newCleared ? new Date().toISOString() : null,
      })
      .eq("id", item.id);
  };

  const handleCreate = async () => {
    if (!supabase || !fromDate || !toDate) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("bank_reconciliations")
      .insert({
        period_start: fromDate,
        period_end: toDate,
        status: "open",
      })
      .select()
      .maybeSingle();
    if (data) {
      const recon = data as Recon;
      setRecons((prev) => [recon, ...prev]);
      setShowNew(false);
      setFromDate("");
      setToDate("");
      await openRecon(recon);
    } else if (error) {
      console.warn("Create reconciliation failed:", error);
    }
    setSaving(false);
  };

  const handleClose = async () => {
    if (!supabase || !activeRecon) return;
    await supabase
      .from("bank_reconciliations")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", activeRecon.id);
    setActiveRecon(null);
    setItems([]);
    loadRecons();
  };

  // Computed totals
  const depositItems = items.filter((i) => i.entity_type === "deposit");
  const expenseItems = items.filter((i) => i.entity_type === "expense");
  const clearedDeposits = depositItems.filter((i) => i.is_cleared).reduce((s, i) => s + (i.amount ?? 0), 0);
  const clearedExpenses = expenseItems.filter((i) => i.is_cleared).reduce((s, i) => s + (i.amount ?? 0), 0);
  const unclearedDeposits = depositItems.filter((i) => !i.is_cleared).reduce((s, i) => s + (i.amount ?? 0), 0);
  const unclearedExpenses = expenseItems.filter((i) => !i.is_cleared).reduce((s, i) => s + (i.amount ?? 0), 0);
  const netCleared = clearedDeposits - clearedExpenses;

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-6 py-16 text-center">
        <Calculator className="mb-3 h-10 w-10 text-amber-400" />
        <h2 className="font-serif text-xl font-semibold text-stone-800">Access restricted</h2>
        <p className="mt-2 max-w-md text-sm text-stone-500">
          Bank reconciliation is managed by the church finance team.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bank reconciliation"
        subtitle="Match recorded deposits and expenses against your bank statement period by period."
        badge={activeRecon ? "Active" : `${recons.length} periods`}
        actions={
          !activeRecon && (
            <Button
              iconLeft={<Plus className="h-4 w-4" />}
              onClick={() => setShowNew(true)}
            >
              New reconciliation
            </Button>
          )
        }
      />

      {/* New recon form */}
      {showNew && (
        <Card className="mb-6 border-indigo-200 bg-indigo-50/30">
          <CardBody className="flex flex-wrap items-end gap-4 py-4">
            <div>
              <Label>Period start</Label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1.5 h-10 rounded-md border border-stone-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>
            <div>
              <Label>Period end</Label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1.5 h-10 rounded-md border border-stone-200 bg-white px-3 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>
            <Button onClick={handleCreate} disabled={saving || !fromDate || !toDate}>
              {saving ? "Creating…" : "Start reconciliation"}
            </Button>
            <Button variant="ghost" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Active reconciliation */}
      {activeRecon && (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardBody className="py-3 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                  Cleared deposits
                </div>
                <div className="font-serif text-lg font-semibold text-emerald-700">
                  {formatCurrency(clearedDeposits)}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="py-3 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                  Cleared expenses
                </div>
                <div className="font-serif text-lg font-semibold text-rose-700">
                  {formatCurrency(clearedExpenses)}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="py-3 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                  Net cleared
                </div>
                <div
                  className={`font-serif text-lg font-semibold ${netCleared >= 0 ? "text-indigo-700" : "text-rose-700"}`}
                >
                  {formatCurrency(netCleared)}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="py-3 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                  Uncleared in
                </div>
                <div className="font-serif text-lg font-semibold text-amber-700">
                  {formatCurrency(unclearedDeposits)}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="py-3 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                  Uncleared out
                </div>
                <div className="font-serif text-lg font-semibold text-amber-700">
                  {formatCurrency(unclearedExpenses)}
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Two-column checklist */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Deposits */}
            <Card>
              <CardHeader>
                <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-stone-900">
                  <Banknote className="h-5 w-5 text-emerald-600" />
                  Deposits ({depositItems.length})
                </h2>
              </CardHeader>
              <CardBody className="space-y-1">
                {depositItems.length === 0 ? (
                  <div className="py-6 text-center text-sm text-stone-400">
                    No deposits in this period
                  </div>
                ) : (
                  depositItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleCleared(item)}
                      disabled={activeRecon.status === "closed"}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                        item.is_cleared
                          ? "bg-emerald-50"
                          : "hover:bg-stone-50"
                      } ${activeRecon.status === "closed" ? "cursor-default" : "cursor-pointer"}`}
                    >
                      {item.is_cleared ? (
                        <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-stone-300" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-medium ${item.is_cleared ? "text-emerald-800" : "text-stone-900"}`}
                        >
                          {item.label}
                        </div>
                        <div className="text-xs text-stone-500">
                          {item.date ? formatDate(item.date) : ""}
                          {item.method ? ` · ${item.method}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 font-serif text-sm font-semibold text-stone-700">
                        {formatCurrency(item.amount ?? 0)}
                      </span>
                    </button>
                  ))
                )}
              </CardBody>
            </Card>

            {/* Expenses */}
            <Card>
              <CardHeader>
                <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-stone-900">
                  <Receipt className="h-5 w-5 text-rose-600" />
                  Expenses ({expenseItems.length})
                </h2>
              </CardHeader>
              <CardBody className="space-y-1">
                {expenseItems.length === 0 ? (
                  <div className="py-6 text-center text-sm text-stone-400">
                    No expenses in this period
                  </div>
                ) : (
                  expenseItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleCleared(item)}
                      disabled={activeRecon.status === "closed"}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                        item.is_cleared
                          ? "bg-emerald-50"
                          : "hover:bg-stone-50"
                      } ${activeRecon.status === "closed" ? "cursor-default" : "cursor-pointer"}`}
                    >
                      {item.is_cleared ? (
                        <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-stone-300" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-sm font-medium ${item.is_cleared ? "text-emerald-800" : "text-stone-900"}`}
                        >
                          {item.label}
                        </div>
                        <div className="text-xs text-stone-500">
                          {item.date ? formatDate(item.date.slice(0, 10)) : ""}
                          {item.method ? ` · ${item.method}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 font-serif text-sm font-semibold text-stone-700">
                        {formatCurrency(item.amount ?? 0)}
                      </span>
                    </button>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          {/* Action bar */}
          <div className="mt-6 flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
            <div className="text-sm text-stone-500">
              {activeRecon.status === "closed" ? (
                <Badge tone="emerald">Closed · {activeRecon.closed_at ? formatDate(activeRecon.closed_at) : ""}</Badge>
              ) : (
                <Badge tone="amber">Open · {items.filter((i) => i.is_cleared).length}/{items.length} cleared</Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                iconLeft={<Save className="h-4 w-4" />}
                onClick={() => {
                  setActiveRecon(null);
                  setItems([]);
                }}
              >
                Save & back
              </Button>
              {activeRecon.status === "open" && (
                <Button
                  iconLeft={<Lock className="h-4 w-4" />}
                  onClick={handleClose}
                >
                  Finish & close
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Past reconciliations list */}
      {!activeRecon && !loading && (
        <>
          {recons.length === 0 ? (
            <EmptyState
              icon={<Calculator className="h-6 w-6" />}
              title="No reconciliations yet"
              description="Start your first bank reconciliation to match recorded transactions against your bank statement."
            />
          ) : (
            <div className="space-y-2">
              {recons.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openRecon(r)}
                  className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/30"
                >
                  <div className="flex items-center gap-3">
                    <Calculator className="h-5 w-5 text-stone-400" />
                    <div>
                      <div className="font-medium text-stone-900">
                        {formatDate(r.period_start)} – {formatDate(r.period_end)}
                      </div>
                      <div className="text-xs text-stone-500">
                        Created {formatDate(r.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={r.status === "closed" ? "emerald" : "amber"}>
                      {r.status}
                    </Badge>
                    {r.closed_at && (
                      <span className="text-xs text-stone-400">
                        Closed {formatDate(r.closed_at)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
