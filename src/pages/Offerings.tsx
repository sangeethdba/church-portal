import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Plus, Church, Banknote, ScrollText, Filter, Trash2, MinusCircle,
  Shield, UserCheck, Key, AlertTriangle, Clock, FileDown, Upload, CheckCircle2,
  Download, Printer, Receipt, CalendarRange, Gift, Pencil, ScanLine, Loader2,
} from "lucide-react";
import {
  Button, Card, CardBody, CardHeader, Input, Label, Textarea, Select,
  Badge, EmptyState, TableWrap, THead, Tr, Th, Td,
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
  toast,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, getReceiptUrl, isAdminRole, isOversightRole } from "@/lib/supabase";
import type { Donor } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { computeCashFromDenoms, normName } from "@/lib/accounting";
import { downloadOfferingSummary, offeringSummaryDataUrl, type OfferingSummary, type OfferingDenomEntry, type OfferingCheckEntry, type OfferingDeductionEntry } from "@/lib/pdf";

// ── Denomination preset ───────────────────────────────────────────────────
const DENOMS = [100, 50, 20, 10, 5, 2, 1] as const;
type DenomCounts = Record<number, string>;

interface Deduction {
  reason: string;
  amount: string;
}

interface IndividualDonation {
  key: string;
  donorName: string;
  donorId: string;
  method: "check" | "cash";
  checkNumber: string;
  amount: string;
}

