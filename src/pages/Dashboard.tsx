import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  HandCoins,
  Receipt,
  Users,
  TrendingUp,
  CircleDollarSign,
  Plus,
} from "lucide-react";
import { Button, Card, CardBody, CardHeader, Tile, Badge, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase } from "@/lib/supabase";
import type { Profile, Donation, Expense } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

interface DashboardKpis {
  ytdGiving: number;
  donors: number;
  pendingExpenses: number;
  monthNet: number;
}

const zeroKpis: DashboardKpis = { ytdGiving: 0, donors: 0, pendingExpenses: 0, monthNet: 0 };
const FALLBACK_DONATIONS: Donation[] = [
  {
    id: "demo-1",
    donor_name: "The Hamilton Family",
    donor_email: null,
    amount: 500,
    donation_type: "tithe",
    payment_method: "check",
    donation_date: new Date().toISOString().slice(0, 10),
    entered_by: "demo",
    donor_id: null,
    check_number: "1042",
    notes: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-2",
    donor_name: "Anonymous",
    amount: 120,
    donation_type: "offering",
    payment_method: "cash",
    donation_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    entered_by: "demo",
    donor_id: null,
    donor_email: null,
    check_number: null,
    notes: null,
    created_at: new Date().toISOString(),
  },
];
const FALLBACK_EXPENSES: Expense[] = [
  {
    id: "demo-e1",
    source: "church_direct",
    title: "Electricity — December",
    amount: 184.32,
    category: "utilities",
    description: "Monthly utility bill",
    receipt_paths: [],
    transfer_receipt_path: null,
    user_id: null,
    status: "auto_paid",
    submitted_at: new Date().toISOString(),
    approved_by: null,
    approved_at: null,
    paid_at: new Date().toISOString(),
    paid_by: null,
    notes: null,
    created_at: new Date().toISOString(),
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
    submitted_at: new Date().toISOString(),
    approved_by: null,
    approved_at: null,
    paid_at: null,
    paid_by: null,
    notes: null,
    created_at: new Date().toISOString(),
  },
];

export default function Dashboard() {
  const { profile } = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const [kpis, setKpis] = useState<DashboardKpis>(zeroKpis);
  const [recentDonations, setRecentDonations] = useState<Donation[]>(FALLBACK_DONATIONS);
  const [recentExpenses, setRecentExpenses] = useState<Expense[]>(FALLBACK_EXPENSES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      try {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        const monthStart = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        ).toISOString();

        const [{ data: ytdRows }, { count: donorCount }, { count: pending }, { data: monthDon }, { data: monthExp }, { data: donations }, { data: expenses }] =
          await Promise.all([
            supabase.from("donations").select("amount").gte("donation_date", yearStart.slice(0, 10)),
            supabase.from("donors").select("id", { count: "exact", head: true }).eq("is_active", true),
            supabase.from("expenses").select("id", { count: "exact", head: true }).eq("status", "pending"),
            supabase.from("donations").select("amount").gte("donation_date", monthStart.slice(0, 10)),
            supabase.from("expenses").select("amount,status").gte("submitted_at", monthStart),
            supabase
              .from("donations")
              .select("*")
              .order("donation_date", { ascending: false })
              .limit(5),
            supabase
              .from("expenses")
              .select("*")
              .order("submitted_at", { ascending: false })
              .limit(5),
          ]);

        const ytdGiving = (ytdRows ?? []).reduce(
          (s: number, r: { amount: number }) => s + Number(r.amount ?? 0),
          0,
        );
        const monthDonSum = (monthDon ?? []).reduce(
          (s: number, r: { amount: number }) => s + Number(r.amount ?? 0),
          0,
        );
        const monthExpPaid = (monthExp ?? [])
          .filter((r: { status: string }) => r.status !== "rejected" && r.status !== "pending")
          .reduce((s: number, r: { amount: number }) => s + Number(r.amount ?? 0), 0);

        if (!cancelled) {
          setKpis({
            ytdGiving,
            donors: donorCount ?? 0,
            pendingExpenses: pending ?? 0,
            monthNet: monthDonSum - monthExpPaid,
          });
          if (donations) setRecentDonations(donations as Donation[]);
          if (expenses) setRecentExpenses(expenses as Expense[]);
        }
      } catch (err) {
        console.warn("Dashboard query failed; using mock data.", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.full_name ?? "treasurer"}`}
        subtitle="A snapshot of how your church is stewarding its resources this year."
        badge="Live"
        actions={
          <Button iconLeft={<Plus className="h-4 w-4" />} variant="solid">
            New donation
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="YTD Giving"
          value={formatCurrency(kpis.ytdGiving)}
          delta={loading ? undefined : "vs last month"}
          deltaPositive
          accent="indigo"
          icon={<HandCoins className="h-5 w-5" />}
        />
        <Tile
          label="Active donors"
          value={kpis.donors.toString()}
          accent="emerald"
          icon={<Users className="h-5 w-5" />}
        />
        <Tile
          label="Pending expenses"
          value={kpis.pendingExpenses.toString()}
          accent="amber"
          icon={<Receipt className="h-5 w-5" />}
        />
        <Tile
          label="This month's net"
          value={formatCurrency(kpis.monthNet)}
          deltaPositive={kpis.monthNet >= 0}
          accent={kpis.monthNet >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold text-stone-900">
                Recent donations
              </h2>
              <Badge tone="indigo">{recentDonations.length}</Badge>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {recentDonations.length === 0 ? (
              <EmptyState
                icon={<CircleDollarSign className="h-6 w-6" />}
                title="No donations yet"
                description="Once your first gift is recorded, it will show here."
              />
            ) : (
              recentDonations.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3 hover:bg-stone-50/60"
                >
                  <div>
                    <div className="font-medium text-stone-900">{d.donor_name}</div>
                    <div className="text-xs text-stone-500">
                      {formatDate(d.donation_date)} · {d.donation_type} · {d.payment_method}
                    </div>
                  </div>
                  <div className="font-serif text-lg font-semibold text-stone-900">
                    {formatCurrency(d.amount)}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold text-stone-900">
                Recent expenses
              </h2>
              <Badge tone="amber">{recentExpenses.length}</Badge>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {recentExpenses.length === 0 ? (
              <EmptyState
                icon={<Receipt className="h-6 w-6" />}
                title="No expenses logged"
                description="Track a member-submitted reimbursement or a church-direct expense to begin."
              />
            ) : (
              recentExpenses.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3 hover:bg-stone-50/60"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-stone-900">
                      {e.title ?? e.description ?? "—"}
                    </div>
                    <div className="text-xs text-stone-500">
                      {formatDate(e.submitted_at)} · {e.source === "church_direct" ? "Direct" : "Submitted"} ·{" "}
                      <Badge
                        tone={
                          e.status === "auto_paid" || e.status === "paid"
                            ? "emerald"
                            : e.status === "rejected"
                              ? "rose"
                              : e.status === "approved"
                                ? "indigo"
                                : "amber"
                        }
                      >
                        {e.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                  <div className="font-serif text-lg font-semibold text-stone-900">
                    {formatCurrency(e.amount)}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      {!supabase && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Demo mode.</strong> Numbers above are sample data. Set{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">VITE_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code> in your
          Freebuff project's API Keys tab to see live numbers from your church.
        </div>
      )}
    </div>
  );
}
