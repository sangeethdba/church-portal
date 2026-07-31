import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  HandCoins, Receipt, Users, TrendingUp, CircleDollarSign, Plus,
  Shield, UserCheck, Lock, Banknote, UserPlus,
} from "lucide-react";
import { Button, Card, CardBody, CardHeader, Tile, Badge, EmptyState, Input, Label, Select } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { MemberOverview } from "@/pages/MyOverview";
import { supabase, isAdminRole } from "@/lib/supabase";
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
  { id: "demo-1", donor_name: "The Hamilton Family", donor_email: null, amount: 500, donation_type: "tithe", payment_method: "check", donation_date: new Date().toISOString().slice(0, 10), entered_by: "demo", donor_id: null, check_number: "1042", notes: null, created_at: new Date().toISOString() },
  { id: "demo-2", donor_name: "Anonymous", amount: 120, donation_type: "offering", payment_method: "cash", donation_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), entered_by: "demo", donor_id: null, donor_email: null, check_number: null, notes: null, created_at: new Date().toISOString() },
];
const FALLBACK_EXPENSES: Expense[] = [
  { id: "demo-e1", source: "church_direct", title: "Electricity — December", amount: 184.32, category: "utilities", description: "Monthly utility bill", receipt_paths: [], transfer_receipt_path: null, user_id: null, status: "auto_paid", submitted_at: new Date().toISOString(), approved_by: null, approved_at: null, paid_at: new Date().toISOString(), paid_by: null, notes: null, created_at: new Date().toISOString() },
  { id: "demo-e2", source: "member_submitted", title: "Sunday school supplies", amount: 47.5, category: "supplies", description: "Markers, construction paper, glue", receipt_paths: [], transfer_receipt_path: null, user_id: null, status: "pending", submitted_at: new Date().toISOString(), approved_by: null, approved_at: null, paid_at: null, paid_by: null, notes: null, created_at: new Date().toISOString() },
];

interface RecentItem { id: string; date: string; name: string; meta: string; amount: number; }
const FALLBACK_RECENT: RecentItem[] = FALLBACK_DONATIONS.map((d) => ({
  id: d.id,
  date: d.donation_date,
  name: d.donor_name,
  meta: `${d.donation_type} · ${d.payment_method}`,
  amount: Number(d.amount ?? 0),
}));

