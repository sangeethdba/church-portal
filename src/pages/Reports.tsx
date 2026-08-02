import { useEffect, useMemo, useState } from "react";
import { BarChart3, TrendingUp, CircleDollarSign, Receipt, PieChart, CalendarDays, Download } from "lucide-react";
import {
  Button, Card, CardBody, CardHeader, Select,
  Badge, EmptyState, TableWrap, THead, Tr, Th, Td, Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, EXPENSE_CATEGORIES, type Donation, type Expense } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { buildIncomeByMethod, buildWeeklyLedgerDetail } from "@/lib/accounting";

type Period = "this_week" | "this_month" | "this_year" | "all";

// Weeks are keyed by their Sunday start; show the full Sun–Sat range so an
// offering recorded late in the week (e.g. Sat Aug 01) is clearly visible.
function weekRangeLabel(week: string): string {
  const start = new Date(week + "T12:00:00");
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

type OfferingRow = {
  id: string;
  service_date: string;
  service_name: string;
  cash_amount: number;
  cash_net?: number;
  cash_deductions?: Array<{ reason?: string; amount?: number }> | null;
  check_amount: number;
  total_amount: number;
  check_count?: number;
  deposit_status?: string;
};

const periodLabel: Record<Period, string> = {
  this_week: "This week",
  this_month: "This month",
  this_year: "This year",
  all: "All time",
};

function periodRange(p: Period): { start: string; label: string } {
  const now = new Date();
  if (p === "this_week") {
    // Sunday-start week computed in UTC so it matches the weekly buckets.
    const day = now.getUTCDay();
    const sun = new Date(now.getTime() - day * 86400000);
    return { start: sun.toISOString().slice(0, 10), label: "Sun – today" };
  }
  if (p === "this_month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
      label: `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`,
    };
  }
  if (p === "this_year") {
    return {
      start: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
      label: `${now.getFullYear()}`,
    };
  }
  return { start: "2000-01-01", label: "All time" };
}

const CATEGORY_COLORS = [
  "#4f46e5", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4",
  "#f97316", "#84cc16", "#ec4899", "#14b8a6", "#6366f1", "#eab308",
  "#a855f7", "#22c55e", "#f43f5e", "#0ea5e9", "#d946ef", "#facc15",
  "#2dd4bf", "#fb923c", "#a3e635", "#60a5fa", "#f472b6", "#94a3b8",
];

const catLabel = (c: string) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? c.replace(/_/g, " ");

