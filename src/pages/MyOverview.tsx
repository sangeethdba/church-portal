import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { HandCoins, Receipt, Wallet, FileText, CircleDollarSign, ArrowRight, Eye, Paperclip, Banknote, CalendarRange, FileDown, BarChart3, Download, Filter } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Tile, Badge, Label, Select, EmptyState } from "@/components/ui";
import { downloadMemberReport } from "@/lib/pdf";
import { PageHeader } from "@/components/Layout";
import ReceiptViewer from "@/components/ReceiptViewer";
import ReceiptThumbs from "@/components/ReceiptThumbs";
import { normalizeLineItems, supabase } from "@/lib/supabase";
import type { Donation, Expense, Profile } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

const statusTone = (s: string) =>
  s === "paid" || s === "auto_paid" ? "emerald" : s === "rejected" ? "rose" : s === "approved" ? "indigo" : "amber";



type ReportPeriod = "this_week" | "this_month" | "this_year" | "all";

function memberPeriodRange(p: ReportPeriod): { start: string; label: string } {
  const now = new Date();
  if (p === "this_week") {
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    return { start: sun.toISOString().slice(0, 10), label: "This week" };
  }
  if (p === "this_month") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), label: "This month" };
  }
  if (p === "this_year") {
    return { start: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10), label: "This year" };
  }
  return { start: "2000-01-01", label: "All time" };
}