export default function Dashboard() {
  const { profile } = useOutletContext<{ profile: Profile | null; isCounter: boolean }>();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<DashboardKpis>(zeroKpis);
  const [recentItems, setRecentItems] = useState<RecentItem[]>(FALLBACK_RECENT);
  const [recentExpenses, setRecentExpenses] = useState<Expense[]>(FALLBACK_EXPENSES);
  const [loading, setLoading] = useState(true);
  const [pendingDeposits, setPendingDeposits] = useState(0);
  const [pendingDepositTotal, setPendingDepositTotal] = useState(0);
  const [ytdExpenses, setYtdExpenses] = useState(0);
  const [ytdNet, setYtdNet] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const isAdmin = isAdminRole(profile?.role);
  const [counterOpen, setCounterOpen] = useState(false);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [donorOptions, setDonorOptions] = useState<{ id: string; label: string }[]>([]);
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [quickCreateFor, setQuickCreateFor] = useState<string | null>(null);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [quickCreateSaving, setQuickCreateSaving] = useState(false);

  const loadProfiles = async () => {
    if (!supabase) return;
    const [profilesRes, donorsRes] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name, role, is_counter, portal_access, linked_donor_id").order("full_name"),
      supabase.from("donors").select("id, first_name, last_name").order("last_name"),
    ]);
    if (profilesRes.data) { setAllProfiles(profilesRes.data as Profile[]); setPinInputs({}); }
    if (donorsRes.data) {
      setDonorOptions((donorsRes.data as { id: string; first_name: string; last_name: string }[]).map((d) => ({ id: d.id, label: `${d.first_name} ${d.last_name}` })));
    }
  };

  const togglePortalAccess = async (userId: string, newVal: boolean) => {
    if (!supabase) return;
    setSavingId(userId);
    await supabase.from("profiles").update({ portal_access: newVal }).eq("id", userId);
    setAllProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, portal_access: newVal } : p)));
    setSavingId(null);
  };

  const linkDonor = async (userId: string, donorId: string) => {
    if (!supabase) return;
    setSavingId(userId);
    // Clear any previous link for this donor, then link the profile (both sides so it survives reopen)
    await supabase.from("donors").update({ linked_user_id: userId }).eq("id", donorId);
    await supabase.from("profiles").update({ linked_donor_id: donorId }).eq("id", userId);
    setAllProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, linked_donor_id: donorId } : p)));
    setSavingId(null);
  };

  const createAndLinkDonor = async (userId: string) => {
    if (!supabase || !quickCreateName.trim()) return;
    const parts = quickCreateName.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ") || firstName;
    setQuickCreateSaving(true);
    const { data, error } = await supabase
      .from("donors")
      .insert({ first_name: firstName, last_name: lastName, linked_user_id: userId })
      .select("id, first_name, last_name")
      .maybeSingle();
    if (error) { console.warn("Create donor failed:", error); setQuickCreateSaving(false); return; }
    if (data) {
      await supabase.from("profiles").update({ linked_donor_id: data.id }).eq("id", userId);
      setDonorOptions((prev) => [...prev, { id: data.id, label: `${data.first_name} ${data.last_name}` }]);
      setAllProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, linked_donor_id: data.id } : p)));
    }
    setQuickCreateName("");
    setQuickCreateFor(null);
    setQuickCreateSaving(false);
  };

  const toggleCounter = async (userId: string, newVal: boolean) => {
    if (!supabase) return;
    setSavingId(userId);
    await supabase.from("profiles").update({ is_counter: newVal }).eq("id", userId);
    setAllProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, is_counter: newVal } : p)));
    setSavingId(null);
  };

  const setPin = async (userId: string) => {
    if (!supabase) return;
    const pin = pinInputs[userId];
    if (!pin || pin.length < 3) return;
    setSavingId(userId);
    const { data: hash } = await supabase.rpc("hash_pin", { pin });
    if (hash) await supabase.from("profiles").update({ pin_hash: hash }).eq("id", userId);
    setPinInputs((prev) => ({ ...prev, [userId]: "" }));
    setSavingId(null);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      try {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const [{ data: ytdRows }, { count: donorCount }, { count: pending }, { data: monthDon }, { data: monthExp }, { data: donations }, { data: expenses }, { data: pendingOff }, { data: ytdExpData }, { data: profilesAll }, { data: ytdOfferings }, { data: monthOfferings }, { data: recentOfferings }] = await Promise.all([
          supabase.from("donations").select("amount, offering_id").gte("donation_date", yearStart.slice(0, 10)),
          supabase.from("donors").select("id", { count: "exact", head: true }).eq("is_active", true),
          supabase.from("expenses").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("donations").select("amount, offering_id").gte("donation_date", monthStart.slice(0, 10)),
          supabase.from("expenses").select("amount,status").gte("submitted_at", monthStart),
          supabase.from("donations").select("*").order("donation_date", { ascending: false }).limit(5),
          supabase.from("expenses").select("*").order("submitted_at", { ascending: false }).limit(5),
          supabase.from("offerings").select("total_amount").eq("deposit_status", "pending_deposit"),
          supabase.from("expenses").select("amount").gte("submitted_at", yearStart),
          supabase.from("profiles").select("role, portal_access"),
          supabase.from("offerings").select("total_amount").gte("service_date", yearStart.slice(0, 10)),
          supabase.from("offerings").select("total_amount").gte("service_date", monthStart.slice(0, 10)),
          supabase.from("offerings").select("service_name, service_date, total_amount").order("service_date", { ascending: false }).limit(5),
        ]);
        // YTD giving = weekly offerings (cash + checks) + standalone gifts, no double counting
        const standaloneGiving = (ytdRows ?? []).filter((r: { offering_id?: string | null }) => !r.offering_id).reduce((s: number, r: { amount: number }) => s + Number(r.amount ?? 0), 0);
        const offeringGiving = (ytdOfferings ?? []).reduce((s: number, r: { total_amount: number }) => s + Number(r.total_amount ?? 0), 0);
        const ytdGiving = standaloneGiving + offeringGiving;
        const monthDonSum = (monthDon ?? []).filter((r: { offering_id?: string | null }) => !r.offering_id).reduce((s: number, r: { amount: number }) => s + Number(r.amount ?? 0), 0)
          + (monthOfferings ?? []).reduce((s: number, r: { total_amount: number }) => s + Number(r.total_amount ?? 0), 0);
        const monthExpPaid = (monthExp ?? []).filter((r: { status: string }) => r.status !== "rejected" && r.status !== "pending").reduce((s: number, r: { amount: number }) => s + Number(r.amount ?? 0), 0);
        if (!cancelled) {
          setKpis({ ytdGiving, donors: donorCount ?? 0, pendingExpenses: pending ?? 0, monthNet: monthDonSum - monthExpPaid });
          if (profilesAll) {
            setPendingApprovals((profilesAll as { role: string; portal_access: boolean }[]).filter((p) => !isAdminRole(p.role) && !p.portal_access).length);
          }
          if (pendingOff) { setPendingDeposits(pendingOff.length); setPendingDepositTotal(pendingOff.reduce((s: number, r: { total_amount: number }) => s + Number(r.total_amount ?? 0), 0)); }
          if (ytdExpData) {
            const expPaidOrApproved = (ytdExpData as { amount: number; status: string }[]).filter((r) => r.status !== "rejected" && r.status !== "pending");
            const expTotal = expPaidOrApproved.reduce((s: number, r: { amount: number }) => s + Number(r.amount ?? 0), 0);
            setYtdExpenses(expTotal);
            setYtdNet(ytdGiving - expTotal);
          }
          const combined = [
            ...(recentOfferings ?? []).map((o: { service_name: string; service_date: string; total_amount: number }) => ({ id: `off-${o.service_date}-${o.service_name}`, date: o.service_date, name: `${o.service_name} collection`, meta: "cash + checks", amount: Number(o.total_amount ?? 0) })),
            ...(donations ?? []).map((d) => ({ id: d.id, date: d.donation_date, name: d.donor_name, meta: `${d.donation_type} · ${d.payment_method}`, amount: Number(d.amount ?? 0) })),
          ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
          setRecentItems(combined);
          if (expenses) setRecentExpenses(expenses as Expense[]);
        }
      } catch (err) { console.warn("Dashboard query failed; using mock data.", err); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title={`Welcome, ${profile?.full_name ?? "member"}`} subtitle="Your personal giving, submitted bills, and reimbursement status." badge="Member" />
        <MemberOverview />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.full_name ?? "treasurer"}`}
        subtitle="A snapshot of how your church is stewarding its resources this year."
        badge="Live"
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Dialog open={counterOpen} onOpenChange={(v) => { setCounterOpen(v); if (v) loadProfiles(); }}>
                <DialogTrigger asChild>
                  <Button iconLeft={<Shield className="h-4 w-4" />} variant="outline">
                    Manage members & access
                    {pendingApprovals > 0 && <Badge tone="amber" className="ml-2">{pendingApprovals} pending</Badge>}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>Manage members & access</DialogTitle><DialogDescription>Approve who can use the portal, link members to donor records, and designate counters with sign-off PINs.</DialogDescription></DialogHeader>
                  <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600"><Shield className="mb-1 inline h-4 w-4 text-amber-500" /> Anyone with a Google account can sign in — but only members with <strong>Portal access</strong> approved here can view data or submit expenses.</div>
                  <div className="mt-3 space-y-2">
                    {allProfiles.map((p) => (
                      <div key={p.id} className="rounded-lg border border-stone-100 px-3 py-2.5 hover:bg-stone-50/50">
                        <div className="flex items-center gap-3">
                          {/* Portal access toggle */}
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => togglePortalAccess(p.id, !p.portal_access)} disabled={savingId === p.id || isAdminRole(p.role)}
                              title={isAdminRole(p.role) ? "Admins always have access" : "Toggle portal access"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition ${p.portal_access || isAdminRole(p.role) ? "bg-indigo-500" : "bg-stone-300"} ${savingId === p.id ? "opacity-50" : ""}`}>
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${p.portal_access || isAdminRole(p.role) ? "translate-x-6" : "translate-x-1"}`}/>
                            </button>
                            <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Access</span>
                          </div>
                          {/* Counter toggle */}
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => toggleCounter(p.id, !p.is_counter)} disabled={savingId === p.id}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition ${p.is_counter ? "bg-emerald-500" : "bg-stone-300"}`}>
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${p.is_counter ? "translate-x-6" : "translate-x-1"}`}/>
                            </button>
                            <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Counter</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2"><span className="text-sm font-medium text-stone-900">{p.full_name || p.email}</span>{p.is_counter && <Badge tone="emerald">Counter</Badge>}{isAdminRole(p.role) && <Badge tone="indigo">Admin</Badge>}{p.portal_access && !isAdminRole(p.role) && <Badge tone="indigo">Access</Badge>}</div>
                            <div className="truncate text-xs text-stone-400">{p.email}</div>
                          </div>
                        </div>
                        {/* Link donor + PIN for counters */}
                        {(p.portal_access || isAdminRole(p.role) || p.is_counter) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
                            <div className="flex-1 min-w-[180px]">
                              <Label className="text-[10px]">Link to donor record</Label>
                              <div className="mt-1 flex items-center gap-1.5">
                                <Select value={p.linked_donor_id ?? ""} onChange={(e) => e.target.value && linkDonor(p.id, e.target.value)}
                                  className="h-8 flex-1 text-xs">
                                  <option value="">{donorOptions.length === 0 ? "— No donors yet —" : "— Link donor —"}</option>
                                  {donorOptions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                                </Select>
                                {quickCreateFor === p.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <Input autoFocus value={quickCreateName} onChange={(e) => setQuickCreateName(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") createAndLinkDonor(p.id); if (e.key === "Escape") { setQuickCreateFor(null); setQuickCreateName(""); } }}
                                      placeholder="First Last" className="h-8 w-32 text-xs" />
                                    <Button size="sm" variant="solid" disabled={!quickCreateName.trim() || quickCreateSaving} onClick={() => createAndLinkDonor(p.id)}>{quickCreateSaving ? "…" : "Save"}</Button>
                                    <Button size="sm" variant="ghost" onClick={() => { setQuickCreateFor(null); setQuickCreateName(""); }}>✕</Button>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="outline" className="h-8 px-2" title="Create a new donor record and link it to this member" onClick={() => setQuickCreateFor(p.id)}>
                                    <UserPlus className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                              {donorOptions.length === 0 && (
                                <p className="mt-1 text-[10px] leading-snug text-stone-400">
                                  No donor records yet. Add members in the <strong>Donors</strong> page, or create one here with the ＋ button.
                                </p>
                              )}
                            </div>
                            {p.is_counter && (
                              <div className="flex items-end gap-2">
                                <div className="relative"><Lock className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-400"/><Input type="password" maxLength={6} placeholder="New PIN" value={pinInputs[p.id] ?? ""} onChange={(e) => setPinInputs((prev) => ({ ...prev, [p.id]: e.target.value }))} className="h-8 w-24 pl-7 text-xs"/></div>
                                <Button size="sm" variant="outline" disabled={savingId === p.id || !pinInputs[p.id] || (pinInputs[p.id]?.length ?? 0) < 3} onClick={() => setPin(p.id)}>{savingId === p.id ? "…" : "Set"}</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {allProfiles.length <= 1 && (
                      <p className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-3 text-center text-sm text-stone-500">
                        Only your account is on file so far. Anyone who signs in with Google appears here for approval — then you can grant access, link them to a donor record, or designate them as a counter.
                      </p>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <Button iconLeft={<Plus className="h-4 w-4" />} variant="solid" onClick={() => navigate("/offerings")}>New donation</Button>
          </div>
        }
      />

      {pendingApprovals > 0 && (
        <button type="button" onClick={() => { setCounterOpen(true); loadProfiles(); }}
          className="mb-6 flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 transition hover:bg-amber-100/80">
          <UserCheck className="h-5 w-5 shrink-0 text-amber-600" />
          <span><strong>{pendingApprovals} member{pendingApprovals > 1 ? "s" : ""} waiting for approval</strong> — someone signed in with Google. Click here to review, grant access, link their donor record, or make them a counter.</span>
        </button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="YTD Giving" value={formatCurrency(kpis.ytdGiving)} accent="indigo" icon={<HandCoins className="h-5 w-5" />}/>
        <Tile label="YTD Expenses" value={formatCurrency(ytdExpenses)} accent={ytdExpenses > 0 ? "rose" : "emerald"} icon={<Receipt className="h-5 w-5" />}/>
        <Tile label="Net position" value={formatCurrency(ytdNet)} accent={ytdNet >= 0 ? "emerald" : "rose"} icon={<TrendingUp className="h-5 w-5" />}/>
        <Tile label="Pending deposits" value={pendingDeposits > 0 ? `${pendingDeposits} · ${formatCurrency(pendingDepositTotal)}` : "0"} accent="amber" icon={<Banknote className="h-5 w-5" />}
          onClick={pendingDeposits > 0 ? () => navigate("/offerings") : undefined} />
        <Tile label="Pending expenses" value={kpis.pendingExpenses.toString()} accent="amber" icon={<Receipt className="h-5 w-5" />}/>
      </div>

      <p className="mt-3 text-xs text-stone-400">
        Church-wide YTD totals — weekly offerings (cash + checks) and all individual gifts across every member.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><div className="flex items-center justify-between"><h2 className="font-serif text-lg font-semibold text-stone-900">Recent giving</h2><Badge tone="indigo">{recentItems.length}</Badge></div></CardHeader>
          <CardBody className="space-y-3">
            {recentItems.length === 0 ? <EmptyState icon={<CircleDollarSign className="h-6 w-6" />} title="No giving yet" description="Once offerings and gifts are recorded, they'll show here."/>
            : recentItems.map((d) => (<div key={d.id} className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3 hover:bg-stone-50/60"><div><div className="font-medium text-stone-900">{d.name}</div><div className="text-xs text-stone-500">{formatDate(d.date)} · {d.meta}</div></div><div className="font-serif text-lg font-semibold text-stone-900">{formatCurrency(d.amount)}</div></div>))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center justify-between"><h2 className="font-serif text-lg font-semibold text-stone-900">Recent expenses</h2><Badge tone="amber">{recentExpenses.length}</Badge></div></CardHeader>
          <CardBody className="space-y-3">
            {recentExpenses.length === 0 ? <EmptyState icon={<Receipt className="h-6 w-6" />} title="No expenses logged"/>
            : recentExpenses.map((e) => (<div key={e.id} className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3 hover:bg-stone-50/60"><div className="min-w-0"><div className="truncate font-medium text-stone-900">{e.title ?? e.description ?? "—"}</div><div className="text-xs text-stone-500">{formatDate(e.submitted_at)} · {e.source === "church_direct" ? "Direct" : "Submitted"} · <Badge tone={e.status === "auto_paid" || e.status === "paid" ? "emerald" : e.status === "rejected" ? "rose" : e.status === "approved" ? "indigo" : "amber"}>{e.status.replace("_", " ")}</Badge></div></div><div className="font-serif text-lg font-semibold text-stone-900">{formatCurrency(e.amount)}</div></div>))}
          </CardBody>
        </Card>
      </div>

      {!supabase && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Demo mode.</strong> Connect Supabase to see live numbers.</div>
      )}
    </div>
  );
}