/* ── Minimal SVG donut (no chart dependency) ─────────────────────────── */
function polar(cx: number, cy: number, r: number, angle: number) {
  const a = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

function DonutChart({
  slices,
  total,
  size = 230,
  thickness = 30,
}: {
  slices: { label: string; value: number; color: string }[];
  total: number;
  size?: number;
  thickness?: number;
}) {
  const c = size / 2;
  const r = (size - thickness) / 2;
  const active = slices.filter((s) => s.value > 0);
  let angle = 0;
  const arcs = active.map((s) => {
    const start = angle;
    const sweep = total > 0 ? (s.value / total) * 360 : 0;
    const end = angle + sweep - (active.length > 1 ? 1.4 : 0);
    angle += sweep;
    return { ...s, start, end };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Expenses by category" className="mx-auto">
      <circle cx={c} cy={c} r={r} fill="none" stroke="#e7e5e4" strokeWidth={thickness} />
      {arcs.map((a) => (
        <path key={a.label} d={arcPath(c, c, r, a.start, a.end)} fill="none" stroke={a.color} strokeWidth={thickness} />
      ))}
      <text x={c} y={c - 2} textAnchor="middle" style={{ fontSize: 17, fontWeight: 700, fontFamily: "Georgia, serif" }} fill="#1c1917">
        {formatCurrency(total)}
      </text>
      <text x={c} y={c + 14} textAnchor="middle" style={{ fontSize: 10 }} fill="#78716c">
        total spend
      </text>
    </svg>
  );
}

export default function Reports() {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [offerings, setOfferings] = useState<OfferingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("this_year");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    // Use security-definer RPC to bypass fragile RLS chain
    supabase.rpc("get_reports_data").then(({ data, error }) => {
      if (error) { console.warn("Reports query failed:", error); setLoading(false); return; }
      const result = data as { donations: Array<Record<string, unknown>>; expenses: Array<Record<string, unknown>>; offerings: Array<Record<string, unknown>> };
      if (result) {
        setDonations((result.donations ?? []).map(r => ({
          id: r.id, donor_id: r.donor_id, donor_name: r.donor_name, donor_email: r.donor_email,
          amount: Number(r.amount ?? 0), donation_type: r.donation_type, payment_method: r.payment_method,
          check_number: r.check_number, donation_date: r.donation_date, entered_by: r.entered_by,
          notes: r.notes, created_at: r.created_at, offering_id: r.offering_id,
        })) as Donation[]);
        setExpenses((result.expenses ?? []).map(r => ({
          id: r.id, source: r.source, title: r.title, amount: Number(r.amount ?? 0),
          category: r.category, description: r.description, receipt_paths: r.receipt_paths,
          transfer_receipt_path: r.transfer_receipt_path, user_id: r.user_id, status: r.status,
          submitted_at: r.submitted_at, approved_by: r.approved_by, approved_at: r.approved_at,
          paid_at: r.paid_at, paid_by: r.paid_by, notes: r.notes, created_at: r.created_at,
        })) as Expense[]);
        setOfferings((result.offerings ?? []).map(r => ({
          id: r.id, service_date: r.service_date, service_name: r.service_name,
          cash_amount: Number(r.cash_amount ?? 0), cash_net: Number(r.cash_net ?? 0),
          cash_deductions: (r.cash_deductions as Array<{ reason?: string; amount?: number }> | null) ?? null,
          check_amount: Number(r.check_amount ?? 0),
          total_amount: Number(r.total_amount ?? 0), check_count: r.check_count,
          deposit_status: r.deposit_status,
        })) as OfferingRow[]);
      }
      setLoading(false);
    });
  }, []);

  const range = periodRange(period);

  const filteredDon = useMemo(
    () => donations.filter((d) => d.donation_date >= range.start),
    [donations, range.start],
  );
  const filteredExp = useMemo(
    () => expenses.filter((e) => e.submitted_at?.slice(0, 10) >= range.start),
    [expenses, range.start],
  );
  const filteredOff = useMemo(
    () => offerings.filter((o) => o.service_date >= range.start),
    [offerings, range.start],
  );

  // Standalone gifts (not part of a weekly offering). Weekly offering checks
  // also land in donations (with offering_id), so offering totals are folded
  // in separately to avoid double counting.
  const filteredStandalone = useMemo(
    () => filteredDon.filter((d) => !d.offering_id),
    [filteredDon],
  );

  // Income aggregations (framed as offerings, since weekly collections are the bulk)
  const incomeByType = useMemo(() => {
    const m: Record<string, number> = {};
    filteredStandalone.forEach((d) => {
      m[d.donation_type] = (m[d.donation_type] ?? 0) + Number(d.amount);
    });
    const offeringTotal = filteredOff.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    if (offeringTotal > 0) m["Sunday offering"] = (m["Sunday offering"] ?? 0) + offeringTotal;
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredStandalone, filteredOff]);

  // Split cash into anonymous (plate, GROSS before pastor-gift deductions) vs
  // named (envelope gifts + standalone) — pastor gifts shown as a negative
  // deduction line, exactly like the weekly ledger, so both views reconcile.
  const incomeByMethod = useMemo(
    () => buildIncomeByMethod(filteredOff, filteredStandalone),
    [filteredOff, filteredStandalone],
  );

  const totalIncome =
    filteredStandalone.reduce((s, d) => s + Number(d.amount), 0) +
    filteredOff.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  // Expense aggregations
  const expByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      m[e.category] = (m[e.category] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  const expByEvent = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      const k = e.event_name?.trim() || "No event tagged";
      m[k] = (m[k] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  const expByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      m[e.status] = (m[e.status] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  const expBySource = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      const label = e.source === "member_submitted" ? "Reimbursed to members" : "Paid from account";
      m[label] = (m[label] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  const totalExpenses = filteredExp.reduce((s, e) => s + Number(e.amount), 0);
  const reimbursedExp = filteredExp.filter((e) => e.source === "member_submitted").reduce((s, e) => s + Number(e.amount), 0);
  const accountExp = filteredExp.filter((e) => e.source === "church_direct").reduce((s, e) => s + Number(e.amount), 0);
  const net = totalIncome - totalExpenses;

  const donutSlices = expByCategory.map(([cat, amt], i) => ({
    label: catLabel(cat),
    value: Number(amt),
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  // Rich per-week ledger detail (anonymous/named cash, checks, pastor gifts,
  // online, other) — the chart still renders the cash/check/other summary.
  const weeklyLedger = useMemo(
    () => buildWeeklyLedgerDetail(filteredOff, filteredStandalone),
    [filteredOff, filteredStandalone],
  );
  const weeklyOff = useMemo(
    () => weeklyLedger.map(([week, v]) => [week, { cash: v.anonymous + v.named + v.pastor, check: v.checks, other: v.online + v.other }] as const),
    [weeklyLedger],
  );

  const statusTone = (s: string) =>
    s === "paid" || s === "auto_paid" ? "emerald" : s === "rejected" ? "rose" : s === "approved" ? "indigo" : "amber";

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Weekly, monthly, and yearly summaries of offerings, expenses, and net position."
        badge={`${filteredOff.length} offerings · ${filteredExp.length} expenses`}
        actions={
          <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-36">
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="this_year">This year</option>
            <option value="all">All time</option>
          </Select>
        }
      />

      <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-center text-sm text-stone-600">
        Showing data from <strong>{range.label}</strong>
      </div>

      {/* KPI row */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <CircleDollarSign className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Offerings received</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totalIncome)}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Total expenses</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totalExpenses)}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${net >= 0 ? "bg-indigo-100 text-indigo-700" : "bg-rose-100 text-rose-700"}`}>
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Net</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(net)}</div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="offerings">Offerings</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="weekly">Weekly detail</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* ── Offerings tab ────────────────────────────────────────────── */}
        <TabsContent value="offerings">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By type</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {incomeByType.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No offerings in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Type</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeByType.map(([type, amt]) => (
                        <tr key={type} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 capitalize text-stone-800">{type}</td>
                          <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalIncome)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By method</h2>
                <p className="text-xs text-stone-500">Gross plate cash, named envelope gifts, checks — pastor gifts shown as a deduction</p>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {incomeByMethod.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No offerings in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Method</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeByMethod.map(({ method, amount: amt }) => (
                        <tr key={method} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 capitalize text-stone-800">{method}</td>
                          <td className={`px-6 py-2 text-right font-mono ${amt < 0 ? "text-rose-700" : "text-stone-700"}`}>{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalIncome)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        {/* ── Expenses tab ─────────────────────────────────────────────── */}
        <TabsContent value="expenses">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Spend by category — donut + legend */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Spend by category</h2>
                <p className="text-xs text-stone-500">
                  Where the money went this period — use this for the yearly cost review.
                </p>
              </CardHeader>
              <CardBody>
                {expByCategory.length === 0 ? (
                  <EmptyState icon={<PieChart className="h-6 w-6" />} title="No expenses in this period" />
                ) : (
                  <div className="grid items-center gap-8 md:grid-cols-[auto_1fr]">
                    <DonutChart slices={donutSlices} total={totalExpenses} />
                    <div className="overflow-hidden rounded-lg border border-stone-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-stone-100 bg-stone-50 text-xs uppercase text-stone-500">
                            <th className="px-4 py-2 text-left font-medium">Category</th>
                            <th className="px-4 py-2 text-right font-medium">Amount</th>
                            <th className="px-4 py-2 text-right font-medium">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expByCategory.map(([cat, amt], i) => {
                            const pct = totalExpenses > 0 ? (Number(amt) / totalExpenses) * 100 : 0;
                            return (
                              <tr key={cat} className="border-t border-stone-50 hover:bg-stone-50/50">
                                <td className="px-4 py-2">
                                  <span className="inline-flex items-center gap-2 text-stone-800">
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                                    {catLabel(cat)}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                                <td className="px-4 py-2 text-right text-stone-500">{pct.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                            <td className="px-4 py-3">Total</td>
                            <td className="px-4 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalExpenses)}</td>
                            <td className="px-4 py-3 text-right text-stone-500">100%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* By event */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By event</h2>
                <p className="text-xs text-stone-500">VBS, conferences, Sunday snacks, youth meetings…</p>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {expByEvent.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No expenses in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Event</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expByEvent.map(([ev, amt]) => (
                        <tr key={ev} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 text-stone-800">{ev}</td>
                          <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            {/* By status */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By status</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {expByStatus.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No expenses in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Status</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expByStatus.map(([status, amt]) => (
                        <tr key={status} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2">
                            <Badge tone={statusTone(status)}>{status.replace("_", " ")}</Badge>
                          </td>
                          <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            {/* By source */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By source</h2>
                <p className="text-xs text-stone-500">Reimbursed to members vs. paid directly from the church account</p>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {expBySource.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No expenses in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Source</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expBySource.map(([source, amt]) => (
                        <tr key={source} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 text-stone-800">{source}</td>
                          <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalExpenses)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        {/* ── Weekly detail tab ─────────────────────────────────────────── */}
        <TabsContent value="weekly">
          {weeklyOff.length > 0 && (
            <WeeklyBarChart data={weeklyOff} maxBars={period === "all" ? 26 : 12} />
          )}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-lg font-semibold text-stone-900">Weekly offering collections</h2>
                  <p className="text-xs text-stone-500">Per-Sunday ledger: gross anonymous plate cash, named envelope gifts, checks, minus pastor-gift deductions — online gifts kept separate</p>
                </div>
                {weeklyOff.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => {
                    const csv = ["Week,Anonymous cash,Named cash,Checks,Pastor gifts,Online,Total", ...weeklyLedger.map(([week, v]) => {
                      const total = v.anonymous + v.named + v.checks + v.online + v.other + v.pastor;
                      return `${weekRangeLabel(week)},${v.anonymous},${v.named},${v.checks},${v.pastor},${v.online},${total}`;
                    })].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = `weekly-offerings-${range.label.replace(/\s/g, "-").toLowerCase()}.csv`; a.click();
                    URL.revokeObjectURL(url);
                  }} iconLeft={<Download className="h-3.5 w-3.5" />}>Export CSV</Button>
                )}
              </div>
            </CardHeader>
            <CardBody className="px-0 pb-0">
              {weeklyOff.length === 0 ? (
                <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No offerings in this period" /></div>
              ) : (
                <TableWrap className="min-w-[760px] border-0 shadow-none">
                  <THead>
                    <Tr>
                      <Th>Week of</Th>
                      <Th className="text-right">Anonymous cash</Th>
                      <Th className="text-right">Named cash</Th>
                      <Th className="text-right">Checks</Th>
                      <Th className="text-right">Pastor gifts</Th>
                      <Th className="text-right">Online</Th>
                      <Th className="text-right">Total</Th>
                    </Tr>
                  </THead>
                  <tbody>
                    {weeklyLedger.map(([week, v]) => {
                      const total = v.anonymous + v.named + v.checks + v.online + v.other + v.pastor;
                      return (
                        <Tr key={week}>
                          <Td className="font-medium">{weekRangeLabel(week)}</Td>
                          <Td className="text-right font-mono text-sm">{formatCurrency(v.anonymous)}</Td>
                          <Td className="text-right font-mono text-sm text-lime-700">{formatCurrency(v.named)}</Td>
                          <Td className="text-right font-mono text-sm">{formatCurrency(v.checks)}</Td>
                          <Td className="text-right font-mono text-sm text-rose-700">{v.pastor < 0 ? formatCurrency(v.pastor) : "—"}</Td>
                          <Td className="text-right font-mono text-sm text-indigo-700">{v.online > 0 ? formatCurrency(v.online) : "—"}</Td>
                          <Td className="text-right font-serif font-semibold">{formatCurrency(total)}</Td>
                        </Tr>
                      );
                    })}
                    <Tr>
                      <Td colSpan={6} className="border-t-2 border-stone-200 py-4 text-right font-semibold">Total</Td>
                      <Td className="border-t-2 border-stone-200 py-4 text-right font-serif text-lg font-semibold text-stone-900">
                        {formatCurrency(totalIncome)}
                      </Td>
                    </Tr>
                  </tbody>
                </TableWrap>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        {/* ── Summary tab ──────────────────────────────────────────────── */}
        <TabsContent value="summary">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Total offerings received</h2>
                <p className="text-xs text-stone-500">All offering collections and gifts in this period</p>
              </CardHeader>
              <CardBody>
                <div className="font-serif text-4xl font-bold text-emerald-700">{formatCurrency(totalIncome)}</div>
                <div className="mt-2 text-sm text-stone-500">{filteredOff.length} offering collections recorded</div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Total expenses</h2>
                <p className="text-xs text-stone-500">Split by payment type</p>
              </CardHeader>
              <CardBody>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge tone="amber">Reimbursed</Badge>
                      <span className="text-sm text-stone-600">Paid to members</span>
                    </div>
                    <span className="font-mono text-lg font-semibold text-stone-800">{formatCurrency(reimbursedExp)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge tone="indigo">Account-paid</Badge>
                      <span className="text-sm text-stone-600">Rent, salaries, auto-debits</span>
                    </div>
                    <span className="font-mono text-lg font-semibold text-stone-800">{formatCurrency(accountExp)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-stone-200 pt-3">
                    <span className="text-sm font-semibold text-stone-800">Total expenses</span>
                    <span className="font-serif text-xl font-bold text-rose-700">{formatCurrency(totalExpenses)}</span>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Net position</h2>
                <p className="text-xs text-stone-500">Offerings minus all expenses for {range.label}</p>
              </CardHeader>
              <CardBody>
                <div className="flex items-end justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-stone-500">
                      {formatCurrency(totalIncome)} received − {formatCurrency(totalExpenses)} spent
                    </div>
                    <div className={`font-serif text-4xl font-bold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {net >= 0 ? "+" : ""}{formatCurrency(net)}
                    </div>
                    <Badge tone={net >= 0 ? "emerald" : "rose"}>
                      {net >= 0 ? "Surplus" : "Deficit"}
                    </Badge>
                  </div>
                  <div className="text-right text-sm text-stone-500">
                    {net >= 0
                      ? "The church is operating within its means this period."
                      : "Expenses exceeded income this period."}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {!supabase && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Demo mode.</strong> Connect Supabase to see live reports.
        </div>
      )}

      {loading && (
        <div className="mt-8 space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100" />)}
        </div>
      )}
    </div>
  );
}

