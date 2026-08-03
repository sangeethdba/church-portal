import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Plus, HandCoins, FileDown, Filter, Shield, Church, CalendarRange, Globe, Search, Trash2, Check } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Select,
  Badge,
  EmptyState,
  TableWrap,
  THead,
  Tr,
  Th,
  Td,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  toast,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isAdminRole, isOversightRole } from "@/lib/supabase";
import type { Donation, Donor } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { downloadStatement, type AnnualStatement } from "@/lib/pdf";

const sampleDonations: Donation[] = [
  {
    id: "demo-1",
    donor_name: "The Reyes Family",
    amount: 420,
    donation_type: "tithe",
    payment_method: "check",
    donation_date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    entered_by: "demo",
    donor_id: "demo-d2",
    donor_email: null,
    check_number: "2210",
    notes: "Monthly tithe",
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-2",
    donor_name: "Marcus Lin",
    amount: 150,
    donation_type: "offering",
    payment_method: "online",
    donation_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    entered_by: "demo",
    donor_id: "demo-d1",
    donor_email: null,
    check_number: null,
    notes: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-3",
    donor_name: "Anonymous",
    amount: 80,
    donation_type: "missions",
    payment_method: "cash",
    donation_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    entered_by: "demo",
    donor_id: null,
    donor_email: null,
    check_number: null,
    notes: "Sunday plate",
    created_at: new Date().toISOString(),
  },
];
const sampleDonorsForPick: { id: string; label: string }[] = [
  { id: "demo-d1", label: "Marcus Lin" },
  { id: "demo-d2", label: "The Reyes Family" },
];

// ---------- Quick online giving (bulk entry) ----------
interface QuickRow {
  key: number;
  query: string;
  donorId: string;
  date: string;
  amount: string;
}