export function MemberOverview() {
  const ctx = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const profile = ctx.profile;
  const navigate = useNavigate();
  const [donations, setDonations] = useState<Donation[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [myYtd, setMyYtd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewExpense, setViewExpense] = useState<Expense | null>(null);
  const [billFrom, setBillFrom] = useState("");
  const [billTo, setBillTo] = useState("");
  const [period, setPeriod] = useState<ReportPeriod>("this_year");
  const [donFilterType, setDonFilterType] = useState<string>("all");
  const [donFilterMethod, setDonFilterMethod] = useState<string>("all");
  const range = memberPeriodRange(period);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      const myDonorId = profile?.linked_donor_id;
      const myName = profile?.full_name;
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

      // Build donation queries: by donor_id + fallback by name for offering-created
      // gifts where donor_id was never resolved.
      const donQuery = myDonorId
        ? supabase.from("donations").select("*").eq("donor_id", myDonorId).gte("donation_date", range.start).order("donation_date", { ascending: false })
        : Promise.resolve({ data: null as Donation[] | null });
      const donByNameQuery = myDonorId && myName
        ? supabase.from("donations").select("*").is("donor_id", null).ilike("donor_name", myName).gte("donation_date", range.start).order("donation_date", { ascending: false })
        : Promise.resolve({ data: null as Donation[] | null });
      const ytdQuery = myDonorId
        ? supabase.from("donations").select("amount").eq("donor_id", myDonorId).gte("donation_date", yearStart)
        : Promise.resolve({ data: null as { amount: number }[] | null });
      const ytdByNameQuery = myDonorId && myName
        ? supabase.from("donations").select("amount").is("donor_id", null).ilike("donor_name", myName).gte("donation_date", yearStart)
        : Promise.resolve({ data: null as { amount: number }[] | null });

      const [donRes, donByNameRes, ytdRes, ytdByNameRes, expRes] = await Promise.all([
        donQuery,
        donByNameQuery,
        ytdQuery,
        ytdByNameQuery,
        (() => {
          let q = supabase.from("expenses").select("*").eq("user_id", profile?.id).order("submitted_at", { ascending: false }).limit(200);
          if (billFrom) q = q.gte("submitted_at", billFrom);
          if (billTo) q = q.lte("submitted_at", `${billTo}T23:59:59.999Z`);
          return q;
        })(),
      ]);
      if (!cancelled) {
        // Merge by-id + by-name queries (dedupe on id)
        const allDonations = [
          ...(donRes.data ?? []),
          ...(donByNameRes.data ?? []),
        ];
        const seen = new Set<string>();
        const merged = allDonations.filter((d) => {
          if (seen.has(d.id)) return false;
          seen.add(d.id);
          return true;
        });
        merged.sort((a, b) => (b.donation_date ?? "").localeCompare(a.donation_date ?? ""));
        setDonations(merged);

        // Two queries are disjoint (donor_id set vs null) — sum both directly
        setMyYtd(
          (ytdRes.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0) +
          (ytdByNameRes.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0),
        );

        if (expRes.data) setExpenses(expRes.data as Expense[]);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.linked_donor_id, billFrom, billTo, range.start]);

  const outstanding = expenses.filter((e) => e.status === "pending" || e.status === "approved").reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const reimbursed = expenses.filter((e) => e.status === "paid" || e.status === "auto_paid").reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const openBills = expenses.filter((e) => e.status === "pending").length;
  const periodGiving = donations.reduce((s, d) => s + Number(d.amount ?? 0), 0);

  // Client-side type + method filters on top of the period-range query
  const filteredDonations = useMemo(
    () => donations.filter((d) =>
      (donFilterType === "all" || d.donation_type === donFilterType) &&
      (donFilterMethod === "all" || d.payment_method === donFilterMethod)
    ),
    [donations, donFilterType, donFilterMethod],
  );
  const filteredGiving = filteredDonations.reduce((s, d) => s + Number(d.amount ?? 0), 0);

  // Monthly giving trend for bar chart
  const monthlyGiving = useMemo(() => {
    const months: Record<string, number> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      months[key] = 0;
    }
    donations.forEach((d) => {
      const key = d.donation_date.slice(0, 7);
      if (months[key] !== undefined) months[key] += Number(d.amount ?? 0);
    });
    return Object.entries(months).map(([month, amt]) => ({
      month,
      amount: amt,
      label: new Date(month + "-01").toLocaleDateString("en-US", { month: "short" }),
    }));
  }, [donations]);

  const handleDownloadReport = () => {
    if (!profile?.full_name) return;
    const periodExpenses = expenses.filter((e) => (e.submitted_at?.slice(0, 10) ?? "") >= range.start);
    const reimbursedTotal = periodExpenses.filter((e) => e.status === "paid" || e.status === "auto_paid").reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const outstandingTotal = periodExpenses.filter((e) => e.status === "pending" || e.status === "approved").reduce((s, e) => s + Number(e.amount ?? 0), 0);
    downloadMemberReport({
      churchName: (typeof window !== "undefined" && localStorage.getItem("church_name")) || "Atlanta Little Flock Church",
      memberName: profile.full_name,
      periodLabel: range.label,
      donations,
      expenses: periodExpenses.map((e) => ({
        date: e.submitted_at?.slice(0, 10) ?? "",
        title: e.title ?? e.description ?? "Expense",
        category: e.category,
        status: e.status,
        amount: Number(e.amount ?? 0),
      })),
      givingTotal: periodGiving,
      expensesTotal: periodExpenses.reduce((s, e) => s + Number(e.amount ?? 0), 0),
      reimbursedTotal,
      outstandingTotal,
    });
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="My giving (YTD)" value={formatCurrency(myYtd)} accent="indigo" icon={<HandCoins className="h-5 w-5" />} />
        <Tile label="Outstanding reimbursement" value={formatCurrency(outstanding)} accent="amber" icon={<Wallet className="h-5 w-5" />} />
        <Tile label="Reimbursed (YTD)" value={formatCurrency(reimbursed)} accent="emerald" icon={<Receipt className="h-5 w-5" />} />
        <Tile label="Open bills" value={openBills.toString()} accent={openBills > 0 ? "amber" : "emerald"} icon={<FileText className="h-5 w-5" />} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold text-stone-900">My bills & reimbursements</h2>
              <Button size="sm" variant="ghost" onClick={() => navigate("/expenses")} iconLeft={<ArrowRight className="h-3.5 w-3.5" />}>Submit bill</Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
              <CalendarRange className="mb-2 h-4 w-4 text-stone-400" />
              <div>
                <Label className="text-[11px] text-stone-500">From</Label>
                <input type="date" value={billFrom}
                  onChange={(e) => setBillFrom(e.target.value)}
                  className="ml-1 h-8 rounded-md border border-stone-200 bg-white px-2 text-sm focus:border-accent focus:outline-none" />
              </div>
              <div>
                <Label className="text-[11px] text-stone-500">To</Label>
                <input type="date" value={billTo}
                  onChange={(e) => setBillTo(e.target.value)}
                  className="ml-1 h-8 rounded-md border border-stone-200 bg-white px-2 text-sm focus:border-accent focus:outline-none" />
              </div>
              {(billFrom || billTo) && (
                <Button size="sm" variant="ghost" onClick={() => { setBillFrom(""); setBillTo(""); }}>Clear</Button>
              )}
            </div>
            {!loading && expenses.length === 0 ? (
              <EmptyState icon={<Receipt className="h-6 w-6" />} title="No submissions yet" description="Bills you submit for reimbursement will appear here with their status." />
            ) : expenses.map((e) => {
              const lineItems = normalizeLineItems(e.line_items);
              const hasBills = (e.receipt_paths?.length ?? 0) > 0 || lineItems.some((li) => !!li.receipt_path);
              const receiptPaths = [
                ...lineItems.map((li) => li.receipt_path).filter((p): p is string => !!p),
                ...(e.receipt_paths ?? []),
              ];
              return (
              <div key={e.id} className="rounded-lg border border-stone-100 px-4 py-3 transition hover:border-purple-200 hover:bg-purple-50/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-stone-900">{e.title ?? e.description ?? "Expense"}</div>
                    <div className="text-xs text-stone-500">
                      {formatDate(e.submitted_at)}
                      {e.payment_method ? ` · ${e.payment_method}` : ""}
                      {lineItems.length > 1 ? ` · ${lineItems.length} bills` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {hasBills && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
                          <Paperclip className="h-3 w-3" /> {(e.receipt_paths?.length ?? 0) + lineItems.filter((li) => !!li.receipt_path).length} receipt{(e.receipt_paths?.length ?? 0) + lineItems.filter((li) => !!li.receipt_path).length === 1 ? "" : "s"}
                        </span>
                      )}
                      {e.transfer_receipt_path && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <Banknote className="h-3 w-3" /> Transfer receipt
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="font-serif text-lg font-semibold text-stone-900">{formatCurrency(e.amount)}</div>
                    <Badge tone={statusTone(e.status)}>{e.status.replace("_", " ")}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => setViewExpense(e)} iconLeft={<Eye className="h-3.5 w-3.5" />}>
                      View
                    </Button>
                  </div>
                </div>
                <ReceiptThumbs paths={receiptPaths} onOpen={() => setViewExpense(e)} />
                {lineItems.length > 0 && (
                  <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-500">
                    {lineItems.slice(0, 4).map((li, i) => (
                      <div key={i} className="flex justify-between py-0.5">
                        <span className="truncate pr-3">{li.description || "Bill"}</span>
                        <span className="font-mono">{formatCurrency(li.amount)}</span>
                      </div>
                    ))}
                    {lineItems.length > 4 && <div className="mt-1 text-stone-400">+ {lineItems.length - 4} more…</div>}
                  </div>
                )}
              </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-serif text-lg font-semibold text-stone-900">My donations</h2>
                <p className="text-xs text-stone-500">
                  {range.label} total: <span className="font-semibold text-stone-700">{formatCurrency(filteredGiving)}</span>
                  {(donFilterType !== "all" || donFilterMethod !== "all") && ` (filtered from ${formatCurrency(periodGiving)})`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} className="w-28 text-sm">
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                  <option value="this_year">This year</option>
                  <option value="all">All time</option>
                </Select>
                <Button size="sm" variant="ghost" onClick={handleDownloadReport} iconLeft={<FileDown className="h-3.5 w-3.5" />} disabled={!profile?.linked_donor_id}>Report PDF</Button>
              </div>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {/* Monthly giving trend */}
            {monthlyGiving.some((m) => m.amount > 0) && (
              <div className="rounded-lg border border-stone-100 bg-stone-50/50 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-stone-500">
                  <BarChart3 className="h-3.5 w-3.5" /> Monthly giving trend (12 months)
                </div>
                <GivingBarChart data={monthlyGiving} />
              </div>
            )}
            {/* Type + Method quick filters */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2">
              <Filter className="h-4 w-4 text-stone-400" />
              <Select value={donFilterType} onChange={(e) => setDonFilterType(e.target.value)} className="h-8 w-28 text-xs">
                <option value="all">All types</option>
                <option value="tithe">Tithe</option>
                <option value="offering">Offering</option>
                <option value="building">Building</option>
                <option value="missions">Missions</option>
                <option value="other">Other</option>
              </Select>
              <Select value={donFilterMethod} onChange={(e) => setDonFilterMethod(e.target.value)} className="h-8 w-28 text-xs">
                <option value="all">All methods</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="online">Online</option>
                <option value="card">Card</option>
              </Select>
              {(donFilterType !== "all" || donFilterMethod !== "all") && (
                <Button size="sm" variant="ghost" onClick={() => { setDonFilterType("all"); setDonFilterMethod("all"); }}>Clear</Button>
              )}
            </div>
            {!profile?.linked_donor_id ? (
              <EmptyState icon={<CircleDollarSign className="h-6 w-6" />} title="Not linked to a donor record yet" description="Ask your treasurer to link your account to your donor record so your giving history appears here." />
            ) : filteredDonations.length === 0 && donations.length > 0 ? (
              <EmptyState icon={<CircleDollarSign className="h-6 w-6" />} title="No gifts match the filters" description="Try clearing the type or method filter above." />
            ) : donations.length === 0 ? (
              <EmptyState icon={<CircleDollarSign className="h-6 w-6" />} title="No donations yet" description="Gifts recorded under your donor record will appear here." />
            ) : filteredDonations.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3 transition hover:border-purple-200 hover:bg-purple-50/30">
                <div>
                  <div className="font-medium text-stone-900">{d.donor_name}</div>
                  <div className="text-xs text-stone-500">{formatDate(d.donation_date)} · {d.donation_type} · {d.payment_method}{d.check_number ? ` · #${d.check_number}` : ""}</div>
                </div>
                <div className="font-serif text-lg font-semibold text-stone-900">{formatCurrency(d.amount)}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <ReceiptViewer
        expense={viewExpense}
        open={viewExpense !== null}
        onOpenChange={(v) => { if (!v) setViewExpense(null); }}
      />
    </>
  );
}

export default function MyOverview() {
  return (
    <div>
      <PageHeader
        title="My giving & bills"
        subtitle="Your personal giving history, submitted bills, and reimbursement status."
        badge="Personal"
      />
      <MemberOverview />
    </div>
  );
}

/* ── Monthly giving bar chart ──────────────────────────────────────── */
function GivingBarChart({ data }: { data: { month: string; amount: number; label: string }[] }) {
  const maxVal = Math.max(...data.map((d) => d.amount), 1);
  const h = 120;
  const w = Math.max(data.length * 40, 280);
  const pad = { top: 10, right: 10, bottom: 28, left: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const barW = Math.min((chartW / data.length) * 0.7, 22);
  const gap = chartW / data.length;

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Monthly giving trend" className="mx-auto">
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + chartH} stroke="#d6d3d1" strokeWidth={1} />
        <line x1={pad.left} y1={pad.top + chartH} x2={w - pad.right} y2={pad.top + chartH} stroke="#d6d3d1" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = d.amount > 0 ? (d.amount / maxVal) * chartH : 0;
          const x = pad.left + i * gap + (gap - barW) / 2;
          const y = pad.top + chartH - barH;
          const step = Math.max(1, Math.floor(data.length / 7));
          const showLabel = i % step === 0 || i === data.length - 1;
          return (
            <g key={d.month}>
              <title>{`${d.label}: ${formatCurrency(d.amount)}`}</title>
              <rect x={x} y={y} width={barW} height={Math.max(barH, d.amount > 0 ? 2 : 0)} rx={3} fill={d.amount > 0 ? "#7C3AED" : "#e7e5e4"} opacity={d.amount > 0 ? 0.9 : 0.4} />
              {showLabel && <text x={x + barW / 2} y={h - pad.bottom + 13} textAnchor="middle" style={{ fontSize: 9 }} fill="#78716c">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