interface CounterInfo {
  id: string;
  full_name: string;
  email?: string | null;
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


// ── Helpers ────────────────────────────────────────────────────────────────
function emptyDenoms(): DenomCounts {
  const c: DenomCounts = {};
  for (const d of DENOMS) c[d] = "";
  return c;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Offerings() {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingOffering, setEditingOffering] = useState<Offering | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Offering | null>(null);
  const [deleting, setDeleting] = useState(false);
  // ── Scan ledger state ────────────────────────────────────────────────
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [filterYear, setFilterYear] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [donorList, setDonorList] = useState<Donor[]>([]);

  // ── Form state ─────────────────────────────────────────────────────────
  const [svcDate, setSvcDate] = useState(new Date().toISOString().slice(0, 10));
  const [svcName, setSvcName] = useState("Sunday Service");
  const [denoms, setDenoms] = useState<DenomCounts>(emptyDenoms());
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [donations, setDonations] = useState<IndividualDonation[]>([]);
  const [notes, setNotes] = useState("");
  const [activeSuggestKey, setActiveSuggestKey] = useState<string | null>(null);

  // ── Counter sign-off state ────────────────────────────────────────────
  const ctx = useOutletContext<{ profile: { id: string; full_name?: string | null; role?: string } | null; isCounter: boolean }>();
  // Counters verify and sign off, but the ledger pages are admin-only —
  // counters are otherwise regular members who only see their own records.
  // The pastor sees the ledger read-only (no record/deposit actions).
  const isAdmin = isAdminRole(ctx.profile?.role);
  const canAccess = isOversightRole(ctx.profile?.role);
  const [counterList, setCounterList] = useState<CounterInfo[]>([]);
  const [nameProfiles, setNameProfiles] = useState<CounterInfo[]>([]);
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

  // Open the treasurer's uploaded bank transaction receipt (from the Deposit flow)
  const openBankSlip = async (o: Offering) => {
    const url = await getReceiptUrl(o.deposit_receipt_path);
    if (!url) return;
    setDocPreview({
      url,
      title: "Bank transaction receipt",
      subtitle: `${o.service_name} · ${formatDate(o.service_date)} · Total deposit ${formatCurrency(o.total_amount)}`,
      onDownload: () => window.open(url, "_blank"),
    });
  };

  // Build the ledger document from a stored offering row + its check lines
  // and named cash-gift donations (stored as donation rows linked to the offering).
  const buildOfferingDocs = (
    o: Offering,
    checksData: { donor_name: string; check_number: string | null; amount: number }[],
    giftsData: { donor_name: string; amount: number }[],
  ) => {
    const net = Number(o.cash_net ?? o.cash_amount) || 0;
    const dedSum = Number((o.cash_deductions as Deduction[])?.reduce((s, d) => s + (Number(d.amount) || 0), 0) ?? 0) || 0;
    const checksTotal = checksData.reduce((s, c) => s + (Number(c.amount) || 0), 0) || Number(o.check_amount) || 0;
    const breakdown = (o.cash_breakdown as DenomCounts | null) ?? {};
    const denomEntries: OfferingDenomEntry[] = DENOMS
      .map((d) => ({ denomination: d, count: Number(breakdown[d]) || 0, subtotal: (Number(breakdown[d]) || 0) * d }))
      .filter((e) => e.count > 0);
    const churchName = (typeof window !== "undefined" && localStorage.getItem("church_name")) || "Atlanta Little Flock Church";
    const checks = checksData.map((c) => ({ donorName: c.donor_name || "—", checkNumber: c.check_number ?? "", amount: Number(c.amount) || 0 }));
    const deductions = (o.cash_deductions as Deduction[])?.map((d: Deduction) => ({ reason: d.reason, amount: Number(d.amount) || 0 })) ?? [];
    const counter1Name = counterName(o.counter_1_id);
    const counter2Name = counterName(o.counter_2_id);
    const giftsTotal = Math.max(0, (Number(o.total_amount) || 0) - net - checksTotal);
    const cashGifts = giftsData.map((g) => ({ donorName: g.donor_name || "—", checkNumber: "", amount: Number(g.amount) || 0 }));
    const giftsFromRows = cashGifts.reduce((s, g) => s + g.amount, 0);
    const summary: OfferingSummary = {
      serviceDate: o.service_date,
      serviceName: o.service_name,
      cashDenoms: denomEntries,
      grossCash: net + dedSum,
      deductions,
      netCash: net,
      checks,
      totalChecks: checksTotal,
      cashGifts,
      totalCashGifts: giftsFromRows || giftsTotal,
      totalDeposit: Number(o.total_amount) || (net + checksTotal + giftsTotal),
      churchName,
      recordedBy: "Admin",
      counter1Name,
      counter2Name,
    };
    return { summary };
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

  const loadOfferingCashGifts = async (o: Offering) => {
    if (!supabase) return [];
    const { data } = await supabase
      .from("donations")
      .select("donor_name, amount")
      .eq("offering_id", o.id)
      .eq("payment_method", "cash")
      .order("donor_name");
    return (data ?? []) as { donor_name: string; amount: number }[];
  };

  // ── Computed values ────────────────────────────────────────────────────
  const grossCash = computeCashFromDenoms(denoms);
  const totalDeductions = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const netCash = grossCash - totalDeductions;
  const totalChecks = donations.filter((d) => d.method === "check").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalCashGifts = donations.filter((d) => d.method === "cash").reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalDonations = donations.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const depositTotal = netCash + totalDonations;

  const filtered = useMemo(() => {
    return offerings.filter((o) => {
      if (filterYear !== "all" && !o.service_date.startsWith(filterYear)) return false;
      if (dateFrom && o.service_date < dateFrom) return false;
      if (dateTo && o.service_date > dateTo) return false;
      return true;
    });
  }, [offerings, filterYear, dateFrom, dateTo]);

  const totals = filtered.reduce(
    (acc, o) => {
      const cash = Number(o.cash_net || o.cash_amount) || 0;
      const checks = Number(o.check_amount) || 0;
      const grand = Number(o.total_amount) || 0;
      return {
        cash: acc.cash + cash,
        checks: acc.checks + checks,
        gifts: acc.gifts + Math.max(0, grand - cash - checks),
        grand: acc.grand + grand,
      };
    },
    { cash: 0, checks: 0, gifts: 0, grand: 0 },
  );

  const years = useMemo(() => {
    const s = new Set<string>();
    offerings.forEach((o) => s.add(o.service_date.slice(0, 4)));
    return Array.from(s).sort().reverse();
  }, [offerings]);

  // Counter name lookup — resolve from ALL profiles (not just current counters),
  // falling back to email so stored sign-offs never render as "Unknown".
  const counterName = (id: string | null | undefined): string => {
    if (!id) return "—";
    const c = nameProfiles.find((x) => x.id === id) ?? counterList.find((x) => x.id === id);
    return c?.full_name || c?.email || "Unknown";
  };

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    Promise.all([
      supabase.from("offerings").select("*").order("service_date", { ascending: false }),
      supabase.from("donors").select("id, first_name, last_name").order("last_name"),
      supabase.rpc("get_all_profiles"),
    ]).then(([{ data: oData }, { data: dData }, { data: profilesData }]) => {
      if (oData) setOfferings(oData as Offering[]);
      if (dData) setDonorList(dData as Donor[]);
      if (profilesData) {
        const pr = profilesData as { profiles: { id: string; full_name?: string | null; email: string; is_counter?: boolean }[] };
        const allP = pr.profiles ?? [];
        setCounterList(allP.filter((p) => p.is_counter).map((p) => ({ id: p.id, full_name: p.full_name || p.email || "Unknown", email: p.email })));
        setNameProfiles(allP.map((p) => ({ id: p.id, full_name: p.full_name || p.email || "Unknown", email: p.email })));
      }
      setLoading(false);
    });
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────
  const resetForm = () => {
    setSvcDate(new Date().toISOString().slice(0, 10));
    setSvcName("Sunday Service");
    setDenoms(emptyDenoms());
    setDeductions([]);
    setDonations([]);
    setNotes("");
    setCounter1Pin("");
    setCounter2Id("");
    setCounter2Pin("");
    setSignOffError("");
    setEditingOffering(null);
  };

  const addDonation = (method: "check" | "cash") => {
    const key = `d${Date.now()}`;
    setDonations((prev) => [...prev, { key, donorName: "", donorId: "", method, checkNumber: "", amount: "" }]);
    // Focus the new row's donor field right away so counters can keep typing
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-donor-key="${key}"] input`)?.focus();
    });
  };

  const removeDonation = (key: string) => setDonations((prev) => prev.filter((d) => d.key !== key));

  const updateDonation = (key: string, patch: Partial<IndividualDonation>) => {
    setDonations((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
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
    updateDonation(key, { donorId: d.id, donorName: `${d.first_name} ${d.last_name}` });
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
    checks: donations.filter((d) => d.method === "check").map((d) => ({ donorName: d.donorName || "—", checkNumber: d.checkNumber, amount: Number(d.amount) || 0 })),
    totalChecks,
    cashGifts: donations.filter((d) => d.method === "cash").map((d) => ({ donorName: d.donorName || "—", checkNumber: "", amount: Number(d.amount) || 0 })),
    totalCashGifts,
    totalDeposit: depositTotal,
    churchName: (typeof window !== "undefined" && localStorage.getItem("church_name")) || "Atlanta Little Flock Church",
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
      check_count: donations.filter((d) => d.method === "check").length,
      total_amount: depositTotal,
      recorded_by: recordedBy,
      notes: notes || null,
    };

    if (supabase) {
      // Build the p_checks array from local state
      const p_checks = donations
        .filter((d) => d.method === "check" && Number(d.amount) > 0)
        .map((d) => ({
          donor_name: d.donorName.trim() || "Anonymous",
          donor_id: d.donorId || null,
          check_number: d.checkNumber || null,
          amount: Number(d.amount),
        }));

      // Build named cash gifts from unified donations
      const p_cash_gifts = donations
        .filter((d) => d.method === "cash" && Number(d.amount) > 0)
        .map((d) => ({
          donor_name: d.donorName.trim() || "Anonymous",
          donor_id: d.donorId || null,
          amount: Number(d.amount),
        }));

      // Atomic: insert offering + checks + cash gifts + PIN verify in one transaction.
      // If PIN is wrong the DB raises an exception and nothing is persisted.
      if (editingOffering) {
        const { error: updErr } = await supabase.rpc("update_offering", {
          p_offering_id: editingOffering.id,
          p_service_date: svcDate,
          p_service_name: svcName,
          p_cash_breakdown: denoms,
          p_cash_deductions: deductions,
          p_cash_net: netCash,
          p_check_amount: totalChecks,
          p_check_count: donations.filter((d) => d.method === "check").length,
          p_total_amount: depositTotal,
          p_notes: notes || null,
          p_checks,
          p_cash_gifts,
          p_counter_1_id: counter1Id,
          p_pin_1: counter1Pin,
          p_counter_2_id: counter2Id,
          p_pin_2: counter2Pin,
        });
        if (updErr) {
          console.warn("Offering update failed:", updErr);
          setSignOffError(updErr.message || "Could not update the offering. Check PINs and try again.");
          setSaving(false);
          return;
        }
        const { data: freshUpd } = await supabase
          .from("offerings")
          .select("*")
          .order("service_date", { ascending: false });
        if (freshUpd) setOfferings(freshUpd as Offering[]);
        toast("Offering updated — every total and report reflects the change.", "success");
        openLedgerPreview(buildSummary());
      } else {
      const { error: rpcErr } = await supabase.rpc("record_offering", {
        p_service_date: svcDate,
        p_service_name: svcName,
        p_cash_breakdown: denoms,
        p_cash_deductions: deductions,
        p_cash_net: netCash,
        p_check_amount: totalChecks,
        p_check_count: donations.filter((d) => d.method === "check").length,
        p_total_amount: depositTotal,
        p_notes: notes || null,
        p_checks,
        p_counter_1_id: counter1Id,
        p_pin_1: counter1Pin,
        p_counter_2_id: counter2Id,
        p_pin_2: counter2Pin,
        p_cash_gifts,
      });

      if (rpcErr) {
        console.warn("Offering recording failed:", rpcErr);
        setSignOffError(rpcErr.message || "PIN verification failed. Check PINs and try again.");
        setSaving(false);
        return;
      }

      // Refresh & show ledger
      const { data: fresh } = await supabase
        .from("offerings")
        .select("*")
        .order("service_date", { ascending: false });
      if (fresh) setOfferings(fresh as Offering[]);
      openLedgerPreview(buildSummary());
      }
    } else {
      // Demo mode
      const baseRow: Offering = {
        ...payload,
        id: editingOffering?.id ?? `local-${Date.now()}`,
        recorded_by: "demo",
        created_at: new Date().toISOString(),
        cash_breakdown: payload.cash_breakdown as DenomCounts,
        cash_deductions: payload.cash_deductions as Deduction[],
        counter_1_id: null,
        counter_1_signed_at: null,
        counter_2_id: null,
        counter_2_signed_at: null,
      } as Offering;
      if (editingOffering) {
        setOfferings((prev) => prev.map((r) => (r.id === editingOffering.id ? baseRow : r)));
      } else {
        setOfferings((prev) => [baseRow, ...prev]);
      }

      // Show the deposit slip / ledger in-app (replaces silent auto-download)
      openLedgerPreview(buildSummary());
    }

    setSaving(false);
    setOpen(false);
    setEditingOffering(null);
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

  // ── Edit / delete offering (admin only) ────────────────────────────────
  const startEdit = async (o: Offering) => {
    const [checksData, giftsData] = await Promise.all([
      loadOfferingChecks(o),
      loadOfferingCashGifts(o),
    ]);
    const stamp = Date.now();
    setSvcDate(o.service_date);
    setSvcName(o.service_name);
    setDenoms((o.cash_breakdown as DenomCounts | null) ?? emptyDenoms());
    setDeductions((o.cash_deductions as Deduction[] | null) ?? []);
    setDonations([
      ...checksData.map((c, i) => ({
        key: `edit-c-${stamp}-${i}`,
        donorName: c.donor_name ?? "",
        donorId: "",
        method: "check" as const,
        checkNumber: c.check_number ?? "",
        amount: String(c.amount ?? ""),
      })),
      ...giftsData.map((g, i) => ({
        key: `edit-g-${stamp}-${i}`,
        donorName: g.donor_name ?? "",
        donorId: "",
        method: "cash" as const,
        checkNumber: "",
        amount: String(g.amount ?? ""),
      })),
    ]);
    setNotes(o.notes ?? "");
    setCounter2Id(o.counter_2_id ?? "");
    setCounter1Pin("");
    setCounter2Pin("");
    setSignOffError("");
    setEditingOffering(o);
    setOpen(true);
  };

  const handleDeleteOffering = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    if (supabase) {
      const { error } = await supabase.rpc("delete_offering", { p_offering_id: deleteTarget.id });
      if (error) {
        console.warn("Delete offering failed:", error);
        toast("Could not delete this offering — please try again.", "error");
      } else {
        toast(`Offering for ${formatDate(deleteTarget.service_date)} deleted — totals updated.`, "success");
        const { data: fresh } = await supabase
          .from("offerings")
          .select("*")
          .order("service_date", { ascending: false });
        if (fresh) setOfferings(fresh as Offering[]);
      }
    } else {
      setOfferings((rows) => rows.filter((r) => r.id !== deleteTarget.id));
      toast("Offering deleted (demo).", "success");
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  // ── Scan paper ledger via Gemini Vision ──────────────────────────────
  const handleScanLedger = async () => {
    if (!scanFile || !supabase) return;
    setScanLoading(true);
    setScanError("");
    try {
      // Compress image before sending (Edge Functions have a 6 MB payload limit)
      const compressImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const MAX_W = 1200;
            let w = img.width, h = img.height;
            if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.75));
          };
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = URL.createObjectURL(file);
        });
      };
      const base64 = await compressImage(scanFile);
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch(
        `https://qjoxqfkdyugwmgzgjzir.supabase.co/functions/v1/scan-ledger`,
        { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ imageBase64: base64 }) },
      );

      let json: { success?: boolean; error?: string; data?: Record<string, unknown> };
      try { json = await res.json(); } catch {
        setScanError(`Server error (${res.status}). Try again.`);
        setScanLoading(false);
        return;
      }

      if (!json.success) {
        setScanError(json.error ?? `Scan failed (${res.status})`);
        setScanLoading(false);
        return;
      }
      const d = json.data!;
      const newDenoms = emptyDenoms();
      if (d.denominations) for (const [k, v] of Object.entries(d.denominations as Record<string, unknown>)) if (k in newDenoms) newDenoms[Number(k)] = String(Math.max(0, Math.round(Number(v) || 0)));
      const dedArray = ((d.deductions ?? []) as Array<{ reason: string; amount: number }>).map((ded) => ({ reason: ded.reason || "", amount: String(Math.max(0, Number(ded.amount) || 0)) }));
      const stamp = Date.now();
      const newDonations: IndividualDonation[] = [
        ...((d.checks ?? []) as Array<{ donorName: string; checkNumber: string; amount: number }>).map((c, i) => ({ key: `scan-c-${stamp}-${i}`, donorName: c.donorName || "", donorId: "", method: "check" as const, checkNumber: c.checkNumber ? String(c.checkNumber) : "", amount: String(Math.max(0, Number(c.amount) || 0)) })),
        ...((d.cashGifts ?? []) as Array<{ donorName: string; amount: number }>).map((g, i) => ({ key: `scan-g-${stamp}-${i}`, donorName: g.donorName || "", donorId: "", method: "cash" as const, checkNumber: "", amount: String(Math.max(0, Number(g.amount) || 0)) })),
      ];
      setScanOpen(false); setScanFile(null); setScanPreview(null); setScanLoading(false);
      setSvcDate((d.serviceDate as string)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
      setSvcName((d.serviceName as string) || "Sunday Service");
      setDenoms(newDenoms); setDeductions(dedArray); setDonations(newDonations); setNotes((d.notes as string) ?? "");
      setCounter1Pin(""); setCounter2Id(""); setCounter2Pin(""); setSignOffError(""); setEditingOffering(null);
      setOpen(true);
      toast("Ledger scanned! Review each entry, correct any OCR errors, then sign and save.", "success");
    } catch (err) {
      console.warn("Scan ledger failed:", err);
      setScanError(`Could not scan the ledger — ${err instanceof Error ? err.message : "please try again or enter manually."}`);
      setScanLoading(false);
    }
  };

  return (
    <div>
      {!canAccess && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-6 py-16 text-center">
          <Shield className="mb-3 h-10 w-10 text-amber-400" />
          <h2 className="font-serif text-xl font-semibold text-stone-800">Access restricted</h2>
          <p className="mt-2 max-w-md text-sm text-stone-500">
            The Offerings section is only available to designated counters and admins.
            Contact your church administrator if you need access.
          </p>
        </div>
      )}
      {canAccess && (
      <>
      <PageHeader
        title="Offerings"
        subtitle="Record Sunday collections — cash by denomination, individual checks per donor, and dual counter sign-off."
        badge={`${filtered.length} services`}
        actions={
          isAdmin && (
          <div className="flex items-center gap-2">
            <Button iconLeft={<ScanLine className="h-4 w-4" />} variant="outline" onClick={() => { setScanFile(null); setScanPreview(null); setScanError(""); setScanOpen(true); }}>
              Scan ledger
            </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Record offering</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingOffering ? "Edit service offering" : "Record a service offering"}</DialogTitle>
                <DialogDescription>
                  {editingOffering ? "Correct the service collection details below — every total, report, and annual summary updates automatically." : "Enter cash by denomination, any deductions, and individual checks with donor names. Both counters must sign off with their PIN before the offering is recorded."}
                </DialogDescription>
              </DialogHeader>

              {editingOffering?.deposit_status === "deposited" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>This offering was already marked as <strong>deposited</strong>. Changing it modifies the ledger, reports, and reconciliation — double-check against your bank records before saving.</span>
                </div>
              )}

              {/* Date & Service */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

              {/* Individual donations (checks + named cash) */}
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-stone-700">
                    <ScrollText className="h-4 w-4 text-amber-600" /> Individual donations
                  </span>
                  <Button size="sm" variant="outline" onClick={() => addDonation("check")}>+ Add donation</Button>
                </div>
                {donations.length === 0 && (
                  <p className="text-xs text-stone-400">No donations yet. Add checks with donor names + check numbers, or cash envelopes for named givers.</p>
                )}
                {donations.length > 0 && (
                  <p className="mb-1 text-xs text-stone-400">Tip: press <kbd className="rounded border border-stone-300 bg-stone-100 px-1 text-[10px]">Enter</kbd> in the Amount field to add the next donation instantly.</p>
                )}
                {donations.map((d) => (
                  <div key={d.key} className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-100 bg-white p-2">
                    <div className="flex-1 min-w-[160px]" data-donor-key={d.key}>
                      <Label className="text-xs">Donor</Label>
                      <div className="relative">
                        <input
                          value={d.donorName}
                          onChange={(e) => {
                            updateDonation(d.key, { donorName: e.target.value, donorId: "" });
                            setActiveSuggestKey(d.key);
                          }}
                          onFocus={() => setActiveSuggestKey(d.key)}
                          onBlur={() => setActiveSuggestKey(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const first = suggestionsFor(d.donorName)[0];
                              if (first) { e.preventDefault(); pickDonor(d.key, first); }
                            } else if (e.key === "Escape") {
                              setActiveSuggestKey(null);
                            }
                          }}
                          placeholder="Type member name…"
                          className="mt-1 w-full rounded-md border border-stone-200 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                        />
                        {activeSuggestKey === d.key && d.donorName.trim() !== "" && (
                          <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg">
                            {suggestionsFor(d.donorName).length === 0 ? (
                              <li className="px-3 py-2 text-xs text-amber-600">
                                No match — new member will be created on save
                              </li>
                            ) : (
                              suggestionsFor(d.donorName).map((donor) => (
                                <li
                                  key={donor.id}
                                  onMouseDown={(e) => { e.preventDefault(); pickDonor(d.key, donor); }}
                                  className="cursor-pointer px-3 py-2 text-sm text-stone-700 hover:bg-accent-soft hover:text-accent"
                                >
                                  {donor.first_name} {donor.last_name}
                                </li>
                              ))
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                    <div className="w-24">
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={d.method}
                        onChange={(e) => updateDonation(d.key, { method: e.target.value as "check" | "cash", checkNumber: e.target.value === "cash" ? "" : d.checkNumber })}
                        className="mt-1 h-9 text-sm"
                      >
                        <option value="check">Check</option>
                        <option value="cash">Cash</option>
                      </Select>
                    </div>
                    {d.method === "check" && (
                      <div className="w-24">
                        <Label className="text-xs">Check #</Label>
                        <Input
                          placeholder="#"
                          value={d.checkNumber}
                          onChange={(e) => updateDonation(d.key, { checkNumber: e.target.value })}
                          className="mt-1 h-9 text-sm"
                        />
                      </div>
                    )}
                    <div className="w-28">
                      <Label className="text-xs">Amount</Label>
                      <Input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={d.amount}
                        onChange={(e) => updateDonation(d.key, { amount: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addDonation(d.method === "cash" ? "cash" : "check");
                          }
                        }}
                        className="mt-1 h-9 text-sm"
                      />
                    </div>
                    <button onClick={() => removeDonation(d.key)}
                      className="mt-4 rounded p-1 text-stone-400 hover:bg-rose-100 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {donations.length > 0 && (
                  <button
                    onClick={() => addDonation("check")}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-amber-300 bg-white/60 px-3 py-2.5 text-sm font-medium text-amber-700 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800"
                  >
                    <Plus className="h-4 w-4" /> Add another donation
                  </button>
                )}
                {donations.length > 0 && (
                  <div className="mt-2 text-right text-sm text-stone-600 space-y-0.5">
                    {totalChecks > 0 && (
                      <div>Checks: <span className="font-serif font-semibold text-amber-700">{formatCurrency(totalChecks)}</span> ({donations.filter((d) => d.method === "check").length})</div>
                    )}
                    {totalCashGifts > 0 && (
                      <div>Named cash: <span className="font-serif font-semibold text-green-700">{formatCurrency(totalCashGifts)}</span> ({donations.filter((d) => d.method === "cash").length})</div>
                    )}
                    <div className="font-serif text-lg font-semibold text-stone-900">
                      Total donations: {formatCurrency(totalDonations)}
                    </div>
                  </div>
                )}
              </div>

              {/* Deposit total */}


              {/* Deposit total */}
              <div className="mt-3 rounded-lg border-2 border-accent bg-accent-soft p-3 text-center">
                <span className="text-sm font-medium text-accent">Total deposit</span>
                <div className="font-serif text-3xl font-bold text-stone-900">
                  {formatCurrency(depositTotal)}
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  Net cash {formatCurrency(netCash)} (incl. {formatCurrency(totalCashGifts)} named) + Checks {formatCurrency(totalChecks)}
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  {saving ? "Saving…" : editingOffering ? "Save changes" : "Sign & record offering"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
          )
        }
      />

      {/* ── Summary cards ────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-lime-100 text-lime-700">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Named cash gifts</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(totals.gifts)}</div>
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
      <p className="mb-6 mt-2 text-xs text-stone-500">
        Sunday collection cards only — online gifts are entered under <strong>Donations</strong> and roll into <strong>Reports</strong> &amp; annual totals, not the offering slip. Cash shown is net after pastor-gift deductions.
      </p>

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
        <TableWrap className="min-w-[900px]">
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Service</Th>
              <Th>Counters</Th>
              <Th>Deposit</Th>
              <Th>Docs</Th>
              <Th className="text-right">Cash (net)</Th>
              <Th className="text-right">Checks</Th>
              <Th className="text-right">Cash gifts</Th>
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
                      {isAdmin && (
                        <Button size="sm" variant="ghost"
                          onClick={() => { setDepositOfferingId(o.id); setDepositFile(null); setDepositError(""); setDepositOpen(true); }}
                          iconLeft={<Upload className="h-3.5 w-3.5" />}>
                          Deposit
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    {isAdmin && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(o)}
                          iconLeft={<Pencil className="h-3.5 w-3.5" />}
                          title="Edit this offering — totals and reports recompute automatically"
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(o)}
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                          title="Delete this offering"
                        >
                          Delete
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost"
                      onClick={async () => {
                        const [checksData, giftsData] = await Promise.all([
                          loadOfferingChecks(o),
                          loadOfferingCashGifts(o),
                        ]);
                        openLedgerPreview(buildOfferingDocs(o, checksData, giftsData).summary);
                      }}
                      iconLeft={<FileDown className="h-3.5 w-3.5" />}
                    >
                      Ledger
                    </Button>
                    <Button size="sm" variant="ghost"
                      disabled={!o.deposit_receipt_path}
                      title={o.deposit_receipt_path ? "Open the bank transaction receipt uploaded after deposit" : "No bank slip uploaded yet — use the Deposit button after the bank run"}
                      onClick={() => openBankSlip(o)}
                      iconLeft={<Receipt className="h-3.5 w-3.5" />}
                    >
                      View bank slip
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
                <Td className="text-right font-mono text-sm text-lime-700">
                  {formatCurrency(Math.max(0, Number(o.total_amount) - (Number(o.cash_net || o.cash_amount) || 0) - (Number(o.check_amount) || 0)))}
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
              <Td className="border-t-2 border-stone-200 py-4 text-right font-mono font-semibold text-lime-700">
                {formatCurrency(totals.gifts)}
              </Td>
              <Td className="border-t-2 border-stone-200 py-4 text-right font-serif text-lg font-semibold text-stone-900">
                {formatCurrency(totals.grand)}
              </Td>
              <Td className="border-t-2 border-stone-200 py-4" />
            </Tr>
          </tbody>
        </TableWrap>
      )}

      {/* ── Scan ledger dialog ─────────────────────────────────────────── */}
      <Dialog open={scanOpen} onOpenChange={(v) => { setScanOpen(v); if (!v) { setScanFile(null); setScanPreview(null); setScanError(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan paper ledger</DialogTitle>
            <DialogDescription>
              Take a clear photo of your paper Sunday offering ledger. AI will read the handwriting and pre-fill the offering form for review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* File input */}
            <div>
              <Label htmlFor="ledger-photo">Upload ledger photo</Label>
              <input
                id="ledger-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setScanFile(file);
                  setScanPreview(file ? URL.createObjectURL(file) : null);
                  setScanError("");
                }}
                className="mt-1.5 block w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-amber-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-amber-700 hover:file:bg-amber-100"
              />
            </div>
            {/* Preview */}
            {scanPreview && (
              <div className="overflow-hidden rounded-lg border border-stone-200">
                <img src={scanPreview} alt="Ledger preview" className="max-h-64 w-full object-contain bg-stone-100" />
              </div>
            )}
            {/* Tips */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Tips for best results:</strong>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>Place the ledger on a flat surface with good lighting</li>
                <li>Make sure all columns (name, check #, amount) are clearly visible</li>
                <li>Avoid shadows and glare on the paper</li>
                <li>You'll review and correct every entry before it's saved</li>
              </ul>
            </div>
            {/* Error */}
            {scanError && (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <AlertTriangle className="h-4 w-4" /> {scanError}
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setScanOpen(false); setScanFile(null); setScanPreview(null); setScanError(""); }}>Cancel</Button>
            <Button onClick={handleScanLedger} disabled={!scanFile || scanLoading}>
              {scanLoading ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Scanning…</> : "Scan & fill form"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* ── Delete offering confirmation ────────────────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this offering?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `${formatDate(deleteTarget.service_date)} · ${deleteTarget.service_name} · ${formatCurrency(deleteTarget.total_amount)}` : ""}
              {" — "}this permanently removes the offering, every check, and its named cash gifts.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>The offering's donation rows are deleted (not left as standalone gifts), so Reports stays accurate. This cannot be undone.
{deleteTarget?.deposit_status === "deposited" ? " Deleting a deposited offering will affect reconciliation records." : ""}</span>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { if (!deleting) setDeleteTarget(null); }}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-700" disabled={deleting} onClick={handleDeleteOffering}>
              {deleting ? "Deleting…" : "Delete offering"}
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
      </>
      )}
    </div>
  );
}
