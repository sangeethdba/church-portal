import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Plus, Church, Banknote, ScrollText, Filter, Trash2, MinusCircle,
  Shield, UserCheck, Key, AlertTriangle, Clock, FileDown, Upload, CheckCircle2,
  Download, Printer, Receipt, CalendarRange,
} from "lucide-react";
import {
  Button, Card, CardBody, CardHeader, Input, Label, Textarea, Select,
  Badge, EmptyState, TableWrap, THead, Tr, Th, Td,
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase } from "@/lib/supabase";
import type { Donor } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { downloadOfferingSummary, offeringSummaryDataUrl, downloadOfferingReceipt, offeringReceiptDataUrl, type OfferingSummary, type OfferingReceipt, type OfferingDenomEntry, type OfferingCheckEntry, type OfferingDeductionEntry } from "@/lib/pdf";

// ── Denomination preset ───────────────────────────────────────────────────
const DENOMS = [100, 50, 20, 10, 5, 2, 1] as const;
type DenomCounts = Record<number, string>;

interface Deduction {
  reason: string;
  amount: string;
}

interface CheckEntry {
  key: string;
  donorName: string;
  donorId: string;
  checkNumber: string;
  amount: string;
}

interface CounterInfo {
  id: string;
  full_name: string;
}

interface Offering {
  id: string;
  service_date: string;
  service_name: string;
  cash_amount: number;
  check_amount: number;
  total_amount: number;
  check_count: number;
  cash_breakdown: DenomCounts | null;
  cash_deductions: Deduction[] | null;
  cash_net: number;
  recorded_by: string;
  notes: string | null;
  created_at: string;
  counter_1_id: string | null;
  counter_1_signed_at: string | null;
  counter_2_id: string | null;
  counter_2_signed_at: string | null;
  deposit_status?: "pending_deposit" | "deposited";
  deposited_at?: string | null;
  deposit_receipt_path?: string | null;
}

// ── Sample data ────────────────────────────────────────────────────────────
function makeOffering(date: string, name: string, cash: number, checks: number, cnt: number): Offering {
  return {
    id: `demo-${date}`,
    service_date: date,
    service_name: name,
    cash_amount: cash,
    check_amount: checks,
    total_amount: cash + checks,
    check_count: cnt,
    cash_breakdown: null,
    cash_deductions: null,
    cash_net: cash,
    recorded_by: "demo",
    notes: null,
    created_at: new Date().toISOString(),
    counter_1_id: null,
    counter_1_signed_at: null,
    counter_2_id: null,
    counter_2_signed_at: null,
  };
}

const SAMPLE_OFFERINGS: Offering[] = [
  makeOffering(new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), "Sunday Service", 342.5, 1280, 4),
  makeOffering(new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10), "Sunday Service", 275, 950, 3),
  makeOffering(new Date(Date.now() - 17 * 86400000).toISOString().slice(0, 10), "Christmas Eve", 610, 2100, 7),
];

// ── Helpers ────────────────────────────────────────────────────────────────
function emptyDenoms(): DenomCounts {
  const c: DenomCounts = {};
  for (const d of DENOMS) c[d] = "";
  return c;
}

