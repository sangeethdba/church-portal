import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { HandCoins, Receipt, TrendingUp, Church, Download, CreditCard, Banknote, Globe } from "lucide-react";
import {
  Card, CardBody, CardHeader, MotionTile, Badge, EmptyState,
  TableWrap, THead, Tr, Th, Td, Skeleton,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isOversightRole, type Profile, type Donation, type Expense } from "@/lib/supabase";
import { downloadAnnualConferenceReport, initPdfLogo, ALF_DOCUMENT_BRANDING, type ConferenceIncomeRow, type ConferenceExpenseRow } from "@/lib/pdf";
import { formatCurrency, formatDate } from "@/lib/utils";
import { donationTypeLabel } from "@/lib/accounting";

/// One Sunday-service collection row (the conference Sunday's whole plate).
interface OfferingRow {
  id: string;
  service_date: string;
  service_name: string;
  total_amount: number;
  cash_amount?: number;
  check_amount?: number;
  online_amount?: number;
}

const methodLabel = (m?: string | null) =>
  !m ? "—" : m === "check" ? "Check" : m === "cash" ? "Cash" : m === "online" ? "Online" : m === "card" ? "Card" : m.replace(/_/g, " ");

const expenseStatusLabel = (s: string) =>
  s === "paid" || s === "auto_paid"
    ? { text: "Paid", tone: "emerald" as const }
    : s === "approved"
      ? { text: "Approved", tone: "indigo" as const }
      : s === "rejected"
        ? { text: "Rejected", tone: "rose" as const }
        : { text: "Pending", tone: "amber" as const };

