import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  HandCoins, Receipt, Users, TrendingUp, CircleDollarSign, Plus,
  Shield, UserCheck, Lock, Banknote, UserPlus,
} from "lucide-react";
import { Button, Card, CardBody, CardHeader, Tile, MotionTile, Badge, EmptyState, Input, Label, Select, Tabs, TabsList, TabsTrigger, TabsContent, Skeleton, KpiSkeleton } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { MemberOverview } from "@/pages/MyOverview";
import { supabase, isAdminRole, isPastorRole } from "@/lib/supabase";
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

// Shared profile card component to avoid duplicating the entire card in each tab
function ProfileCard({ p, draftTogglePortal, draftToggleCounter, draftLinkDonor, donorOptions, quickCreateFor, setQuickCreateFor, quickCreateName, setQuickCreateName, quickCreateSaving, draftCreateAndLink, pinInputs, setPinInputs, draftSetPin }: {
  p: Profile;
  draftTogglePortal: (id: string) => void;
  draftToggleCounter: (id: string) => void;
  draftLinkDonor: (id: string, donorId: string) => void;
  donorOptions: { id: string; label: string }[];
  quickCreateFor: string | null;
  setQuickCreateFor: (v: string | null) => void;
  quickCreateName: string;
  setQuickCreateName: (v: string) => void;
  quickCreateSaving: boolean;
  draftCreateAndLink: (id: string) => Promise<void>;
  pinInputs: Record<string, string>;
  setPinInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSetPin: (id: string) => void;
}) {
  return (
    <div key={p.id} className="rounded-lg border border-[#F5F0E8] px-3 py-2.5 hover:bg-[#FDF8F2]/50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => draftTogglePortal(p.id)} disabled={isAdminRole(p.role)}
            title={isAdminRole(p.role) ? "Admins always have access" : p.portal_access ? "Click to revoke access" : "Click to grant access"}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition ${p.portal_access || isAdminRole(p.role) ? "bg-[#C67B5C]" : "bg-[#EDE4D8]"}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${p.portal_access || isAdminRole(p.role) ? "translate-x-6" : "translate-x-1"}`}/>
          </button>
          <span className="text-[10px] font-medium uppercase tracking-wide text-[#C4A77D]">Access</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => draftToggleCounter(p.id)}
            title={p.is_counter ? "Click to remove counter role" : "Click to make counter"}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition ${p.is_counter ? "bg-emerald-500" : "bg-[#EDE4D8]"}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${p.is_counter ? "translate-x-6" : "translate-x-1"}`}/>
          </button>
          <span className="text-[10px] font-medium uppercase tracking-wide text-[#C4A77D]">Counter</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="text-sm font-medium text-[#3C2A1E]">{p.full_name || p.email}</span>{p.is_counter && <Badge tone="emerald">Counter</Badge>}{isAdminRole(p.role) && <Badge tone="indigo">Admin</Badge>}{p.portal_access && !isAdminRole(p.role) && <Badge tone="indigo">Access</Badge>}</div>
          <div className="truncate text-xs text-[#C4A77D]">{p.email}</div>
        </div>
      </div>
      {(p.portal_access || isAdminRole(p.role) || p.is_counter) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#F5F0E8] pt-2">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[10px]">Link to donor record</Label>
            <div className="mt-1 flex items-center gap-1.5">
              <Select value={p.linked_donor_id ?? ""} onChange={(e) => e.target.value && draftLinkDonor(p.id, e.target.value)}
                className="h-8 flex-1 text-xs">
                <option value="">{donorOptions.length === 0 ? "— No donors yet —" : "— Link donor —"}</option>
                {donorOptions.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
              {quickCreateFor === p.id ? (
                <div className="flex items-center gap-1.5">
                  <Input autoFocus value={quickCreateName} onChange={(e) => setQuickCreateName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") draftCreateAndLink(p.id); if (e.key === "Escape") { setQuickCreateFor(null); setQuickCreateName(""); } }}
                    placeholder="First Last" className="h-8 w-32 text-xs" />
                  <Button size="sm" variant="solid" disabled={!quickCreateName.trim() || quickCreateSaving} onClick={() => draftCreateAndLink(p.id)}>{quickCreateSaving ? "…" : "Save"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setQuickCreateFor(null); setQuickCreateName(""); }}>✕</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-8 px-2" title="Create a new donor record and link it to this member" onClick={() => setQuickCreateFor(p.id)}>
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {donorOptions.length === 0 && (
              <p className="mt-1 text-[10px] leading-snug text-[#C4A77D]">
                No donor records yet. Add members in the <strong>Donors</strong> page, or create one here with the ＋ button.
              </p>
            )}
          </div>
          {p.is_counter && (
            <div className="flex items-end gap-2">
              <div className="relative"><Lock className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#C4A77D]"/><Input type="password" maxLength={6} placeholder="New PIN" value={pinInputs[p.id] ?? ""} onChange={(e) => setPinInputs((prev) => ({ ...prev, [p.id]: e.target.value }))} className="h-8 w-24 pl-7 text-xs"/></div>
              <Button size="sm" variant="outline" disabled={!pinInputs[p.id] || (pinInputs[p.id]?.length ?? 0) < 3} onClick={() => draftSetPin(p.id)}>Set</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  // The pastor gets the church-wide snapshot (read-only) — the KPI RPC returns
  // admin-scope data for them — but never member-management or entry actions.
  const isWide = isAdmin || isPastorRole(profile?.role);
  const [counterOpen, setCounterOpen] = useState(false);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [draftProfiles, setDraftProfiles] = useState<Profile[]>([]);
  const [donorOptions, setDonorOptions] = useState<{ id: string; label: string }[]>([]);
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [saveMessage, setSaveMessage] = useState<"" | "saved" | "error">("");
  const [quickCreateFor, setQuickCreateFor] = useState<string | null>(null);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [quickCreateSaving, setQuickCreateSaving] = useState(false);
  const [manageTab, setManageTab] = useState("pending");

  const loadProfiles = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_all_profiles");
    if (error) { console.warn("loadProfiles failed:", error); return; }
    const result = data as { profiles: Profile[]; donorOptions: { id: string; label: string }[] };
    if (result) {
      setAllProfiles(result.profiles);
      setDraftProfiles(result.profiles.map((p) => ({ ...p })));
      setPinInputs({});
      setDonorOptions(result.donorOptions ?? []);
      setSaveMessage("");
    }
  };

  const hasUnsavedChanges = draftProfiles.some((dp) => {
    const orig = allProfiles.find((op) => op.id === dp.id);
    if (!orig) return false;
    return dp.portal_access !== orig.portal_access || dp.is_counter !== orig.is_counter || dp.linked_donor_id !== orig.linked_donor_id;
  });

  const draftTogglePortal = (userId: string) => {
    setSaveMessage("");
    setDraftProfiles((prev) => prev.map((p) => (p.id === userId && !isAdminRole(p.role) ? { ...p, portal_access: !p.portal_access } : p)));
  };

  const draftToggleCounter = (userId: string) => {
    setSaveMessage("");
    setDraftProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, is_counter: !p.is_counter } : p)));
  };

  const draftLinkDonor = (userId: string, donorId: string) => {
    setSaveMessage("");
    setDraftProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, linked_donor_id: donorId } : p)));
  };

  const draftCreateAndLink = async (userId: string) => {
    if (!supabase || !quickCreateName.trim()) return;
    const parts = quickCreateName.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ") || firstName;
    setQuickCreateSaving(true);
    const { data, error } = await supabase.rpc("admin_manage_profile", {
      target_user_id: userId, action: "create_link_donor",
      donor_first: firstName, donor_last: lastName,
    });
    if (error) { console.warn("Create donor failed:", error); setQuickCreateSaving(false); return; }
    const result = data as { ok: boolean; id: string; label: string } | null;
    if (result?.ok) {
      setDonorOptions((prev) => [...prev, { id: result.id, label: result.label }]);
      setDraftProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, linked_donor_id: result.id } : p)));
    }
    setQuickCreateName("");
    setQuickCreateFor(null);
    setQuickCreateSaving(false);
  };

  const draftSetPin = (userId: string) => {
    const pin = pinInputs[userId];
    if (!pin || pin.length < 3) return;
    supabase?.rpc("admin_manage_profile", { target_user_id: userId, action: "set_pin", pin_plain: pin });
    setPinInputs((prev) => ({ ...prev, [userId]: "" }));
  };

  const saveAllChanges = async () => {
    if (!supabase || savingAll) return;
    setSavingAll(true);
    setSaveMessage("");
    let anyError = false;
    for (const dp of draftProfiles) {
      const orig = allProfiles.find((op) => op.id === dp.id);
      if (!orig) continue;
      if (dp.portal_access !== orig.portal_access) {
        const { error } = await supabase.rpc("admin_manage_profile", { target_user_id: dp.id, action: "toggle_portal", new_val: dp.portal_access });
        if (error) anyError = true;
      }
      if (dp.is_counter !== orig.is_counter) {
        const { error } = await supabase.rpc("admin_manage_profile", { target_user_id: dp.id, action: "toggle_counter", new_val: dp.is_counter });
        if (error) anyError = true;
      }
      if (dp.linked_donor_id !== orig.linked_donor_id && dp.linked_donor_id) {
        const { error } = await supabase.rpc("admin_manage_profile", { target_user_id: dp.id, action: "link_donor", donor_id: dp.linked_donor_id });
        if (error) anyError = true;
      }
    }
    if (!anyError) {
      setAllProfiles(draftProfiles.map((p) => ({ ...p })));
      setSaveMessage("saved");
    } else {
      setSaveMessage("error");
    }
    setSavingAll(false);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      try {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
        const { data: kpiData, error } = await supabase.rpc("get_dashboard_kpis", { year_start: yearStart });
        if (error) throw error;
        if (!cancelled) {
          const d = kpiData as Record<string, unknown>;
          const ytdGiving = Number(d.ytdGiving ?? 0);
          const expTotal = Number(d.ytdExpenses ?? 0);
          setKpis({
            ytdGiving,
            donors: Number(d.donors ?? 0),
            pendingExpenses: Number(d.pendingExpenses ?? 0),
            monthNet: ytdGiving - expTotal,
          });
          setYtdExpenses(expTotal);
          setYtdNet(ytdGiving - expTotal);
          setPendingApprovals(Number(d.pendingApprovals ?? 0));
          setPendingDeposits(Number(d.pendingDeposits ?? 0));
          setPendingDepositTotal(Number(d.pendingDepositTotal ?? 0));
          const giving = (d.recentGiving as Array<{ id: string; date: string; name: string; meta: string; amount: number }>) ?? [];
          setRecentItems(giving);
          const exp = (d.recentExpenses as Array<Record<string, unknown>>) ?? [];
          setRecentExpenses(exp.map((e) => ({
            id: e.id as string,
            source: (e.source as Expense["source"]) ?? "church_direct",
            title: (e.title as string) ?? null,
            amount: Number(e.amount ?? 0),
            category: (e.category as Expense["category"]) ?? "other",
            description: (e.description as string) ?? null,
            receipt_paths: (e.receipt_paths as string[]) ?? [],
            transfer_receipt_path: (e.transfer_receipt_path as string) ?? null,
            payment_method: (e.payment_method as string) ?? null,
            user_id: (e.user_id as string) ?? null,
            status: (e.status as Expense["status"]) ?? "pending",
            submitted_at: (e.submitted_at as string) ?? new Date().toISOString(),
            approved_by: (e.approved_by as string) ?? null,
            approved_at: (e.approved_at as string) ?? null,
            paid_at: (e.paid_at as string) ?? null,
            paid_by: (e.paid_by as string) ?? null,
            notes: (e.notes as string) ?? null,
            created_at: (e.created_at as string) ?? new Date().toISOString(),
          })));
        }
      } catch (err) { console.warn("Dashboard query failed; using mock data.", err); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (!isWide) {
    return (
      <div>
        <PageHeader title={`Welcome, ${profile?.full_name ?? "member"}`} subtitle="Your personal giving, submitted bills, and reimbursement status." badge="Member" />
        <MemberOverview />
      </div>
    );
  }

  // Pre-compute tab counts
  const pendingProfiles = draftProfiles.filter((p) => !p.portal_access && !isAdminRole(p.role));
  const approvedProfiles = draftProfiles.filter((p) => p.portal_access && !isAdminRole(p.role));
  const adminProfiles = draftProfiles.filter((p) => isAdminRole(p.role));

  const cardProps = { draftTogglePortal, draftToggleCounter, draftLinkDonor, donorOptions, quickCreateFor, setQuickCreateFor, quickCreateName, setQuickCreateName, quickCreateSaving, draftCreateAndLink, pinInputs, setPinInputs, draftSetPin };

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.full_name ?? (isAdmin ? "treasurer" : "pastor")}`}
        subtitle="A snapshot of how your church is stewarding its resources this year."
        badge={isAdmin ? "Live" : "View only"}
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
                  <div className="rounded-lg border border-[#EDE4D8] bg-[#FDF8F2] p-3 text-sm text-[#78716C]"><Shield className="mb-1 inline h-4 w-4 text-amber-500" /> Anyone with a Google account can sign in — but only members with <strong>Portal access</strong> approved here can view data or submit expenses.</div>
                  {hasUnsavedChanges && (
                    <div className="rounded-lg border border-[#EDE4D8] bg-[#FDF2E9] px-3 py-2 text-xs font-medium text-amber-700">
                      ⚠ You have unsaved changes. Scroll down and click <strong>Save changes</strong> to apply them.
                    </div>
                  )}

                  {/* ====== Tabbed member list ====== */}
                  <Tabs value={manageTab} onValueChange={setManageTab} className="mt-3">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="pending" className="text-xs">
                        Pending <Badge tone="amber" className="ml-1 text-[10px]">{pendingProfiles.length}</Badge>
                      </TabsTrigger>
                      <TabsTrigger value="approved" className="text-xs">
                        Approved <Badge tone="indigo" className="ml-1 text-[10px]">{approvedProfiles.length}</Badge>
                      </TabsTrigger>
                      <TabsTrigger value="admins" className="text-xs">
                        Admins <Badge tone="indigo" className="ml-1 text-[10px]">{adminProfiles.length}</Badge>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="mt-3 space-y-2">
                      {pendingProfiles.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-[#EDE4D8] bg-[#FDF8F2] p-3 text-center text-sm text-[#78716C]">No pending approvals — everyone who signed in has been approved.</p>
                      ) : (
                        pendingProfiles.map((p) => <ProfileCard key={p.id} p={p} {...cardProps} />)
                      )}
                    </TabsContent>

                    <TabsContent value="approved" className="mt-3 space-y-2">
                      {approvedProfiles.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-[#EDE4D8] bg-[#FDF8F2] p-3 text-center text-sm text-[#78716C]">No approved members yet — approve members from the Pending tab.</p>
                      ) : (
                        approvedProfiles.map((p) => <ProfileCard key={p.id} p={p} {...cardProps} />)
                      )}
                    </TabsContent>

                    <TabsContent value="admins" className="mt-3 space-y-2">
                      {adminProfiles.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-[#EDE4D8] bg-[#FDF8F2] p-3 text-center text-sm text-[#78716C]">No admin accounts found.</p>
                      ) : (
                        adminProfiles.map((p) => <ProfileCard key={p.id} p={p} {...cardProps} />)
                      )}
                    </TabsContent>
                  </Tabs>

                  {/* Save button */}
                  <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex items-center justify-between gap-3 rounded-b-xl border-t border-[#EDE4D8] bg-[#FFFBF5] px-6 py-4">
                    <div className="text-xs text-[#78716C]">
                      {saveMessage === "saved" && <span className="text-emerald-600">✓ Changes saved successfully</span>}
                      {saveMessage === "error" && <span className="text-rose-600">✗ Some changes failed — try again</span>}
                      {saveMessage === "" && hasUnsavedChanges && <span>You have unsaved changes</span>}
                      {saveMessage === "" && !hasUnsavedChanges && <span>No changes to save</span>}
                    </div>
                    <Button
                      variant="solid"
                      disabled={!hasUnsavedChanges || savingAll}
                      onClick={saveAllChanges}
                    >
                      {savingAll ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
            {isAdmin && <Button iconLeft={<Plus className="h-4 w-4" />} variant="solid" onClick={() => navigate("/offerings")}>New donation</Button>}
          </div>
        }
      />

      {isAdmin && pendingApprovals > 0 && (
        <motion.button type="button" onClick={() => { setCounterOpen(true); loadProfiles(); }}
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          whileHover={{ scale: 1.005 }}
          className="mb-6 flex w-full items-center gap-3 rounded-xl border border-[#EDE4D8] bg-[#FDF2E9] px-4 py-3 text-left text-sm text-[#9A3412] transition hover:bg-[#FDF2E9]">
          <UserCheck className="h-5 w-5 shrink-0 text-[#C67B5C]" />
          <span><strong>{pendingApprovals} member{pendingApprovals > 1 ? "s" : ""} waiting for approval</strong> — someone signed in with Google. Click here to review, grant access, link their donor record, or make them a counter.</span>
        </motion.button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading ? (
          <>
            <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
          </>
        ) : (
          <>
            <MotionTile label="YTD Giving" value={formatCurrency(kpis.ytdGiving)} accent="indigo" icon={<HandCoins className="h-5 w-5" />} index={0} />
            <MotionTile label="YTD Expenses" value={formatCurrency(ytdExpenses)} accent={ytdExpenses > 0 ? "rose" : "emerald"} icon={<Receipt className="h-5 w-5" />} index={1} />
            <MotionTile label="Net position" value={formatCurrency(ytdNet)} accent={ytdNet >= 0 ? "emerald" : "rose"} icon={<TrendingUp className="h-5 w-5" />} delta={ytdNet >= 0 ? "Surplus" : "Deficit"} deltaPositive={ytdNet >= 0} index={2} />
            <MotionTile label="Pending deposits" value={pendingDeposits > 0 ? `${pendingDeposits} · ${formatCurrency(pendingDepositTotal)}` : "0"} accent="amber" icon={<Banknote className="h-5 w-5" />}
              onClick={pendingDeposits > 0 ? () => navigate("/offerings") : undefined} index={3} />
            <MotionTile label="Pending expenses" value={kpis.pendingExpenses.toString()} accent="amber" icon={<Receipt className="h-5 w-5" />}
              onClick={kpis.pendingExpenses > 0 ? () => navigate("/expenses") : undefined} index={4} />
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-[#C4A77D]">
        Church-wide YTD totals — weekly offerings (cash + checks) and all individual gifts across every member.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><div className="flex items-center justify-between"><h2 className="font-serif text-lg font-semibold text-[#3C2A1E]">Recent giving</h2><Badge tone="indigo">{recentItems.length}</Badge></div></CardHeader>
          <CardBody className="space-y-3">
            {recentItems.length === 0 ? <EmptyState icon={<CircleDollarSign className="h-6 w-6" />} title="No giving yet" description="Once offerings and gifts are recorded, they'll show here."/>
            : recentItems.map((d) => (<div key={d.id} className="flex items-center justify-between rounded-lg border border-[#F5F0E8] px-4 py-3 hover:bg-[#FDF2E9]/60"><div><div className="font-medium text-[#3C2A1E]">{d.name}</div><div className="text-xs text-[#78716C]">{formatDate(d.date)} · {d.meta}</div></div><div className="font-serif text-lg font-semibold text-[#3C2A1E]">{formatCurrency(d.amount)}</div></div>))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center justify-between"><h2 className="font-serif text-lg font-semibold text-[#3C2A1E]">Recent expenses</h2><Badge tone="amber">{recentExpenses.length}</Badge></div></CardHeader>
          <CardBody className="space-y-3">
            {recentExpenses.length === 0 ? <EmptyState icon={<Receipt className="h-6 w-6" />} title="No expenses logged"/>
            : recentExpenses.map((e) => (<div key={e.id} className="flex items-center justify-between rounded-lg border border-[#F5F0E8] px-4 py-3 hover:bg-[#FDF2E9]/60"><div className="min-w-0"><div className="truncate font-medium text-[#3C2A1E]">{e.title ?? e.description ?? "—"}</div><div className="text-xs text-[#78716C]">{formatDate(e.submitted_at)} · {e.source === "church_direct" ? "Direct" : "Submitted"}{e.payment_method ? ` · ${e.payment_method}` : ""} · <Badge tone={e.status === "auto_paid" || e.status === "paid" ? "emerald" : e.status === "rejected" ? "rose" : e.status === "approved" ? "indigo" : "amber"}>{e.status.replace("_", " ")}</Badge></div></div><div className="font-serif text-lg font-semibold text-[#3C2A1E]">{formatCurrency(e.amount)}</div></div>))}
          </CardBody>
        </Card>
      </div>

      {!supabase && (
        <div className="mt-8 rounded-xl border border-[#EDE4D8] bg-[#FDF2E9] p-4 text-sm text-[#9A3412]"><strong>Demo mode.</strong> Connect Supabase to see live numbers.</div>
      )}
    </div>
  );
}