function computeCashFromDenoms(dc: DenomCounts): number {
  return Object.entries(dc).reduce((s, [denom, cnt]) => s + Number(denom) * (Number(cnt) || 0), 0);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Offerings() {
  const [offerings, setOfferings] = useState<Offering[]>(SAMPLE_OFFERINGS);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterYear, setFilterYear] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [donorList, setDonorList] = useState<Donor[]>([]);

  // ── Form state ─────────────────────────────────────────────────────────
  const [svcDate, setSvcDate] = useState(new Date().toISOString().slice(0, 10));
  const [svcName, setSvcName] = useState("Sunday Service");
  const [denoms, setDenoms] = useState<DenomCounts>(emptyDenoms());
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [checks, setChecks] = useState<CheckEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [activeSuggestKey, setActiveSuggestKey] = useState<string | null>(null);

  // ── Counter sign-off state ────────────────────────────────────────────
  const ctx = useOutletContext<{ profile: { id: string; full_name?: string | null } | null; isCounter: boolean }>();
  const [counterList, setCounterList] = useState<CounterInfo[]>([]);
  const [counter1Id] = useState(ctx.profile?.id ?? "");
  const [counter1Pin, setCounter1Pin] = useState("");
  const [counter2Id, setCounter2Id] = useState("");
  const [counter2Pin, setCounter2Pin] = useState("");
  const [signOffError, setSignOffError] = useState("");

  // ── Deposit state ───────────────────────────────────────────────────────
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositOfferingId, setDepositOfferingId] = useState<string | null>(null);
  const [depositFile, setDepositFile] = useState<File | null>(null);
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositError, setDepositError] = useState("");
  const depositOffering = offerings.find((o) => o.id === depositOfferingId) ?? null;

  // ── Document preview state (ledger slip or receipt) ─────────────────────
  const [docPreview, setDocPreview] = useState<{ url: string; title: string; subtitle: string; onDownload: () => void } | null>(null);

  const openLedgerPreview = (summary: OfferingSummary) => {
    setDocPreview({
      url: offeringSummaryDataUrl(summary),
      title: "Deposit slip / ledger",
      subtitle: `${summary.serviceName} · ${formatDate(summary.serviceDate)} · Total deposit ${formatCurrency(summary.totalDeposit)}`,
      onDownload: () => downloadOfferingSummary(summary),
    });
  };

  const openReceiptPreview = (receipt: OfferingReceipt) => {
    setDocPreview({
      url: offeringReceiptDataUrl(receipt),
      title: "Offering receipt",
      subtitle: `${receipt.serviceName} · ${formatDate(receipt.serviceDate)} · Total received ${formatCurrency(receipt.totalDeposit)}`,
      onDownload: () => downloadOfferingReceipt(receipt),
    });
  };

  // Build both documents from a stored offering row + its check lines
  const buildOfferingDocs = (o: Offering, checksData: { donor_name: string; check_number: string | null; amount: number }[]) => {
    const net = Number(o.cash_net ?? o.cash_amount) || 0;
    const dedSum = Number((o.cash_deductions as Deduction[])?.reduce((s, d) => s + (Number(d.amount) || 0), 0) ?? 0) || 0;
    const checksTotal = checksData.reduce((s, c) => s + (Number(c.amount) || 0), 0) || Number(o.check_amount) || 0;
    const breakdown = (o.cash_breakdown as DenomCounts | null) ?? {};
    const denomEntries: OfferingDenomEntry[] = DENOMS
      .map((d) => ({ denomination: d, count: Number(breakdown[d]) || 0, subtotal: (Number(breakdown[d]) || 0) * d }))
      .filter((e) => e.count > 0);
    const churchName = (typeof window !== "undefined" && localStorage.getItem("church_name")) || "Grace Community Church";
    const checks = checksData.map((c) => ({ donorName: c.donor_name || "—", checkNumber: c.check_number ?? "", amount: Number(c.amount) || 0 }));
    const deductions = (o.cash_deductions as Deduction[])?.map((d: Deduction) => ({ reason: d.reason, amount: Number(d.amount) || 0 })) ?? [];
    const counter1Name = counterName(o.counter_1_id);
    const counter2Name = counterName(o.counter_2_id);
    const summary: OfferingSummary = {
      serviceDate: o.service_date,
      serviceName: o.service_name,
      cashDenoms: denomEntries,
      grossCash: net + dedSum,
      deductions,
      netCash: net,
      checks,
      totalChecks: checksTotal,
      totalDeposit: net + checksTotal,
      churchName,
      recordedBy: "Admin",
      counter1Name,
      counter2Name,
    };
    const receipt: OfferingReceipt = {
      churchName,
      receiptNumber: `R-${(o.id ?? "").replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      serviceName: o.service_name,
      serviceDate: o.service_date,
      cashDenoms: denomEntries,
      deductions,
      grossCash: net + dedSum,
      netCash: net,
      checks,
      totalChecks: checksTotal,
      totalDeposit: net + checksTotal,
      counter1Name,
      counter2Name,
      notes: o.notes ?? null,
    };
    return { summary, receipt };
  };

  const loadOfferingChecks = async (o: Offering) => {
    if (!supabase) return [];
    const { data } = await supabase
      .from("offering_checks")
      .select("donor_name, check_number, amount")
      .eq("offering_id", o.id)
      .order("donor_name");
    return (data ?? []) as { donor_name: string; check_number: string | null; amount: number }[];
  };

  // ── Computed values ────────────────────────────────────────────────────
  const grossCash = computeCashFromDenoms(denoms);
  const totalDeductions = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const netCash = grossCash - totalDeductions;
  const totalChecks = checks.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const depositTotal = netCash + totalChecks;

  const filtered = useMemo(() => {
    return offerings.filter((o) => {
      if (filterYear !== "all" && !o.service_date.startsWith(filterYear)) return false;
      if (dateFrom && o.service_date < dateFrom) return false;
      if (dateTo && o.service_date > dateTo) return false;
      return true;
    });
  }, [offerings, filterYear, dateFrom, dateTo]);

  const totals = filtered.reduce(
    (acc, o) => ({
      cash: acc.cash + Number(o.cash_net || o.cash_amount),
      checks: acc.checks + Number(o.check_amount),
      grand: acc.grand + Number(o.total_amount),
    }),
    { cash: 0, checks: 0, grand: 0 },
  );

  const years = useMemo(() => {
    const s = new Set<string>();
    offerings.forEach((o) => s.add(o.service_date.slice(0, 4)));
    return Array.from(s).sort().reverse();
  }, [offerings]);

  // Counter name lookup
  const counterName = (id: string | null | undefined): string => {
    if (!id) return "—";
    const c = counterList.find((x) => x.id === id);
    return c?.full_name ?? "Unknown";
  };

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    Promise.all([
      supabase.from("offerings").select("*").order("service_date", { ascending: false }),
      supabase.from("donors").select("id, first_name, last_name").order("last_name"),
      supabase.from("profiles").select("id, full_name").eq("is_counter", true).order("full_name"),
    ]).then(([{ data: oData }, { data: dData }, { data: cData }]) => {
      if (oData) setOfferings(oData as Offering[]);
      if (dData) setDonorList(dData as Donor[]);
      if (cData) setCounterList(cData as CounterInfo[]);
      setLoading(false);
    });
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────
  const resetForm = () => {
    setSvcDate(new Date().toISOString().slice(0, 10));
    setSvcName("Sunday Service");
    setDenoms(emptyDenoms());
    setDeductions([]);
    setChecks([]);
    setNotes("");
    setCounter1Pin("");
    setCounter2Id("");
    setCounter2Pin("");
    setSignOffError("");
  };

  const addCheck = () => {
    setChecks((prev) => [...prev, { key: `c${Date.now()}`, donorName: "", donorId: "", checkNumber: "", amount: "" }]);
  };

  const removeCheck = (key: string) => setChecks((prev) => prev.filter((c) => c.key !== key));

  const updateCheck = (key: string, patch: Partial<CheckEntry>) => {
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  // Live member suggestions as the counter types a donor name
  const suggestionsFor = (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return donorList
      .filter((d) => `${d.first_name} ${d.last_name}`.toLowerCase().includes(q))
      .slice(0, 8);
  };

  const pickDonor = (key: string, d: Donor) => {
    updateCheck(key, { donorId: d.id, donorName: `${d.first_name} ${d.last_name}` });
    setActiveSuggestKey(null);
  };

  const addDeduction = () => {
    setDeductions((prev) => [...prev, { reason: "", amount: "" }]);
  };

  const removeDeduction = (idx: number) => {
    setDeductions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateDeduction = (idx: number, patch: Partial<Deduction>) => {
    setDeductions((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  // Build offering summary for PDF download
  const buildSummary = (): OfferingSummary => ({
    serviceDate: svcDate,
    serviceName: svcName,
    cashDenoms: DENOMS.map((d) => ({ denomination: d, count: Number(denoms[d]) || 0, subtotal: (Number(denoms[d]) || 0) * d })),
    grossCash,
    deductions: deductions.map((d) => ({ reason: d.reason, amount: Number(d.amount) || 0 })),
    netCash,
    checks: checks.map((c) => ({ donorName: c.donorName || "—", checkNumber: c.checkNumber, amount: Number(c.amount) || 0 })),
    totalChecks,
    totalDeposit: depositTotal,
    churchName: (typeof window !== "undefined" && localStorage.getItem("church_name")) || "Grace Community Church",
    recordedBy: ctx.profile?.full_name ?? "Admin",
    counter1Name: ctx.profile?.full_name ?? "Counter 1",
    counter2Name: counterList.find((c) => c.id === counter2Id)?.full_name ?? "Counter 2",
  });

  const handleSave = async () => {
    if (depositTotal <= 0) return;

    if (supabase && (!counter2Id || !counter1Pin || !counter2Pin)) {
      setSignOffError("Counter 2 must be selected and both PINs entered.");
      return;
    }
    if (supabase && counter1Id === counter2Id) {
      setSignOffError("The second counter cannot be you — pick someone else.");
      return;
    }

    const recordedBy = ctx.profile?.id;
    if (!recordedBy) {
      setSignOffError("Your account isn't linked to a portal profile — sign out and sign back in.");
      return;
    }

    setSaving(true);
    setSignOffError("");

    const payload = {
      service_date: svcDate,
      service_name: svcName,
      cash_amount: netCash,
      cash_breakdown: denoms,
      cash_deductions: deductions,
      cash_net: netCash,
      check_amount: totalChecks,
      check_count: checks.length,
      total_amount: depositTotal,
      recorded_by: recordedBy,
      notes: notes || null,
    };

    if (supabase) {
      // 1. Insert offering
      const { data: offData, error: offErr } = await supabase
        .from("offerings")
        .insert(payload)
        .select()
        .maybeSingle();

      if (offErr) {
        console.warn("Insert offering failed:", offErr);
        setSignOffError(offErr.message || "Could not save the offering. Please try again.");
        setSaving(false);
        return;
      }
      const offeringId = (offData as Offering).id;

      // 2. Create check donations
      for (const ch of checks) {
        const amt = Number(ch.amount);
        if (!amt || amt <= 0) continue;

        let donorId = ch.donorId;
        if (!donorId && ch.donorName.trim()) {
          const [firstName, ...lastParts] = ch.donorName.trim().split(" ");
          const lastName = lastParts.join(" ") || firstName;
          const { data: newDonor } = await supabase
            .from("donors")
            .insert({ first_name: firstName, last_name: lastName })
            .select("id")
            .maybeSingle();
          if (newDonor) donorId = newDonor.id;
        }

        const { data: donData, error: donErr } = await supabase
          .from("donations")
          .insert({
            donor_id: donorId || null,
            donor_name: ch.donorName.trim() || "Anonymous",
            amount: amt,
            donation_type: "offering",
            payment_method: "check",
            check_number: ch.checkNumber || null,
            donation_date: svcDate,
            entered_by: recordedBy,
            offering_id: offeringId,
          })
          .select("id")
          .maybeSingle();
        if (donErr) console.warn("Donation insert failed:", donErr);

        await supabase.from("offering_checks").insert({
          offering_id: offeringId,
          donor_id: donorId || null,
          donor_name: ch.donorName.trim() || "Anonymous",
          check_number: ch.checkNumber || null,
          amount: amt,
          donation_id: donData?.id || null,
        });
      }

      // 3. Counter sign-off via RPC
      const { error: signErr } = await supabase.rpc("sign_offering", {
        p_offering_id: offeringId,
        p_counter_1_id: counter1Id,
        p_pin_1: counter1Pin,
        p_counter_2_id: counter2Id,
        p_pin_2: counter2Pin,
      });

      if (signErr) {
        console.warn("Sign-off failed:", signErr);
        setSignOffError(signErr.message || "PIN verification failed. Check PINs and try again.");
        setSaving(false);
        return;
      }

      // 4. Refresh
      const { data: fresh } = await supabase
        .from("offerings")
        .select("*")
        .order("service_date", { ascending: false });
      if (fresh) setOfferings(fresh as Offering[]);

      // Show the deposit slip / ledger in-app (replaces silent auto-download)
      openLedgerPreview(buildSummary());
    } else {
      // Demo mode
      const row: Offering = {
        ...payload,
        id: `local-${Date.now()}`,
        recorded_by: "demo",
        created_at: new Date().toISOString(),
        cash_breakdown: payload.cash_breakdown as DenomCounts,
        cash_deductions: payload.cash_deductions as Deduction[],
        counter_1_id: null,
        counter_1_signed_at: null,
        counter_2_id: null,
        counter_2_signed_at: null,
      } as Offering;
      setOfferings((prev) => [row, ...prev]);

      // Show the deposit slip / ledger in-app (replaces silent auto-download)
      openLedgerPreview(buildSummary());
    }

    setSaving(false);
    setOpen(false);
    resetForm();
  };

  const handleMarkDeposited = async () => {
    if (!depositOfferingId) return;

    if (!supabase) {
      setOfferings((rows) => rows.map((r) => (r.id === depositOfferingId ? { ...r, deposit_status: "deposited", deposited_at: new Date().toISOString() } : r)));
      setDepositOpen(false);
      setDepositFile(null);
      setDepositOfferingId(null);
      return;
    }

    setDepositSaving(true);
    setDepositError("");
    let receiptPath: string | null = null;

    if (depositFile) {
      const safeName = depositFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${ctx.profile?.id ?? "user"}/deposits/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("receipts").upload(path, depositFile, { cacheControl: "3600", upsert: false });
      if (error) {
        setDepositError(error.message || "Deposit slip upload failed.");
        setDepositSaving(false);
        return;
      }
      receiptPath = path;
    }

    const { error } = await supabase.rpc("mark_deposited", { p_offering_id: depositOfferingId, p_receipt_path: receiptPath });
    if (error) {
      setDepositError(error.message || "Could not mark this offering as deposited.");
      setDepositSaving(false);
      return;
    }

    const { data: fresh } = await supabase.from("offerings").select("*").order("service_date", { ascending: false });
    if (fresh) setOfferings(fresh as Offering[]);
    setDepositSaving(false);
    setDepositOpen(false);
    setDepositFile(null);
    setDepositOfferingId(null);
  };

  return (
    <div>
      <PageHeader
        title="Offerings"
        subtitle="Record Sunday collections — cash by denomination, individual checks per donor, and dual counter sign-off."
        badge={`${filtered.length} services`}
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Record offering</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Record a service offering</DialogTitle>
                <DialogDescription>
                  Enter cash by denomination, any deductions, and individual checks with donor names. Both counters must sign off with their PIN before the offering is recorded.
                </DialogDescription>
              </DialogHeader>

              {/* Date & Service */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="svc-date">Service date</Label>
                  <Input id="svc-date" type="date" value={svcDate}
                    onChange={(e) => setSvcDate(e.target.value)} className="mt-1.5" required />
                </div>
                <div>
                  <Label htmlFor="svc-name">Service name</Label>
                  <Select id="svc-name" value={svcName}
                    onChange={(e) => setSvcName(e.target.value)} className="mt-1.5">
                    <option>Sunday Service</option>
                    <option>New Year's Eve (Dec 31)</option>
                    <option>New Year's Day (Jan 1)</option>
                    <option>Midweek Service</option>
                    <option>Wednesday Bible Study</option>
                    <option>Christmas Eve</option>
                    <option>Easter</option>
                    <option>Special Event</option>
                    <option>Online Transfers</option>
                  </Select>
                </div>
              </div>

              {/* Cash by denomination */}
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/30 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-stone-700">
                  <Banknote className="h-4 w-4 text-emerald-600" /> Cash by denomination
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {DENOMS.map((d) => (
                    <div key={d}>
                      <Label className="text-xs">${d}</Label>
                      <Input
                        type="number" min="0" step="1" placeholder="0"
                        value={denoms[d]}
                        onChange={(e) => setDenoms((prev) => ({ ...prev, [d]: e.target.value }))}
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-right text-sm font-medium text-stone-600">
                  Gross cash: <span className="font-serif text-lg text-stone-900">{formatCurrency(grossCash)}</span>
                </div>
              </div>

              {/* Cash deductions */}
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/30 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-stone-700">
                    <MinusCircle className="h-4 w-4 text-rose-500" /> Cash deductions (pastor gift, etc.)
                  </span>
                  <Button size="sm" variant="outline" onClick={addDeduction}>+ Add</Button>
                </div>
                {deductions.length === 0 && (
                  <p className="text-xs text-stone-400">No deductions. Add one if cash was taken before deposit.</p>
                )}
                {deductions.map((ded, i) => (
                  <div key={i} className="mt-2 flex items-center gap-2">
                    <Input
                      placeholder="Reason (e.g. Pastor gift)"
                      value={ded.reason}
                      onChange={(e) => updateDeduction(i, { reason: e.target.value })}
                      className="flex-1 h-9 text-sm"
                    />
                    <Input
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={ded.amount}
                      onChange={(e) => updateDeduction(i, { amount: e.target.value })}
                      className="w-28 h-9 text-sm"
                    />
                    <button onClick={() => removeDeduction(i)}
                      className="rounded p-1 text-stone-400 hover:bg-rose-100 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {deductions.length > 0 && (
                  <div className="mt-2 text-right text-sm text-stone-600">
                    Deductions: <span className="font-medium text-rose-700">{formatCurrency(totalDeductions)}</span>
                  </div>
                )}
              </div>

              {/* Net cash display */}
              <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-center">
                <span className="text-sm text-stone-500">Net cash deposit</span>
                <div className="font-serif text-2xl font-semibold text-stone-900">
                  {formatCurrency(netCash)}
                </div>
              </div>

              {/* Checks per donor */}
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-stone-700">
                    <ScrollText className="h-4 w-4 text-amber-600" /> Individual checks
                  </span>
                  <Button size="sm" variant="outline" onClick={addCheck}>+ Add check</Button>
                </div>
                {checks.length === 0 && (
                  <p className="text-xs text-stone-400">No checks yet. Add checks with donor names for tax receipts.</p>
                )}
                {checks.map((ch) => (
                  <div key={ch.key} className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-100 bg-white p-2">
                    <div className="flex-1 min-w-[160px]">
                      <Label className="text-xs">Donor</Label>
                      <div className="relative">
                        <input
                          value={ch.donorName}
                          onChange={(e) => {
                            updateCheck(ch.key, { donorName: e.target.value, donorId: "" });
                            setActiveSuggestKey(ch.key);
                          }}
                          onFocus={() => setActiveSuggestKey(ch.key)}
                          onBlur={() => setActiveSuggestKey(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const first = suggestionsFor(ch.donorName)[0];
                              if (first) { e.preventDefault(); pickDonor(ch.key, first); }
                            } else if (e.key === "Escape") {
                              setActiveSuggestKey(null);
                            }
                          }}
                          placeholder="Type member name…"
                          className="mt-1 w-full rounded-md border border-stone-200 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                        />
                        {activeSuggestKey === ch.key && ch.donorName.trim() !== "" && (
                          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg">
                            {suggestionsFor(ch.donorName).length === 0 ? (
                              <li className="px-3 py-2 text-xs text-amber-600">
                                No match — new member will be created on save
                              </li>
                            ) : (
                              suggestionsFor(ch.donorName).map((d) => (
                                <li
                                  key={d.id}
                                  onMouseDown={(e) => { e.preventDefault(); pickDonor(ch.key, d); }}
                                  className="cursor-pointer px-3 py-2 text-sm text-stone-700 hover:bg-accent-soft hover:text-accent"
                                >
                                  {d.first_name} {d.last_name}
                                </li>
                              ))
                            )}
                          </ul>
                        )}
                      </div>
                      {ch.donorName.trim() !== "" && !ch.donorId && (
                        <p className="mt-1 text-[11px] font-medium text-amber-600">
                          New member — auto-created on save. Add details later in Donors.
                        </p>
                      )}
                    </div>
                    <div className="w-24">
                      <Label className="text-xs">Check #</Label>
                      <Input
                        placeholder="#"
                        value={ch.checkNumber}
                        onChange={(e) => updateCheck(ch.key, { checkNumber: e.target.value })}
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                    <div className="w-28">
                      <Label className="text-xs">Amount</Label>
                      <Input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={ch.amount}
                        onChange={(e) => updateCheck(ch.key, { amount: e.target.value })}
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                    <button onClick={() => removeCheck(ch.key)}
                      className="mt-4 rounded p-1 text-stone-400 hover:bg-rose-100 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {checks.length > 0 && (
                  <div className="mt-2 text-right text-sm text-stone-600">
                    Checks total: <span className="font-serif text-lg font-semibold text-stone-900">{formatCurrency(totalChecks)}</span>
                  </div>
                )}
              </div>

              {/* Deposit total */}
              <div className="mt-3 rounded-lg border-2 border-accent bg-accent-soft p-3 text-center">
                <span className="text-sm font-medium text-accent">Total deposit</span>
                <div className="font-serif text-3xl font-bold text-stone-900">
                  {formatCurrency(depositTotal)}
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  Net cash {formatCurrency(netCash)} + Checks {formatCurrency(totalChecks)}
                </p>
              </div>

              {/* ── Counter sign-off ──────────────────────────────────── */}
              <div className="mt-4 rounded-lg border-2 border-amber-200 bg-amber-50/40 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-stone-700">
                  <Shield className="h-4 w-4 text-amber-600" /> Counter sign-off (dual verification)
                </div>
                <p className="mb-3 text-xs text-stone-500">
                  Both designated counters must enter their PIN to verify the cash count and deposit.
                  This replaces the physical ledger signature.
                </p>
                {signOffError && (
                  <div className="mb-3 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <AlertTriangle className="h-4 w-4" />
                    {signOffError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {/* Counter 1 — logged-in user (auto) */}
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-emerald-700">
                      <UserCheck className="h-3.5 w-3.5" /> Counter 1 (you)
                    </div>
                    <div className="mb-2 rounded-md bg-white/80 px-3 py-2 text-sm font-medium text-stone-800">
                      {ctx.profile?.full_name ?? "Logged-in user"}
                    </div>
                    <div className="relative">
                      <Key className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                      <Input
                        type="password"
                        maxLength={6}
                        placeholder="Your PIN"
                        value={counter1Pin}
                        onChange={(e) => { setCounter1Pin(e.target.value); setSignOffError(""); }}
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                  </div>
                  {/* Counter 2 */}
                  <div className="rounded-lg border border-amber-100 bg-white p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-amber-700">
                      <UserCheck className="h-3.5 w-3.5" /> Counter 2
                    </div>
                    <Select
                      value={counter2Id}
                      onChange={(e) => { setCounter2Id(e.target.value); setSignOffError(""); }}
                      className="mb-2 h-9 text-sm"
                    >
                      <option value="">Select second counter…</option>
                      {counterList.filter((c) => c.id !== counter1Id).map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name}</option>
                      ))}
                    </Select>
                    <div className="relative">
                      <Key className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                      <Input
                        type="password"
                        maxLength={6}
                        placeholder="Their PIN"
                        value={counter2Pin}
                        onChange={(e) => { setCounter2Pin(e.target.value); setSignOffError(""); }}
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="mt-3">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="mt-1.5" placeholder="Any additional notes..." />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving || depositTotal <= 0}>
                  {saving ? "Signing & saving…" : "Sign & record offering"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Net cash</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totals.cash)}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Checks</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totals.checks)}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Church className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Total deposited</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totals.grand)}</div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── Filter ───────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="border-b border-stone-100">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-stone-400" />
            <span className="text-stone-500">Filter by year & date range</span>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-stone-500">Year</Label>
              <Select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="mt-1 w-36">
                <option value="all">All years</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs text-stone-500">From</Label>
              <Input type="date" value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-44" />
            </div>
            <div>
              <Label className="text-xs text-stone-500">To</Label>
              <Input type="date" value={dateTo}
                onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-44" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                Clear
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState icon={<Church className="h-6 w-6" />}
          title="No offerings recorded"
          description="Record your first service collection to start tracking weekly offerings." />
      ) : (
        <TableWrap>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Service</Th>
              <Th>Counters</Th>
              <Th>Deposit</Th>
              <Th>Docs</Th>
              <Th className="text-right">Cash (net)</Th>
              <Th className="text-right">Checks</Th>
              <Th className="text-right">Total</Th>
              <Th>Notes</Th>
            </Tr>
          </THead>
          <tbody>
            {filtered.map((o) => (
              <Tr key={o.id}>
                <Td className="whitespace-nowrap font-medium">{formatDate(o.service_date)}</Td>
                <Td><Badge tone="indigo">{o.service_name}</Badge></Td>
                <Td>
                  {o.counter_1_id ? (
                    <div className="flex items-center gap-1 text-xs text-stone-600">
                      <Shield className="h-3 w-3 text-emerald-500" />
                      <span>{counterName(o.counter_1_id)} & {counterName(o.counter_2_id)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-stone-400 italic">Unsigned</span>
                  )}
                </Td>
                <Td>
                  {o.deposit_status === "deposited" ? (
                    <Badge tone="emerald">Deposited</Badge>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Badge tone="amber">Pending</Badge>
                      <Button size="sm" variant="ghost"
                        onClick={() => { setDepositOfferingId(o.id); setDepositFile(null); setDepositError(""); setDepositOpen(true); }}
                        iconLeft={<Upload className="h-3.5 w-3.5" />}>
                        Deposit
                      </Button>
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost"
                      onClick={async () => {
                        const checksData = await loadOfferingChecks(o);
                        openLedgerPreview(buildOfferingDocs(o, checksData).summary);
                      }}
                      iconLeft={<FileDown className="h-3.5 w-3.5" />}
                    >
                      Ledger
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={async () => {
                        const checksData = await loadOfferingChecks(o);
                        openReceiptPreview(buildOfferingDocs(o, checksData).receipt);
                      }}
                      iconLeft={<Receipt className="h-3.5 w-3.5" />}
                    >
                      Receipt
                    </Button>
                  </div>
                </Td>
                <Td className="text-right font-mono text-sm text-stone-700">
                  {formatCurrency(o.cash_net || o.cash_amount)}
                </Td>
                <Td className="text-right font-mono text-sm text-stone-700">
                  <span>{formatCurrency(o.check_amount)}</span>
                  {o.check_count > 0 && (
                    <span className="ml-1 text-xs text-stone-400">({o.check_count})</span>
                  )}
                </Td>
                <Td className="text-right font-serif text-base font-semibold text-stone-900">
                  {formatCurrency(o.total_amount)}
                </Td>
                <Td className="max-w-[200px] truncate text-sm text-stone-500">{o.notes ?? "—"}</Td>
              </Tr>
            ))}
            <Tr>
              <Td colSpan={5} className="border-t-2 border-stone-200 py-4 text-right font-semibold">
                Totals ({filtered.length} services)
              </Td>
              <Td className="border-t-2 border-stone-200 py-4 text-right font-mono font-semibold text-stone-900">
                {formatCurrency(totals.cash)}
              </Td>
              <Td className="border-t-2 border-stone-200 py-4 text-right font-mono font-semibold text-stone-900">
                {formatCurrency(totals.checks)}
              </Td>
              <Td className="border-t-2 border-stone-200 py-4 text-right font-serif text-lg font-semibold text-stone-900">
                {formatCurrency(totals.grand)}
              </Td>
              <Td className="border-t-2 border-stone-200 py-4" />
            </Tr>
          </tbody>
        </TableWrap>
      )}

      {/* ── Mark deposited dialog ──────────────────────────────────────── */}
      <Dialog open={depositOpen} onOpenChange={(v) => { setDepositOpen(v); if (!v) { setDepositFile(null); setDepositOfferingId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark offering as deposited</DialogTitle>
            <DialogDescription>
              After the cash and checks are deposited at the bank, attach the bank deposit slip and mark this offering complete.
              {depositOffering && <> <strong>{depositOffering.service_name}</strong> · {formatDate(depositOffering.service_date)} · {formatCurrency(depositOffering.total_amount)}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {depositError && (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertTriangle className="h-4 w-4" /> {depositError}
              </div>
            )}
            <div>
              <Label htmlFor="deposit-receipt">Bank deposit slip / receipt (photo or PDF)</Label>
              <input
                id="deposit-receipt"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setDepositFile(e.target.files?.[0] ?? null)}
                className="mt-1.5 block w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
              />
            </div>
            <p className="text-xs text-stone-500">The offering stays in the ledger with a "Deposited" badge and the receipt is stored for auditing.</p>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDepositOpen(false)}>Cancel</Button>
            <Button onClick={handleMarkDeposited} disabled={depositSaving}>
              {depositSaving ? "Marking…" : "Mark as deposited"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Document preview (ledger slip / receipt) ───────────────────── */}
      <Dialog open={docPreview !== null} onOpenChange={(v) => { if (!v) setDocPreview(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{docPreview?.title ?? "Document preview"}</DialogTitle>
            <DialogDescription>
              {docPreview?.subtitle ?? ""}
            </DialogDescription>
          </DialogHeader>
          {docPreview && (
            <div className="h-[62vh] overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
              <iframe
                title="Document preview"
                src={docPreview.url}
                className="h-full w-full"
              />
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const frame = document.querySelector<HTMLIFrameElement>("iframe[title='Document preview']");
                frame?.contentWindow?.print();
              }}
              iconLeft={<Printer className="h-4 w-4" />}
            >
              Print
            </Button>
            <Button
              variant="outline"
              onClick={() => docPreview?.onDownload()}
              iconLeft={<Download className="h-4 w-4" />}
            >
              Download PDF
            </Button>
            <Button onClick={() => setDocPreview(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