/* ── Stacked bar chart for weekly offerings ────────────────────────── */
function WeeklyBarChart({ data, maxBars }: { data: readonly (readonly [string, { cash: number; check: number; other: number }])[]; maxBars: number }) {
  const display = data.slice(-maxBars);
  const maxVal = Math.max(...display.map(([, v]) => v.cash + v.check + v.other), 1);
  const h = 200;
  const w = Math.max(display.length * 44, 300);
  const pad = { top: 20, right: 10, bottom: 50, left: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const barW = Math.min((chartW / display.length) * 0.65, 28);
  const gap = chartW / display.length;

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader>
        <h2 className="font-serif text-lg font-semibold text-stone-900">Weekly trend</h2>
        <p className="text-xs text-stone-500">Stacked cash · checks · other gifts — hover for details</p>
      </CardHeader>
      <CardBody>
        <div className="overflow-x-auto">
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Weekly offering trend" className="mx-auto">
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
              const y = pad.top + chartH * (1 - pct);
              return (
                <g key={pct}>
                  <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="#e7e5e4" strokeWidth={pct === 0 ? 1 : 0.5} strokeDasharray={pct === 0 ? "" : "3 3"} />
                  <text x={pad.left - 4} y={y + 3} textAnchor="end" style={{ fontSize: 9 }} fill="#a8a29e">{formatCurrency(maxVal * pct)}</text>
                </g>
              );
            })}
            {/* Bars */}
            {display.map(([week, v], i) => {
              const x = pad.left + i * gap + (gap - barW) / 2;
              const total = v.cash + v.check + v.other;
              const barH = total > 0 ? (total / maxVal) * chartH : 0;
              const y = pad.top + chartH - barH;
              // Stack proportions
              const cashH = total > 0 ? (v.cash / total) * barH : 0;
              const checkH = total > 0 ? (v.check / total) * barH : 0;
              const otherH = total > 0 ? (v.other / total) * barH : 0;
              // Only show every Nth label
              const step = Math.max(1, Math.floor(display.length / 8));
              const showLabel = i % step === 0 || i === display.length - 1;
              const label = new Date(week + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <g key={week} className="group">
                  <title>{`${label}: Cash ${formatCurrency(v.cash)} · Checks ${formatCurrency(v.check)} · Other ${formatCurrency(v.other)} · Total ${formatCurrency(total)}`}</title>
                  {otherH > 0 && <rect x={x} y={y} width={barW} height={otherH} rx={2} fill="#6366f1" opacity={0.85} />}
                  {checkH > 0 && <rect x={x} y={y + otherH} width={barW} height={checkH} fill="#f59e0b" opacity={0.85} />}
                  {cashH > 0 && <rect x={x} y={y + otherH + checkH} width={barW} height={cashH} rx={otherH + checkH === 0 ? 2 : 0} fill="#10b981" opacity={0.85} />}
                  {showLabel && <text x={x + barW / 2} y={h - pad.bottom + 14} textAnchor="middle" style={{ fontSize: 9 }} fill="#78716c" transform={`rotate(-35 ${x + barW / 2} ${h - pad.bottom + 14})`}>{label}</text>}
                </g>
              );
            })}
            {/* Legend */}
            <g transform={`translate(${pad.left}, ${h - 4})`}>
              {[{ label: "Cash", color: "#10b981" }, { label: "Check", color: "#f59e0b" }, { label: "Other", color: "#6366f1" }].map((item, i) => (
                <g key={item.label} transform={`translate(${i * 64}, 0)`}>
                  <rect x={0} y={-8} width={10} height={10} rx={2} fill={item.color} opacity={0.85} />
                  <text x={14} y={0} style={{ fontSize: 10 }} fill="#78716c">{item.label}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      </CardBody>
    </Card>
  );
}
