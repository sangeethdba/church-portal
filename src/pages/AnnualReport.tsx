import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FileDown, BarChart3, TrendingUp, CircleDollarSign, Receipt, Shield } from "lucide-react";
import {
  Button, Card, CardBody, CardHeader, Select, Label,
  Badge, EmptyState, toast,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isAdminRole, EXPENSE_CATEGORIES, type Donation, type Expense } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { buildIncomeByMethod, buildWeeklyLedgerDetail } from "@/lib/accounting";
import { downloadAnnualReport, type AnnualReportData } from "@/lib/pdf";
import { ALF_DOCUMENT_BRANDING } from "@/lib/pdf";

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

const catLabel = (c: string) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? c.replace(/_/g, " ");

export default function AnnualReport() {
  const ctx = useOutletContext<{ profile: { role?: string; first_name?: string; last_name?: string } | null }>();
  const isAdmin = isAdminRole(ctx.profile?.role);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [offerings, setOfferings] = useState<OfferingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.rpc("get_reports_data").then(({ data, error }) => {
      if (error) { console.warn("Annual report fetch failed:", error); setLoading(false); return; }
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

  // Filter to selected year
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;

  const filteredDon = useMemo(
    () => donations.filter((d) => d.donation_date >= yStart && d.donation_date <= yEnd),
    [donations, yStart, yEnd],
  );
  const filteredExp = useMemo(
    () => expenses.filter((e) => {
      const d = e.submitted_at?.slice(0, 10) ?? "";
      return d >= yStart && d <= yEnd;
    }),
    [expenses, yStart, yEnd],
  );
  const filteredOff = useMemo(
    () => offerings.filter((o) => o.service_date >= yStart && o.service_date <= yEnd),
    [offerings, yStart, yEnd],
  );

  const filteredStandalone = useMemo(
    () => filteredDon.filter((d) => !d.offering_id),
    [filteredDon],
  );

  const totalIncome =
    filteredStandalone.reduce((s, d) => s + Number(d.amount), 0) +
    filteredOff.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  const totalExpenses = filteredExp.reduce((s, e) => s + Number(e.amount), 0);
  const net = totalIncome - totalExpenses;

  // Income breakdowns
  const incomeByType = useMemo(() => {
    const m: Record<string, number> = {};
    filteredStandalone.forEach((d) => {
      m[d.donation_type] = (m[d.donation_type] ?? 0) + Number(d.amount);
    });
    const offeringTotal = filteredOff.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    if (offeringTotal > 0) m["Sunday offering"] = (m["Sunday offering"] ?? 0) + offeringTotal;
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredStandalone, filteredOff]);

  const incomeByMethod = useMemo(
    () => buildIncomeByMethod(filteredOff, filteredStandalone),
    [filteredOff, filteredStandalone],
  );

  // Expense breakdowns
  const expByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      m[e.category] = (m[e.category] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  const expByMethod = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      const method = e.payment_method?.trim() || "unspecified";
      m[method] = (m[method] ?? 0) + Number(e.amount);
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

  const expByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    filteredExp.forEach((e) => {
      m[e.status] = (m[e.status] ?? 0) + Number(e.amount);
    });
    return Object.entries(m).sort(([, a], [, b]) => b - a);
  }, [filteredExp]);

  // Monthly trend
  const weeklyLedger = useMemo(
    () => buildWeeklyLedgerDetail(filteredOff, filteredStandalone),
    [filteredOff, filteredStandalone],
  );

  const monthlyLedger = useMemo(() => {
    const months = new Map<string, { income: number; expenses: number }>();
    for (const [week, v] of weeklyLedger) {
      const mk = week.slice(0, 7);
      const cur = months.get(mk) ?? { income: 0, expenses: 0 };
      cur.income += v.anonymous + v.named + v.checks + v.pastor + v.online + v.other;
      months.set(mk, cur);
    }
    for (const e of filteredExp) {
      const d = e.submitted_at?.slice(0, 7) ?? "";
      if (!d) continue;
      const cur = months.get(d) ?? { income: 0, expenses: 0 };
      cur.expenses += Number(e.amount);
      months.set(d, cur);
    }
    return Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, income: v.income, expenses: v.expenses }));
  }, [weeklyLedger, filteredExp]);

  // Yearly comparison
  const yearlyComparison = useMemo(() => {
    const years = new Map<string, { income: number; expenses: number }>();
    for (const d of donations) {
      const y = d.donation_date?.slice(0, 4);
      if (!y) continue;
      const cur = years.get(y) ?? { income: 0, expenses: 0 };
      cur.income += Number(d.amount);
      years.set(y, cur);
    }
    for (const o of offerings) {
      const y2 = o.service_date?.slice(0, 4);
      if (!y2) continue;
      const cur = years.get(y2) ?? { income: 0, expenses: 0 };
      cur.income += Number(o.total_amount ?? 0);
      years.set(y2, cur);
    }
    for (const e of expenses) {
      const d = e.submitted_at?.slice(0, 4) ?? "";
      if (!d) continue;
      if (e.status !== "paid" && e.status !== "auto_paid") continue;
      const cur = years.get(d) ?? { income: 0, expenses: 0 };
      cur.expenses += Number(e.amount);
      years.set(d, cur);
    }
    return Array.from(years.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([y3, v]) => ({ year: Number(y3), income: v.income, expenses: v.expenses, net: v.income - v.expenses }));
  }, [donations, expenses, offerings]);

  const onDownload = () => {
    const generatedBy = ctx.profile
      ? `${ctx.profile.first_name ?? ""} ${ctx.profile.last_name ?? ""}`.trim()
      : ALF_DOCUMENT_BRANDING.treasurer;
    const churchName =
      (typeof window !== "undefined" && localStorage.getItem("church_name")) ||
      ALF_DOCUMENT_BRANDING.name;

    const data: AnnualReportData = {
      churchName,
      year,
      totalIncome,
      totalExpenses,
      net,
      offeringCount: filteredOff.length,
      expenseCount: filteredExp.length,
      incomeByType: incomeByType.map(([label, amount]) => ({ label, amount })),
      incomeByMethod: incomeByMethod.map(({ method, amount }) => ({ label: method, amount })),
      expensesByCategory: expByCategory.map(([label, amount]) => ({ label: catLabel(label), amount })),
      expensesByMethod: expByMethod.map(([label, amount]) => ({ label, amount })),
      expensesBySource: expBySource.map(([label, amount]) => ({ label, amount })),
      expensesByStatus: expByStatus.map(([label, amount]) => ({ label, amount })),
      monthlyLedger,
      yearlyComparison,
      generatedBy: generatedBy || ALF_DOCUMENT_BRANDING.treasurer,
    };
    downloadAnnualReport(data);
    toast(`Annual report for ${year} downloaded.`, "success");
  };

  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    donations.forEach((d) => ys.add(Number(d.donation_date.slice(0, 4))));
    expenses.forEach((e) => {
      const y4 = e.submitted_at?.slice(0, 4);
      if (y4) ys.add(Number(y4));
    });
    offerings.forEach((o) => ys.add(Number(o.service_date.slice(0, 4))));
    ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [donations, expenses, offerings]);

  // Admin-only
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-6 py-16 text-center">
        <Shield className="mb-3 h-10 w-10 text-amber-400" />
        <h2 className="font-serif text-xl font-semibold text-stone-800">Access restricted</h2>
        <p className="mt-2 max-w-md text-sm text-stone-500">
          Annual financial reports are generated by the church treasurer. Only admins can access this page.
        </p>
      </div>
    );
  }

  const hasData = filteredDon.length > 0 || filteredOff.length > 0;

  return (
    <div>
      <PageHeader
        title="Annual report"
        subtitle="Generate a comprehensive church-wide annual financial report — ready for the year-end business meeting, board review, or membership presentation."
        badge="PDF"
        actions={
          <div className="flex items-center gap-3">
            <div>
              <Label className="text-[11px]">Calendar year</Label>
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 w-28">
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-end pt-1">
              <Button
                onClick={onDownload}
                disabled={!hasData || loading}
                iconLeft={<FileDown className="h-4 w-4" />}
              >
                Download PDF
              </Button>
            </div>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-stone-100" />)}
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title={`No data for ${year}`}
          description="Once donations, offerings, and expenses are recorded for this year, the report will populate."
        />
      ) : (
        <>
          {/* KPI row */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardBody className="flex items-center gap-4 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <CircleDollarSign className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Total income</div>
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
                  <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Net position</div>
                  <div className="font-serif text-xl font-semibold text-stone-900">{net >= 0 ? "+" : ""}{formatCurrency(net)}</div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Preview: income */}
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Income by type</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
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
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Income by method</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
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
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>

          {/* Preview: expenses */}
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Expenses by category</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
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
                        <td className="px-6 py-2 text-stone-800">{catLabel(cat)}</td>
                        <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Expenses by payment method</h2>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                      <th className="px-6 py-2 text-left font-medium">Method</th>
                      <th className="px-6 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expByMethod.map(([method, amt]) => (
                      <tr key={method} className="border-t border-stone-50 hover:bg-stone-50/50">
                        <td className="px-6 py-2 capitalize text-stone-800">{method}</td>
                        <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(amt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>

          {/* Preview: yearly comparison */}
          {yearlyComparison.length > 1 && (
            <Card className="mb-8">
              <CardHeader>
                <h2 className="font-serif text-lg font-semibold text-stone-900">Year-over-year comparison</h2>
                <p className="text-xs text-stone-500">All recorded years — helps spot long-term trends</p>
              </CardHeader>
              <CardBody className="px-0 pb-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-stone-100 text-xs uppercase text-stone-500">
                      <th className="px-6 py-2 text-left font-medium">Year</th>
                      <th className="px-6 py-2 text-right font-medium">Income</th>
                      <th className="px-6 py-2 text-right font-medium">Expenses</th>
                      <th className="px-6 py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyComparison.map((y2) => (
                      <tr key={y2.year} className={`border-t border-stone-50 hover:bg-stone-50/50 ${y2.year === year ? "bg-indigo-50/50" : ""}`}>
                        <td className="px-6 py-2 font-medium text-stone-900">{y2.year}{y2.year === year ? " (selected)" : ""}</td>
                        <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(y2.income)}</td>
                        <td className="px-6 py-2 text-right font-mono text-stone-700">{formatCurrency(y2.expenses)}</td>
                        <td className={`px-6 py-2 text-right font-serif font-semibold ${y2.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {y2.net >= 0 ? "+" : ""}{formatCurrency(y2.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}

          {/* PDF contents list */}
          <Card>
            <CardHeader>
              <h2 className="font-serif text-lg font-semibold text-stone-900">What's in the PDF</h2>
              <p className="text-xs text-stone-500">The downloaded report includes all of the following sections with church letterhead branding</p>
            </CardHeader>
            <CardBody className="space-y-1 text-sm text-stone-600">
              <p>1. <strong>Cover page</strong> — Church name, report title, year, key figures at a glance</p>
              <p>2. <strong>Income</strong> — Total received, breakdown by gift type and payment method</p>
              <p>3. <strong>Expenses</strong> — Total spent, breakdown by category, payment method, source, and status</p>
              <p>4. <strong>Monthly trend</strong> — Month-by-month income vs. expenses table</p>
              {yearlyComparison.length > 1 && (
                <p>5. <strong>Year-over-year comparison</strong> — All years side by side</p>
              )}
              <p>{yearlyComparison.length > 1 ? "6" : "5"}. <strong>Net position</strong> — Surplus or deficit with closing summary</p>
            </CardBody>
          </Card>
        </>
      )}

      {!supabase && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Demo mode.</strong> Connect Supabase to generate real annual reports.
        </div>
      )}
    </div>
  );
}