export default function AnnualConference() {
  const { profile } = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const isOversight = isOversightRole(profile?.role);

  const [donations, setDonations] = useState<Donation[]>([]);
  const [offerings, setOfferings] = useState<OfferingRow[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    if (!isOversight) {
      setLoading(false);
      return;
    }
    (async () => {
      const [donRes, offRes, expRes] = await Promise.all([
        supabase
          .from("donations")
          .select("*")
          .eq("donation_type", "annual_conference")
          .order("donation_date", { ascending: false }),
        supabase
          .from("offerings")
          .select("*")
          .eq("service_name", "Annual Conference")
          .order("service_date", { ascending: false }),
        supabase
          .from("expenses")
          .select("*")
          .or("event_name.ilike.%annual conference%,category.eq.conference")
          .order("submitted_at", { ascending: false }),
      ]);
      setDonations((donRes.data as Donation[]) ?? []);
      setOfferings((offRes.data as OfferingRow[]) ?? []);
      setExpenses((expRes.data as Expense[]) ?? []);
    })().finally(() => setLoading(false));
  }, [isOversight]);

  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try {
      await initPdfLogo();
      const incomeRows: ConferenceIncomeRow[] = [
        ...donations.map((d) => ({
          date: d.donation_date,
          from: d.donor_name || "Anonymous",
          type: donationTypeLabel(d.donation_type),
          amount: Number(d.amount ?? 0),
        })),
        ...offerings.map((o) => ({
          date: o.service_date,
          from: `${o.service_name} offering`,
          type: "Offering plate",
          amount: Number(o.total_amount ?? 0),
        })),
      ].sort((a, b) => a.date.localeCompare(b.date));

      const expenseRows: ConferenceExpenseRow[] = expenses.map((e) => ({
        date: e.submitted_at,
        payee: e.title || e.description || "—",
        category: e.category.replace(/_/g, " "),
        method: e.payment_method ? e.payment_method.replace(/_/g, " ") : "—",
        amount: Number(e.amount ?? 0),
      }));

      downloadAnnualConferenceReport({
        churchName: ALF_DOCUMENT_BRANDING.name,
        year: new Date().getFullYear(),
        incomeRows,
        incomeTotal,
        expenseRows,
        expenseTotal,
        net,
        generatedBy: profile?.full_name || "Treasurer",
      });
    } finally {
      setGeneratingPdf(false);
    }
  };

  const donationTotal = donations.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const offeringTotal = offerings.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
  const incomeTotal = donationTotal + offeringTotal;
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const net = incomeTotal - expenseTotal;

  // Payment method breakdown across all income
  const cashTotal = donations
    .filter((d) => d.payment_method === "cash")
    .reduce((s, d) => s + Number(d.amount ?? 0), 0)
    + offerings.reduce((s, o) => s + Number(o.cash_amount ?? 0), 0);
  const checkTotal = donations
    .filter((d) => d.payment_method === "check")
    .reduce((s, d) => s + Number(d.amount ?? 0), 0)
    + offerings.reduce((s, o) => s + Number(o.check_amount ?? 0), 0);
  const onlineTotal = donations
    .filter((d) => d.payment_method === "online" || d.payment_method === "card")
    .reduce((s, d) => s + Number(d.amount ?? 0), 0)
    + offerings.reduce((s, o) => s + Number(o.online_amount ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="Annual Conference"
        subtitle="Everything given toward and spent on the Annual Conference — donations, the conference-Sunday collection, and linked expenses."
        badge="Report"
      />

      {!isOversight ? (
        <Card>
          <CardBody>
            <EmptyState icon={<Church className="h-6 w-6" />} title="Admin only" description="The Annual Conference report is available to admins, treasurers, and overseers." />
          </CardBody>
        </Card>
      ) : loading ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
          <Skeleton className="col-span-full h-48 w-full" />
        </div>
      ) : (
        <>
          {/* ── Primary KPI strip ───────────────────────────────────────── */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MotionTile
              label="Conference income"
              value={formatCurrency(incomeTotal)}
              accent={incomeTotal >= 0 ? "emerald" : "rose"}
              icon={<HandCoins className="h-5 w-5" />}
              index={0}
            />
            <MotionTile
              label="Conference expenses"
              value={formatCurrency(expenseTotal)}
              accent={expenseTotal > 0 ? "rose" : "emerald"}
              icon={<Receipt className="h-5 w-5" />}
              index={1}
            />
            <MotionTile
              label="Net to conference"
              value={formatCurrency(net)}
              accent={net >= 0 ? "emerald" : "rose"}
              icon={<TrendingUp className="h-5 w-5" />}
              delta={net >= 0 ? "Surplus" : "Deficit"}
              deltaPositive={net >= 0}
              index={2}
            />
          </div>

          {/* ── Payment method breakdown ─────────────────────────────────── */}
          {incomeTotal > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50">
                  <Banknote className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Cash</div>
                  <div className="font-serif text-lg font-semibold text-stone-800">{formatCurrency(cashTotal)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50">
                  <CreditCard className="h-4 w-4 text-indigo-600" />
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Checks</div>
                  <div className="font-serif text-lg font-semibold text-stone-800">{formatCurrency(checkTotal)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                  <Globe className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Online / Card</div>
                  <div className="font-serif text-lg font-semibold text-stone-800">{formatCurrency(onlineTotal)}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Download PDF ─────────────────────────────────────────────── */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleDownloadPdf}
              disabled={generatingPdf}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent/90 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {generatingPdf ? "Generating…" : "Download PDF report"}
            </button>
          </div>

          <div className="mt-6 space-y-6">
            {/* ── Income summary cards ─────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>Earmarked gifts</CardHeader>
                <CardBody>
                  <p className="text-2xl font-semibold">{formatCurrency(donationTotal)}</p>
                  <p className="text-xs text-stone-500">
                    {donations.length} donation{donations.length === 1 ? "" : "s"} tagged "Annual Conference" on the Donations page.
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardHeader>Conference Sunday collection</CardHeader>
                <CardBody>
                  <p className="text-2xl font-semibold">{formatCurrency(offeringTotal)}</p>
                  <p className="text-xs text-stone-500">
                    {offerings.length} offering{offerings.length === 1 ? "" : "s"} recorded with Service name "Annual Conference" on the Offerings page.
                  </p>
                </CardBody>
              </Card>
            </div>

            {/* ── Income detail table ──────────────────────────────────── */}
            <Card>
              <CardHeader>Income — donations & conference-Sunday collection</CardHeader>
              <CardBody>
                {donationTotal === 0 && offeringTotal === 0 ? (
                  <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No conference income yet" description={"Tag donations as “Annual Conference” on the Donations page, and record the conference Sunday with Service name “Annual Conference” on the Offerings page."} />
                ) : (
                  <TableWrap>
                    <THead>
                      <Th>Date</Th>
                      <Th>From</Th>
                      <Th>Method</Th>
                      <Th>Check #</Th>
                      <Th>Note</Th>
                      <Th className="text-right">Amount</Th>
                    </THead>
                    <tbody>
                      {donations.map((d) => (
                        <Tr key={d.id}>
                          <Td>{formatDate(d.donation_date)}</Td>
                          <Td className="font-medium">{d.donor_name || "Anonymous"}</Td>
                          <Td><Badge tone="indigo">{methodLabel(d.payment_method)}</Badge></Td>
                          <Td className="text-stone-500">{d.check_number || "—"}</Td>
                          <Td className="max-w-[140px] truncate text-stone-500" title={d.notes || undefined}>{d.notes || "—"}</Td>
                          <Td className="text-right font-medium">{formatCurrency(Number(d.amount ?? 0))}</Td>
                        </Tr>
                      ))}
                      {offerings.map((o) => (
                        <Tr key={o.id}>
                          <Td>{formatDate(o.service_date)}</Td>
                          <Td className="font-medium">{o.service_name} offering</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              {Number(o.cash_amount ?? 0) > 0 && <Badge tone="amber">Cash {formatCurrency(o.cash_amount!)}</Badge>}
                              {Number(o.check_amount ?? 0) > 0 && <Badge tone="indigo">Check {formatCurrency(o.check_amount!)}</Badge>}
                              {Number(o.online_amount ?? 0) > 0 && <Badge tone="emerald">Online {formatCurrency(o.online_amount!)}</Badge>}
                              {!o.cash_amount && !o.check_amount && !o.online_amount && <Badge tone="indigo">Offering plate</Badge>}
                            </div>
                          </Td>
                          <Td className="text-stone-500">—</Td>
                          <Td className="text-stone-500">—</Td>
                          <Td className="text-right font-medium">{formatCurrency(Number(o.total_amount ?? 0))}</Td>
                        </Tr>
                      ))}
                      <Tr>
                        <Td className="font-semibold" colSpan={5}>Total conference income</Td>
                        <Td className="text-right font-semibold">{formatCurrency(incomeTotal)}</Td>
                      </Tr>
                    </tbody>
                  </TableWrap>
                )}
              </CardBody>
            </Card>

            {/* ── Expenses detail table ─────────────────────────────────── */}
            <Card>
              <CardHeader>Expenses — linked to Annual Conference</CardHeader>
              <CardBody>
                {expenseTotal === 0 ? (
                  <EmptyState icon={<Receipt className="h-6 w-6" />} title="No conference expenses yet" description={"Tag expenses with the event “Annual Conference”, or use the “Conference” category, on the Expenses page."} />
                ) : (
                  <TableWrap>
                    <THead>
                      <Th>Date</Th>
                      <Th>Payee / title</Th>
                      <Th>Category</Th>
                      <Th>Method</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Amount</Th>
                    </THead>
                    <tbody>
                      {expenses.map((e) => {
                        const st = expenseStatusLabel(e.status);
                        return (
                          <Tr key={e.id}>
                            <Td>{formatDate(e.submitted_at)}</Td>
                            <Td className="font-medium">{e.title || e.description || "—"}</Td>
                            <Td>{e.category.replace(/_/g, " ")}</Td>
                            <Td>{methodLabel(e.payment_method)}</Td>
                            <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
                            <Td className="text-right font-medium">{formatCurrency(Number(e.amount ?? 0))}</Td>
                          </Tr>
                        );
                      })}
                      <Tr>
                        <Td className="font-semibold" colSpan={5}>Total conference expenses</Td>
                        <Td className="text-right font-semibold">{formatCurrency(expenseTotal)}</Td>
                      </Tr>
                    </tbody>
                  </TableWrap>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