/** Type-to-search donor picker with keyboard support (↑/↓/Enter/Esc). */
function QuickDonorInput({
  query,
  onQuery,
  donors,
  onPick,
}: {
  query: string;
  onQuery: (v: string) => void;
  donors: { id: string; label: string }[];
  onPick: (d: { id: string; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return donors.filter((d) => d.label.toLowerCase().includes(q)).slice(0, 6);
  }, [donors, query]);

  const choose = (d: { id: string; label: string }) => {
    onQuery(d.label);
    onPick(d);
    setOpen(false);
  };

  const exactMatch = matches.some((m) => m.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <Input
        value={query}
        placeholder="Type donor name…"
        className="mt-1.5 h-10 pl-8"
        onChange={(e) => {
          onQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && matches.length > 0) {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp" && matches.length > 0) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches.length > 0) {
              e.preventDefault();
              choose(matches[Math.min(active, matches.length - 1)]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[#EDE4D8] bg-[#FFFBF5] py-1 shadow-xl">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(m);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                i === active ? "bg-[#FDF2E9] text-[#C67B5C]" : "text-stone-700 hover:bg-[#FDF2E9]/60"
              }`}
            >
              <span className="truncate">{m.label}</span>
              {i === active && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
          <div className="border-t border-[#F5F0E8] px-3 py-1.5 text-[11px] text-[#C4A77D]">
            {query.trim() && !exactMatch
              ? `"${query.trim()}" isn't on file yet — it'll be saved as a new name`
              : "↑/↓ to move · Enter to pick"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bulk quick-entry card: many online gifts on one screen, one-click save. */
function QuickOnlineEntry({
  donors,
  onSaved,
}: {
  donors: { id: string; label: string }[];
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<QuickRow[]>([{ key: 1, query: "", donorId: "", date: today, amount: "" }]);
  const [date, setDate] = useState(today);
  const [giftType, setGiftType] = useState("offering");
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(2);

  const addRow = () =>
    setRows((r) => [...r, { key: nextKey.current++, query: "", donorId: "", date, amount: "" }]);
  const removeRow = (key: number) =>
    setRows((r) => (r.length === 1 ? r : r.filter((x) => x.key !== key)));
  const updateRow = (key: number, patch: Partial<Omit<QuickRow, "key">>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const valid = rows.filter((r) => Number(r.amount) > 0);
  const total = valid.reduce((s, r) => s + Number(r.amount), 0);

  const submit = async () => {
    if (valid.length === 0) {
      toast("Enter at least one amount first", "error");
      return;
    }
    const noDate = valid.find((r) => !r.date);
    if (noDate) {
      toast("Every gift needs a date — fill the row that's missing one", "error");
      return;
    }
    setSaving(true);
    let saved = 0;
    let failed = 0;
    if (supabase) {
      await Promise.all(
        valid.map(async (r) => {
          const { error } = await supabase.rpc("submit_donation", {
            p_donor_name: r.query.trim() || "Anonymous",
            p_amount: Number(r.amount),
            p_donation_type: giftType,
            p_payment_method: "online",
            p_check_number: null,
            p_donation_date: r.date || date,
            p_notes: null,
            p_donor_id: r.donorId || null,
          });
          if (error) failed++;
          else saved++;
        }),
      );
    } else {
      saved = valid.length;
    }
    setSaving(false);
    if (failed === 0) {
      toast(`Saved ${saved} online gift${saved === 1 ? "" : "s"} • ${formatCurrency(total)}`, "success");
      onSaved();
      setRows([{ key: nextKey.current++, query: "", donorId: "", date: today, amount: "" }]);
    } else {
      toast(`${saved} saved, ${failed} failed — please check and retry`, "error");
    }
  };

  return (
    <Card className="mb-6 overflow-visible border-indigo-100 bg-gradient-to-br from-[#FFFBF5] via-[#FDFBFF] to-[#F5F3FF]">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Globe className="h-4 w-4 text-indigo-600" />
          <h2 className="font-serif text-lg font-semibold text-[#3C2A1E]">Quick online giving</h2>
          <Badge tone="indigo">Bulk entry</Badge>
        </div>
        <p className="text-sm text-[#78716C]">
          Online gifts arrive any day of the week — so every row carries its <strong>own date</strong>. Set the
          default below, type the donor's name, tap the suggestion, add the amount — then <strong>＋ Add row</strong>.
          One <strong>Save all</strong> writes every row (with its own date) to the ledger, Reports, and donor
          statements.
        </p>
      </CardHeader>
      <CardBody>
        {/* Shared settings */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Default date (new rows)</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5 w-44" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={giftType} onChange={(e) => setGiftType(e.target.value)} className="mt-1.5 w-36">
              <option value="tithe">Tithe</option>
              <option value="offering">Offering</option>
              <option value="building">Building fund</option>
              <option value="missions">Missions</option>
              <option value="other">Other</option>
            </Select>
          </div>
        </div>

        {/* Column headers (desktop) */}
        <div className="mt-4 hidden grid-cols-[minmax(0,1fr)_160px_150px_36px] gap-2 sm:grid">
          <Label>Donor — type to search</Label>
          <Label>Date</Label>
          <Label>Amount</Label>
          <span />
        </div>

        {/* Rows */}
        <div className="mt-2 space-y-2">
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_160px_150px_36px]"
            >
              <div className="relative">
                <Label className="sm:hidden">Donor {i + 1}</Label>
                <QuickDonorInput
                  query={r.query}
                  onQuery={(v) => updateRow(r.key, { query: v, donorId: "" })}
                  onPick={(d) => updateRow(r.key, { donorId: d.id })}
                  donors={donors}
                />
              </div>
              <div>
                <Label className="sm:hidden">Date {i + 1}</Label>
                <Input
                  type="date"
                  value={r.date}
                  onChange={(e) => updateRow(r.key, { date: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addRow();
                  }}
                  className="mt-1.5 h-10"
                />
              </div>
              <div>
                <Label className="sm:hidden">Amount {i + 1}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={r.amount}
                  onChange={(e) => updateRow(r.key, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addRow();
                  }}
                  className="mt-1.5 h-10"
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(r.key)}
                disabled={rows.length === 1}
                aria-label={`Remove row ${i + 1}`}
                className="flex h-10 w-9 items-center justify-center justify-self-end rounded-lg border border-[#EDE4D8] text-stone-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 sm:justify-self-start"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Footer: live total + actions */}
        <div className="mt-4 flex flex-col gap-3 border-t border-[#F5F0E8] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[#78716C]">
            {valid.length > 0 ? (
              <>
                <span className="font-medium text-stone-800">{valid.length}</span> gift{valid.length === 1 ? "" : "s"}
                {" · "}
                <span className="font-serif font-semibold text-stone-900">{formatCurrency(total)}</span>
              </>
            ) : (
              "No amounts entered yet"
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" iconLeft={<Plus className="h-4 w-4" />} onClick={addRow}>
              Add row
            </Button>
            <Button
              variant="solid"
              disabled={saving || valid.length === 0}
              onClick={submit}
              iconLeft={<Check className="h-4 w-4" />}
            >
              {saving ? "Saving…" : `Save all (${valid.length})`}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export default function Donations() {
  const navigate = useNavigate();
  const ctx = useOutletContext<{ profile: { id: string; role: string; is_counter?: boolean } | null; isCounter: boolean }>();
  const isAdmin = isAdminRole(ctx.profile?.role);
  // Counters verify and sign off, but the ledger pages are admin-only —
  // counters are otherwise regular members who only see their own records.
  // The pastor sees the ledger read-only (no entry forms).
  const canAccess = isOversightRole(ctx.profile?.role);

  const [donations, setDonations] = useState<Donation[]>(sampleDonations);
  const [donors, setDonors] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // New donation dialog
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    donor_id: "",
    donor_name: "",
    amount: "",
    donation_type: "tithe",
    payment_method: "check",
    check_number: "",
    donation_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setDonors(sampleDonorsForPick);
      setLoading(false);
      return;
    }
    // Donor directory drives the quick-entry autocomplete — load it on its
    // own so one failing query never blocks the other.
    void (async () => {
      const { data } = await supabase
        .from("donors")
        .select("id, first_name, last_name")
        .eq("is_active", true)
        .order("last_name");
      if (data)
        setDonors(
          (data as Pick<Donor, "id" | "first_name" | "last_name">[]).map((d) => ({
            id: d.id,
            label: `${d.first_name} ${d.last_name}`,
          })),
        );
    })().catch(() => {});
    void (async () => {
      const { data, error } = await supabase.rpc("list_donations");
      if (!error && data) setDonations(data as Donation[]);
    })().catch(() => {}).finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => {
    const distinct = new Set<string>();
    donations.forEach((d) => distinct.add(d.donation_date.slice(0, 4)));
    return Array.from(distinct).sort().reverse();
  }, [donations]);

  const filtered = useMemo(
    () =>
      donations.filter(
        (d) =>
          (filterType === "all" || d.donation_type === filterType) &&
          (filterYear === "all" || d.donation_date.startsWith(filterYear)) &&
          (!dateFrom || d.donation_date >= dateFrom) &&
          (!dateTo || d.donation_date <= dateTo),
      ),
    [donations, filterType, filterYear, dateFrom, dateTo],
  );

  const totalShown = filtered.reduce((s, d) => s + Number(d.amount || 0), 0);

  const handleCreate = async () => {
    setSaving(true);
    const value = Number(form.amount);
    if (!value || value <= 0) {
      setSaving(false);
      return;
    }
    const donor = donors.find((d) => d.id === form.donor_id);
    const baseRow: Donation = {
      id: `local-${Date.now()}`,
      donor_id: form.donor_id || null,
      donor_name: donor?.label ?? form.donor_name ?? "Anonymous",
      donor_email: null,
      amount: value,
      donation_type: form.donation_type as Donation["donation_type"],
      payment_method: form.payment_method as Donation["payment_method"],
      donation_date: form.donation_date,
      entered_by: "demo",
      check_number: form.check_number || null,
      notes: form.notes || null,
      created_at: new Date().toISOString(),
    };
    if (supabase) {
      const { data: donationId, error } = await supabase.rpc("submit_donation", {
        p_donor_name: baseRow.donor_name,
        p_amount: baseRow.amount,
        p_donation_type: baseRow.donation_type,
        p_payment_method: baseRow.payment_method,
        p_check_number: baseRow.check_number,
        p_donation_date: baseRow.donation_date,
        p_notes: baseRow.notes,
        p_donor_id: baseRow.donor_id,
      });
      if (!error && donationId) {
        // Fetch back the full record
        const { data: inserted } = await supabase
          .from("donations")
          .select()
          .eq("id", donationId)
          .maybeSingle();
        if (inserted) setDonations((rows) => [inserted as Donation, ...rows]);
      }
      if (error) console.warn("Insert donation failed:", error);
    } else {
      setDonations((rows) => [baseRow, ...rows]);
    }
    setSaving(false);
    setOpen(false);
    setForm({
      donor_id: "",
      donor_name: "",
      amount: "",
      donation_type: "tithe",
      payment_method: "check",
      check_number: "",
      donation_date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
  };

  const reloadDonations = () => {
    if (!supabase) return;
    supabase.rpc("list_donations").then(({ data, error }) => {
      if (!error && data) setDonations(data as Donation[]);
    });
  };

  const issueStatement = (donorName: string) => {
    const year = filterYear === "all" ? new Date().getFullYear() : Number(filterYear);
    const donorDonations = filtered.filter((d) => d.donor_name === donorName);
    const statement: AnnualStatement = {
      donor: {
        id: "demo",
        first_name: donorName.split(" ")[0] ?? donorName,
        last_name: donorName.split(" ").slice(1).join(" ") || "",
        email: null,
        phone: null,
        address: null,
        city: null,
        state: null,
        zip_code: null,
        is_family: false,
        family_members: [],
        notes: null,
        is_active: true,
        total_donations: donorDonations.reduce((s, d) => s + Number(d.amount), 0),
        last_donation_date: null,
        linked_user_id: null,
        created_by: null,
        created_at: new Date().toISOString(),
      },
      year,
      donations: donorDonations,
      total: donorDonations.reduce((s, d) => s + Number(d.amount), 0),
      churchName:
        (typeof window !== "undefined" && localStorage.getItem("church_name")) ||
        "Atlanta Little Flock Church",
    };
    downloadStatement(statement);
  };

  return (
    <div>
      {!canAccess && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-6 py-16 text-center">
          <Shield className="mb-3 h-10 w-10 text-amber-400" />
          <h2 className="font-serif text-xl font-semibold text-stone-800">Access restricted</h2>
          <p className="mt-2 max-w-md text-sm text-stone-500">
            The Donations section is only available to designated counters and admins.
            Contact your church administrator if you need access.
          </p>
        </div>
      )}
      {canAccess && (
      <>
      <PageHeader
        title="Donations"
        subtitle="Every gift, recorded faithfully. Issue annual tax statements in one click."
        badge={`${formatCurrency(totalShown)} (${filtered.length} on screen)`}
        actions={
          isAdmin && (
          <>
          <Button iconLeft={<Church className="h-4 w-4" />} variant="outline" onClick={() => navigate("/offerings")}>Record Sunday offering</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>New donation</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record a donation</DialogTitle>
                <DialogDescription>
                  Pick a donor from the directory or add a new walk-in name.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="col-span-2">
                  <Label htmlFor="donor">Donor</Label>
                  <Select
                    id="donor"
                    value={form.donor_id}
                    onChange={(e) => setForm({ ...form, donor_id: e.target.value })}
                    className="mt-1.5"
                  >
                    <option value="">— Select donor —</option>
                    {donors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label htmlFor="walkin">…or walk-in name</Label>
                  <Input
                    id="walkin"
                    placeholder="e.g. Anonymous"
                    value={form.donor_name}
                    onChange={(e) => setForm({ ...form, donor_name: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="amount">Amount (USD)</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="mt-1.5"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={form.donation_date}
                    onChange={(e) => setForm({ ...form, donation_date: e.target.value })}
                    className="mt-1.5"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="type">Type</Label>
                  <Select
                    id="type"
                    value={form.donation_type}
                    onChange={(e) => setForm({ ...form, donation_type: e.target.value })}
                    className="mt-1.5"
                  >
                    <option value="tithe">Tithe</option>
                    <option value="offering">Offering</option>
                    <option value="building">Building fund</option>
                    <option value="missions">Missions</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="method">Method</Label>
                  <Select
                    id="method"
                    value={form.payment_method}
                    onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="mt-1.5"
                  >
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="online">Online</option>
                    <option value="card">Card</option>
                  </Select>
                </div>
                {form.payment_method === "check" && (
                  <div className="col-span-2">
                    <Label htmlFor="check">Check number</Label>
                    <Input
                      id="check"
                      value={form.check_number}
                      onChange={(e) => setForm({ ...form, check_number: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                )}
                <div className="col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? "Saving…" : "Record gift"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </>
          )
        }
      />

      {isAdmin && <QuickOnlineEntry donors={donors} onSaved={reloadDonations} />}

      <Card className="mb-4">
        <CardHeader className="border-b border-stone-100">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-stone-400" />
            <span className="text-stone-500">Filters</span>
          </div>
        </CardHeader>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Type</Label>
            <Select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="mt-1.5 w-40"
            >
              <option value="all">All</option>
              <option value="tithe">Tithe</option>
              <option value="offering">Offering</option>
              <option value="building">Building</option>
              <option value="missions">Missions</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div>
            <Label>Year</Label>
            <Select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="mt-1.5 w-32"
            >
              <option value="all">All</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div className="h-6 w-px bg-stone-200" />
          <div>
            <Label className="text-xs text-stone-500">From</Label>
            <Input type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)} className="mt-1 h-9 w-40 text-sm" />
          </div>
          <div>
            <Label className="text-xs text-stone-500">To</Label>
            <Input type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)} className="mt-1 h-9 w-40 text-sm" />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</Button>
          )}
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<HandCoins className="h-6 w-6" />}
          title="No donations recorded"
          description="Click New donation to log the first gift."
        />
      ) : (
        <TableWrap className="min-w-[720px]">
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Donor</Th>
              <Th>Type</Th>
              <Th>Method</Th>
              <Th className="text-right">Amount</Th>
              <Th></Th>
            </Tr>
          </THead>
          <tbody>
            {filtered.map((d) => (
              <Tr key={d.id}>
                <Td className="whitespace-nowrap">{formatDate(d.donation_date)}</Td>
                <Td>
                  <div className="font-medium text-stone-900">{d.donor_name}</div>
                  {d.notes && <div className="text-xs text-stone-500">{d.notes}</div>}
                </Td>
                <Td>
                  <Badge tone="indigo">{d.donation_type}</Badge>
                </Td>
                <Td>
                  <span className="capitalize text-stone-600">{d.payment_method}</span>
                  {d.check_number && (
                    <span className="ml-1 text-xs text-stone-400">#{d.check_number}</span>
                  )}
                </Td>
                <Td className="text-right font-serif text-base font-semibold text-stone-900">
                  {formatCurrency(d.amount)}
                </Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => issueStatement(d.donor_name)}
                    iconLeft={<FileDown className="h-3.5 w-3.5" />}
                  >
                    Statement
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      </>
      )}
    </div>
  );
}
