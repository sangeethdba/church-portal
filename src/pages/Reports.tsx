import { useEffect, useMemo, useState } from "react";
import { BarChart3, TrendingUp, CircleDollarSign, Receipt, FileDown } from "lucide-react";
import {
  Button, Card, CardBody, CardHeader, Label, Select,
  Badge, EmptyState, TableWrap, THead, Tr, Th, Td, Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, type Donation, type Expense } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { generateAnnualStatement, type AnnualStatement } from "@/lib/pdf";
import type { Donor } from "@/lib/supabase";
import { buildWeeklyBuckets } from "@/lib/accounting";

type Period = "this_week" | "this_month" | "this_year" | "all";

type OfferingRow = {
  id: string;
  service_date: string;
  service_name: string;
  cash_amount: number;
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
    const day = now.getDay();
    const sun = new Date(now);
    sun.setDate(now.getDate() - day);
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

export default function Reports() {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [offerings, setOfferings] = useState<OfferingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("this_month");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    Promise.all([
      supabase.from("donations").select("*").order("donation_date", { ascending: false }),
      supabase.from("expenses").select("*").order("submitted_at", { ascending: false }),
      supabase.from("offerings").select("*").order("service_date", { ascending: false }),
    ]).then(([{ data: dData }, { data: eData }, { data: oData }]) => {
      if (dData) setDonations(dData as Donation[]);
      if (eData) setExpenses(eData as Expense[]);
      if (oData) setOfferings(oData as OfferingRow[]);
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

  // Standalone gifts (not part of a weekly offering). Offering checks also land
  // in the donations table (with offering_id), so we fold offering totals in
  // separately — this avoids double counting the checks.
  const filteredStandalone = useMemo(
    () => filteredDon.filter((d) => !d.offering_id),
    [filteredDon],
  );

  // Donation aggregations
  const donByType = useMemo(() => {
    const m: Record<string, number> = {};
    filteredStandalone.forEach((d) => {
      m[d.donation_type] = (m[d.donation_type] ?? 0) + Number(d.amount);
    });
    // Weekly collections (cash + checks) count as "offering" type income
    const offeringTotal = filteredOff.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    if (offeringTotal > 0) m.offering = (m.offering ?? 0) + offeringTotal;
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredStandalone, filteredOff]);

  const donByMethod = useMemo(() => {
    const m: Record<string, number> = {};
    filteredStandalone.forEach((d) => {
      m[d.payment_method] = (m[d.payment_method] ?? 0) + Number(d.amount);
    });
    filteredOff.forEach((o) => {
      m.cash = (m.cash ?? 0) + Number(o.cash_amount ?? 0);
      m.check = (m.check ?? 0) + Number(o.check_amount ?? 0);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredStandalone, filteredOff]);

  const totalDonations =
    filteredStandalone.reduce((s, d) => s + Number(d.amount), 0) +
    filteredOff.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  // Expense aggregations
  const expBySource = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      const label = e.source === "member_submitted" ? "Reimbursed to members" : "Paid from account";
      m[label] = (m[label] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  const expByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      m[e.category] = (m[e.category] ?? 0) + Number(e.amount);
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

  const totalExpenses = filteredExp.reduce((s, e) => s + Number(e.amount), 0);
  const reimbursedExp = filteredExp.filter((e) => e.source === "member_submitted").reduce((s, e) => s + Number(e.amount), 0);
  const accountExp = filteredExp.filter((e) => e.source === "church_direct").reduce((s, e) => s + Number(e.amount), 0);
  const net = totalDonations - totalExpenses;

  // Weekly breakdown: offering collections (cash + checks) plus standalone gifts
  const weeklyDon = useMemo(
    () =>
      buildWeeklyBuckets(filteredOff, filteredStandalone).map(([week, v]) => [week, { cash: v.cash, check: v.check, other: v.other }] as const),
    [filteredOff, filteredStandalone],
  );

  const exportDonationsPDF = () => {
    const jsPDF = (window as unknown as Record<string, unknown>).jspdf;
    if (!jsPDF) return;
    // Simple CSV-like text export — we use the existing jsPDF module
    import("@/lib/pdf").then(({ generateAnnualStatement }) => {
      // We don't have a donor here, so skip for now. 
      // Instead we'll generate a summary report.
    });
  };

  const statusTone = (s: string) =>
    s === "paid" || s === "auto_paid" ? "emerald" : s === "rejected" ? "rose" : s === "approved" ? "indigo" : "amber";

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Weekly, monthly, and yearly summaries of donations, expenses, and net position."
        badge={`${filteredDon.length + filteredOff.length} gifts · ${filteredExp.length} expenses`}
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
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Total donations</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totalDonations)}</div>
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

      <Tabs defaultValue="donations">
        <TabsList>
          <TabsTrigger value="donations">Donations</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="weekly">Weekly detail</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* ── Donations tab ─────────────────────────────────────────────── */}
        <TabsContent value="donations">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* By type */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By type</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {donByType.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No donations in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Type</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donByType.map(([type, amt]) => (
                        <tr key={type} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 capitalize text-stone-800">{type}</td>
                          <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalDonations)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            {/* By payment method */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By method</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {donByMethod.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No donations in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Method</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donByMethod.map(([method, amt]) => (
                        <tr key={method} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 capitalize text-stone-800">{method}</td>
                          <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalDonations)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        {/* ── Expenses tab ──────────────────────────────────────────────── */}
        <TabsContent value="expenses">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* By category */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By category</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                {expByCategory.length === 0 ? (
                  <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No expenses in this period" /></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                        <th className="px-6 py-2 text-left font-medium">Category</th>
                        <th className="px-6 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expByCategory.map(([cat, amt]) => (
                        <tr key={cat} className="border-t border-stone-50 hover:bg-stone-50/50">
                          <td className="px-6 py-2 capitalize text-stone-800">{cat}</td>
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
                      <tr className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                        <td className="px-6 py-3">Total</td>
                        <td className="px-6 py-3 text-right font-serif text-base text-stone-900">{formatCurrency(totalExpenses)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            {/* By source */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">By source</h2>
                <p className="text-xs text-stone-500">Reimbursed to members vs. paid directly from church account</p>
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
          <Card>
            <CardHeader>
              <h2 className="font-serif text-lg font-semibold text-stone-900">Weekly giving breakdown</h2>
              <p className="text-xs text-stone-500">Weekly offering collections (cash + checks) plus any standalone gifts</p>
            </CardHeader>
            <CardBody className="px-0 pb-0">
              {weeklyDon.length === 0 ? (
                <div className="px-6 pb-5"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No donations in this period" /></div>
              ) : (
                <TableWrap className="border-0 shadow-none">
                  <THead>
                    <Tr>
                      <Th>Week of</Th>
                      <Th className="text-right">Cash</Th>
                      <Th className="text-right">Check</Th>
                      <Th className="text-right">Other</Th>
                      <Th className="text-right">Total</Th>
                    </Tr>
                  </THead>
                  <tbody>
                    {weeklyDon.map(([week, v]) => {
                      const total = v.cash + v.check + v.other;
                      return (
                        <Tr key={week}>
                          <Td className="font-medium">{formatDate(week)}</Td>
                          <Td className="text-right font-mono text-sm">{formatCurrency(v.cash)}</Td>
                          <Td className="text-right font-mono text-sm">{formatCurrency(v.check)}</Td>
                          <Td className="text-right font-mono text-sm">{formatCurrency(v.other)}</Td>
                          <Td className="text-right font-serif font-semibold">{formatCurrency(total)}</Td>
                        </Tr>
                      );
                    })}
                    <Tr>
                      <Td colSpan={4} className="border-t-2 border-stone-200 py-4 text-right font-semibold">Total</Td>
                      <Td className="border-t-2 border-stone-200 py-4 text-right font-serif text-lg font-semibold text-stone-900">
                        {formatCurrency(totalDonations)}
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
            {/* Income */}
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Total offerings received</h2>
                <p className="text-xs text-stone-500">All donations and offering entries in this period</p>
              </CardHeader>
              <CardBody>
                <div className="font-serif text-4xl font-bold text-emerald-700">{formatCurrency(totalDonations)}</div>
                <div className="mt-2 text-sm text-stone-500">{filteredDon.length + filteredOff.length} gifts recorded</div>
              </CardBody>
            </Card>

            {/* Expenses summary */}
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
                      <span className="text-sm text-stone-600">Auto-debits, rent, supplies</span>
                    </div>
                    <span className="font-mono text-lg font-semibold text-stone-800">{formatCurrency(accountExp)}</span>
                  </div>
                  <div className="border-t border-stone-200 pt-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-800">Total expenses</span>
                    <span className="font-serif text-xl font-bold text-rose-700">{formatCurrency(totalExpenses)}</span>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Net */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Net position</h2>
                <p className="text-xs text-stone-500">Offerings minus all expenses for {range.label}</p>
              </CardHeader>
              <CardBody>
                <div className="flex items-end justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-stone-500">
                      {formatCurrency(totalDonations)} received − {formatCurrency(totalExpenses)} spent
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
    </div>
  );
}
