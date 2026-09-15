import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { HandCoins, Receipt, TrendingUp, Church, Download, CreditCard, Banknote, Globe, User } from "lucide-react";
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

/// Individual check or cash gift row inside an offering.
interface OfferingCheckRow {
  id: string;
  offering_id: string;
  donor_name: string;
  check_number?: string | null;
  amount: number;
  method: string;
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
  const [offeringChecks, setOfferingChecks] = useState<Record<string, OfferingCheckRow[]>>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [submitterNames, setSubmitterNames] = useState<Record<string, string>>({});
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
          .neq("status", "rejected")
          .order("submitted_at", { ascending: false }),
      ]);

      const dons = (donRes.data as Donation[]) ?? [];
      const offs = (offRes.data as OfferingRow[]) ?? [];
      const exps = (expRes.data as Expense[]) ?? [];

      setDonations(dons);
      setOfferings(offs);
      setExpenses(exps);

      // Fetch individual check/cash-gift rows for each offering
      if (offs.length > 0) {
        const offeringIds = offs.map((o) => o.id);

        // offering_checks = checks from the deposit slip
        const checksRes = await supabase
          .from("offering_checks")
          .select("*")
          .in("offering_id", offeringIds)
          .order("amount", { ascending: false });

        // donations linked to offering = named cash gifts recorded separately
        const giftsRes = await supabase
          .from("donations")
          .select("id, offering_id, donor_name, amount, payment_method")
          .in("offering_id", offeringIds)
          .eq("payment_method", "cash")
          .order("amount", { ascending: false });

        const grouped: Record<string, OfferingCheckRow[]> = {};
        for (const row of (checksRes.data ?? []) as OfferingCheckRow[]) {
          (grouped[row.offering_id] ??= []).push(row);
        }
        // Merge named cash gifts from donations table
        for (const row of (giftsRes.data ?? []) as { id: string; offering_id: string; donor_name: string; amount: number; payment_method: string }[]) {
          (grouped[row.offering_id] ??= []).push({
            id: row.id,
            offering_id: row.offering_id,
            donor_name: row.donor_name || "Anonymous cash",
            check_number: null,
            amount: Number(row.amount ?? 0),
            method: "cash",
          });
        }
        setOfferingChecks(grouped);
      }

      // Resolve submitter names from profiles
      const userIds = [...new Set(exps.map((e) => e.user_id).filter(Boolean) as string[])];
      if (userIds.length > 0) {
        const profilesRes = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        const nameMap: Record<string, string> = {};
        for (const p of (profilesRes.data ?? []) as { id: string; full_name: string | null }[]) {
          nameMap[p.id] = p.full_name ?? "Unknown";
        }
        setSubmitterNames(nameMap);
      }
    })().finally(() => setLoading(false));
  }, [isOversight]);

  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try {
      await initPdfLogo();
      // Expand each offering into its individual check / cash-gift rows
      const offeringIncomeRows: ConferenceIncomeRow[] = offerings.flatMap((o) => {
        const checks = offeringChecks[o.id] ?? [];
        if (checks.length === 0) {
          // No individual rows recorded — show the aggregate
          return [{
            date: o.service_date,
            from: `${o.service_name} offering`,
            type: "Offering plate",
            checkNumber: null,
            note: null,
            amount: Number(o.total_amount ?? 0),
          }];
        }
        return checks.map((ck) => ({
          date: o.service_date,
          from: ck.donor_name || (ck.method === "cash" ? "Anonymous cash" : "\u2014"),
          type: ck.method === "cash" ? "Named cash" : "Check",
          checkNumber: ck.check_number || null,
          note: null,
          amount: Number(ck.amount ?? 0),
        }));
      });

      const incomeRows: ConferenceIncomeRow[] = [
        ...donations.map((d) => ({
          date: d.donation_date,
          from: d.donor_name || "Anonymous",
          type: donationTypeLabel(d.donation_type),
          checkNumber: d.check_number || null,
          note: d.notes || null,
          amount: Number(d.amount ?? 0),
        })),
        ...offeringIncomeRows,
      ].sort((a, b) => a.date.localeCompare(b.date));

      const expenseRows: ConferenceExpenseRow[] = expenses.map((e) => ({
        date: e.submitted_at,
        payee: e.title || e.description || "\u2014",
        submittedBy: e.user_id ? (submitterNames[e.user_id] || null) : (e.source === "church_direct" ? "Church" : null),
        category: e.category.replace(/_/g, " "),
        method: e.payment_method ? e.payment_method.replace(/_/g, " ") : "\u2014",
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
  const rawCashTotal = donations
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
  // Named cash = individual cash gifts with donor names from conference Sunday offering
  const namedCashTotal = Object.values(offeringChecks)
    .flat()
    .filter((ck) => ck.method === "cash")
    .reduce((s, ck) => s + Number(ck.amount ?? 0), 0);
  const cashTotal = rawCashTotal - namedCashTotal;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="Annual Conference"
        subtitle="Everything given toward and spent on the Annual Conference \u2014 donations, the conference-Sunday collection, and linked expenses."
        badge="Report"
      />

      {!isOversight ? (
        <Card>
          <CardBody>
            <EmptyState icon={<Church className="h-6 w-6" />} title="Admin only" description="The Annual Conference report is available to admins, treasurers, and overseers." />
          </CardBody>
        </Card>
      ) : loading ? (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
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
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50">
                  <User className="h-4 w-4 text-orange-600" />
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Named Cash</div>
                  <div className="font-serif text-lg font-semibold text-stone-800">{formatCurrency(namedCashTotal)}</div>
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
              {generatingPdf ? "Generating\u2026" : "Download PDF report"}
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
                    {donations.length} donation{donations.length === 1 ? "" : "s"} tagged &ldquo;Annual Conference&rdquo; on the Donations page.
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardHeader>Conference Sunday collection</CardHeader>
                <CardBody>
                  <p className="text-2xl font-semibold">{formatCurrency(offeringTotal)}</p>
                  <p className="text-xs text-stone-500">
                    {offerings.length} offering{offerings.length === 1 ? "" : "s"} recorded with Service name &ldquo;Annual Conference&rdquo; on the Offerings page.
                  </p>
                </CardBody>
              </Card>
            </div>

            {/* ── Income detail table ──────────────────────────────────── */}
            <Card>
              <CardHeader>Income \u2014 donations &amp; conference-Sunday collection</CardHeader>
              <CardBody>
                {donationTotal === 0 && offeringTotal === 0 ? (
                  <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No conference income yet" description={'Tag donations as \u201cAnnual Conference\u201d on the Donations page, and record the conference Sunday with Service name \u201cAnnual Conference\u201d on the Offerings page.'} />
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
                      {/* Individual named donations */}
                      {donations.map((d) => (
                        <Tr key={d.id}>
                          <Td>{formatDate(d.donation_date)}</Td>
                          <Td className="font-medium">{d.donor_name || "Anonymous"}</Td>
                          <Td><Badge tone="indigo">{methodLabel(d.payment_method)}</Badge></Td>
                          <Td className="text-stone-500">{d.check_number || "\u2014"}</Td>
                          <Td className="max-w-[140px] truncate text-stone-500" title={d.notes || undefined}>{d.notes || "\u2014"}</Td>
                          <Td className="text-right font-medium">{formatCurrency(Number(d.amount ?? 0))}</Td>
                        </Tr>
                      ))}

                      {/* Conference-Sunday offering: individual check & cash-gift rows */}
                      {offerings.map((o) => {
                        const checks = offeringChecks[o.id] ?? [];
                        if (checks.length === 0) {
                          // No individual rows — show the aggregate
                          return (
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
                              <Td className="text-stone-500">{"\u2014"}</Td>
                              <Td className="text-stone-500">{"\u2014"}</Td>
                              <Td className="text-right font-medium">{formatCurrency(Number(o.total_amount ?? 0))}</Td>
                            </Tr>
                          );
                        }

                        // Render each individual check/cash gift as its own row
                        return checks.map((ck, idx) => (
                          <Tr key={`${o.id}-${ck.id}`}>
                            <Td>{idx === 0 ? formatDate(o.service_date) : ""}</Td>
                            <Td className="font-medium">
                              {ck.donor_name || (ck.method === "cash" ? "Anonymous cash" : "\u2014")}
                              {idx === 0 && <span className="ml-1 text-xs text-stone-400">{o.service_name}</span>}
                            </Td>
                            <Td>
                              <Badge tone={ck.method === "cash" ? "amber" : "indigo"}>
                                {ck.method === "cash" ? "Named cash" : "Check"}
                              </Badge>
                            </Td>
                            <Td className="text-stone-500">{ck.check_number || "\u2014"}</Td>
                            <Td className="text-stone-500">{"\u2014"}</Td>
                            <Td className="text-right font-medium">{formatCurrency(Number(ck.amount ?? 0))}</Td>
                          </Tr>
                        ));
                      })}

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
              <CardHeader>Expenses \u2014 linked to Annual Conference</CardHeader>
              <CardBody>
                {expenseTotal === 0 ? (
                  <EmptyState icon={<Receipt className="h-6 w-6" />} title="No conference expenses yet" description={'Tag expenses with the event \u201cAnnual Conference\u201d, or use the \u201cConference\u201d category, on the Expenses page.'} />
                ) : (
                  <TableWrap>
                    <THead>
                      <Th>Date</Th>
                      <Th>Payee / title</Th>
                      <Th>Submitted by</Th>
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
                            <Td className="font-medium">{e.title || e.description || "\u2014"}</Td>
                            <Td className="text-stone-500">
                              {e.user_id ? (submitterNames[e.user_id] || "\u2014") : (e.source === "church_direct" ? "Church" : "\u2014")}
                            </Td>
                            <Td>{e.category.replace(/_/g, " ")}</Td>
                            <Td>{methodLabel(e.payment_method)}</Td>
                            <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
                            <Td className="text-right font-medium">{formatCurrency(Number(e.amount ?? 0))}</Td>
                          </Tr>
                        );
                      })}
                      <Tr>
                        <Td className="font-semibold" colSpan={6}>Total conference expenses</Td>
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
