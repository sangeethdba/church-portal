import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { HandCoins, Receipt, TrendingUp, Church } from "lucide-react";
import {
  Card, CardBody, CardHeader, MotionTile, Badge, EmptyState,
  TableWrap, THead, Tr, Th, Td, Skeleton,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isOversightRole, type Profile, type Donation, type Expense } from "@/lib/supabase";
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
}

export default function AnnualConference() {
  const { profile } = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const isOversight = isOversightRole(profile?.role);

  const [donations, setDonations] = useState<Donation[]>([]);
  const [offerings, setOfferings] = useState<OfferingRow[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

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

  const donationTotal = donations.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const offeringTotal = offerings.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
  const incomeTotal = donationTotal + offeringTotal;
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const net = incomeTotal - expenseTotal;

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

          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>Earmarked gifts</CardHeader>
                <CardBody>
                  <p className="text-2xl font-semibold">{formatCurrency(donationTotal)}</p>
                  <p className="text-xs text-stone-500">
                    {donations.length} donation{donations.length === 1 ? "" : "s"} tagged “Annual Conference” on the Donations page.
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardHeader>Conference Sunday collection</CardHeader>
                <CardBody>
                  <p className="text-2xl font-semibold">{formatCurrency(offeringTotal)}</p>
                  <p className="text-xs text-stone-500">
                    {offerings.length} offering{offerings.length === 1 ? "" : "s"} recorded with Service name “Annual Conference” on the Offerings page.
                  </p>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader>Income — donations & conference-Sunday collection</CardHeader>
              <CardBody>
                {donationTotal === 0 && offeringTotal === 0 ? (
                  <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No conference income yet" description="Tag donations as “Annual Conference” on the Donations page, and record the conference Sunday with Service name “Annual Conference” on the Offerings page." />
                ) : (
                  <TableWrap>
                    <THead>
                      <Th>Date</Th>
                      <Th>From</Th>
                      <Th>Type</Th>
                      <Th className="text-right">Amount</Th>
                    </THead>
                    <tbody>
                      {donations.map((d) => (
                        <Tr key={d.id}>
                          <Td>{formatDate(d.donation_date)}</Td>
                          <Td>{d.donor_name || "Anonymous"}</Td>
                          <Td><Badge tone="indigo">{donationTypeLabel(d.donation_type)}</Badge></Td>
                          <Td className="text-right">{formatCurrency(Number(d.amount ?? 0))}</Td>
                        </Tr>
                      ))}
                      {offerings.map((o) => (
                        <Tr key={o.id}>
                          <Td>{formatDate(o.service_date)}</Td>
                          <Td>{o.service_name} offering</Td>
                          <Td><Badge tone="indigo">Offering plate</Badge></Td>
                          <Td className="text-right">{formatCurrency(Number(o.total_amount ?? 0))}</Td>
                        </Tr>
                      ))}
                      <Tr>
                        <Td className="font-semibold" colSpan={3}>Total conference income</Td>
                        <Td className="text-right font-semibold">{formatCurrency(incomeTotal)}</Td>
                      </Tr>
                    </tbody>
                  </TableWrap>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>Expenses — linked to Annual Conference</CardHeader>
              <CardBody>
                {expenseTotal === 0 ? (
                  <EmptyState icon={<Receipt className="h-6 w-6" />} title="No conference expenses yet" description="Tag expenses with the event “Annual Conference”, or use the “Conference” category, on the Expenses page." />
                ) : (
                  <TableWrap>
                    <THead>
                      <Th>Date</Th>
                      <Th>Payee / title</Th>
                      <Th>Category</Th>
                      <Th>Method</Th>
                      <Th className="text-right">Amount</Th>
                    </THead>
                    <tbody>
                      {expenses.map((e) => (
                        <Tr key={e.id}>
                          <Td>{formatDate(e.submitted_at)}</Td>
                          <Td>{e.title || e.description || "—"}</Td>
                          <Td>{e.category.replace(/_/g, " ")}</Td>
                          <Td>{e.payment_method ? e.payment_method.replace(/_/g, " ") : "—"}</Td>
                          <Td className="text-right">{formatCurrency(Number(e.amount ?? 0))}</Td>
                        </Tr>
                      ))}
                      <Tr>
                        <Td className="font-semibold" colSpan={4}>Total conference expenses</Td>
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