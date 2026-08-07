import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Plus,
  Pencil,
  Search,
  Users as UsersIcon,
  Mail,
  Phone,
  MapPin,
  HandCoins,
  TrendingUp,
  UserCheck,
  Download,
  ChevronDown,
  BarChart3,
} from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
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
  Select,
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isAdminRole, isOversightRole } from "@/lib/supabase";
import type { Donor } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";
import { aggregateDonorStats, normName } from "@/lib/accounting";

const sampleDonors: Donor[] = [
  {
    id: "demo-d1",
    first_name: "Marcus",
    last_name: "Lin",
    email: "marcus.lin@example.com",
    phone: "(404) 555-0136",
    address: "12 Park Lane",
    city: "Atlanta",
    state: "GA",
    zip_code: "30303",
    is_family: false,
    family_members: [],
    notes: "Faithful monthly tither.",
    is_active: true,
    total_donations: 8400,
    last_donation_date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    linked_user_id: null,
    created_by: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-d2",
    first_name: "The Reyes",
    last_name: "Family",
    email: "reyes@example.com",
    phone: "(404) 555-0177",
    address: "88 Elm St",
    city: "Atlanta",
    state: "GA",
    zip_code: "30308",
    is_family: true,
    family_members: ["Marcus", "Eliana", "Sofia"],
    notes: null,
    is_active: true,
    total_donations: 12250,
    last_donation_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    linked_user_id: null,
    created_by: null,
    created_at: new Date().toISOString(),
  },
];

type DonationStatRow = {
  donor_id: string | null;
  donor_name: string;
  amount: number;
  donation_date: string;
};



export default function Donors() {
  const ctx = useOutletContext<{ profile: { id?: string; role?: string } | null }>();
  // The pastor can browse the directory read-only — no add/edit.
  const isAdmin = isAdminRole(ctx.profile?.role);
  const canAccess = isOversightRole(ctx.profile?.role);

  const [donors, setDonors] = useState<Donor[]>(sampleDonors);
  const [donations, setDonations] = useState<DonationStatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedDonor, setExpandedDonor] = useState<string | null>(null);
  const [donorMonthly, setDonorMonthly] = useState<{ month: string; amount: number; label: string }[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // new-donor dialog state
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    is_family: false,
    family_members: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  // edit-donor dialog state
  const [editing, setEditing] = useState<Donor | null>(null);
  const [editForm, setEditForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    is_family: false,
    family_members: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);



  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from("donors").select("*").order("last_name"),
      supabase
        .from("donations")
        .select("donor_id, donor_name, amount, donation_date")
        .not("amount", "is", null),
    ]).then(([donorsRes, donationsRes]) => {
      if (!donorsRes.error && donorsRes.data) setDonors(donorsRes.data as Donor[]);
      if (!donationsRes.error && donationsRes.data)
        setDonations(donationsRes.data as DonationStatRow[]);
      setLoading(false);
    });
  }, []);

  // Live giving stats computed from the donations table — the donors columns
  // (total_donations / last_donation_date) are never updated when a gift lands,
  // so we aggregate here by donor_id (with a name fallback for unlinked rows).
  const donorStats = useMemo(() => aggregateDonorStats(donations), [donations]);

  const statsFor = (d: Donor): { total: number; last: string | null } => {
    const full = normName(`${d.first_name} ${d.last_name}`);
    const st =
      donorStats.byId.get(d.id) ??
      (full ? donorStats.byName.get(full) : undefined);
    return st ?? { total: Number(d.total_donations ?? 0), last: d.last_donation_date ?? null };
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return donors;
    const q = search.toLowerCase();
    return donors.filter(
      (d) =>
        `${d.first_name} ${d.last_name}`.toLowerCase().includes(q) ||
        (d.email ?? "").toLowerCase().includes(q) ||
        (d.phone ?? "").toLowerCase().includes(q),
    );
  }, [donors, search]);

  // Quick stats from live donation data
  const donorQuickStats = useMemo(() => {
    const totalGiving = donations.reduce((s, d) => s + Number(d.amount ?? 0), 0);
    const activeGivers = new Set(donations.filter((d) => Number(d.amount) > 0).map((d) => d.donor_id ?? d.donor_name)).size;
    return { totalGiving, activeGivers, totalDonors: donors.length };
  }, [donations, donors]);

  const handleCreate = async () => {
    setSaving(true);
    const fam = form.family_members
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (supabase) {
      // ── Check for duplicate donor first ──────────────────────────
      const { data: dupCheck } = await supabase
        .rpc("check_duplicate_donor", { p_first: form.first_name, p_last: form.last_name });

      if (dupCheck && !(dupCheck as any).ok) {
        alert((dupCheck as any).error || "A donor with this name already exists");
        setSaving(false);
        return;
      }

      const { data, error } = await supabase
        .from("donors")
        .insert({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email || null,
          phone: form.phone || null,
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip_code: form.zip_code || null,
          is_family: form.is_family,
          family_members: fam,
          notes: form.notes || null,
        })
        .select()
        .maybeSingle();
      if (data) setDonors((d) => [...d, data as Donor]);
      if (error) {
        const msg = error.message?.includes("duplicate") || error.message?.includes("unique")
          ? `A donor named "${form.first_name} ${form.last_name}" already exists`
          : (error.message || "Insert donor failed");
        console.warn("Insert donor failed:", error);
        alert(msg);
      }
    } else {
      setDonors((d) => [
        ...d,
        {
          id: `local-${Date.now()}`,
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email || null,
          phone: form.phone || null,
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip_code: form.zip_code || null,
          is_family: form.is_family,
          family_members: fam,
          notes: form.notes || null,
          is_active: true,
          total_donations: 0,
          last_donation_date: null,
          linked_user_id: null,
          created_by: null,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setSaving(false);
    setOpen(false);
    setForm({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zip_code: "",
      is_family: false,
      family_members: "",
      notes: "",
    });
  };

  const openEdit = (d: Donor) => {
    setEditing(d);
    setEditForm({
      first_name: d.first_name,
      last_name: d.last_name,
      email: d.email ?? "",
      phone: d.phone ?? "",
      address: d.address ?? "",
      city: d.city ?? "",
      state: d.state ?? "",
      zip_code: d.zip_code ?? "",
      is_family: d.is_family,
      family_members: (d.family_members ?? []).join(", "),
      notes: d.notes ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    const fam = editForm.family_members
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const patch = {
      first_name: editForm.first_name,
      last_name: editForm.last_name,
      email: editForm.email || null,
      phone: editForm.phone || null,
      address: editForm.address || null,
      city: editForm.city || null,
      state: editForm.state || null,
      zip_code: editForm.zip_code || null,
      is_family: editForm.is_family,
      family_members: fam,
      notes: editForm.notes || null,
    };
    if (supabase) {
      const { data, error } = await supabase
        .from("donors")
        .update(patch)
        .eq("id", editing.id)
        .select()
        .maybeSingle();
      if (data) {
        setDonors((ds) => ds.map((d) => (d.id === editing.id ? (data as Donor) : d)));
        setEditing(null);
      } else if (error) {
        console.warn("Update donor failed:", error);
      }
    } else {
      setDonors((ds) => ds.map((d) => (d.id === editing.id ? { ...d, ...patch } as Donor : d)));
      setEditing(null);
    }
    setSavingEdit(false);
  };



  const donorFields = (v: typeof editForm, set: (f: typeof editForm) => void, prefix: string) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${prefix}-first_name`}>First name</Label>
        <Input
          id={`${prefix}-first_name`}
          value={v.first_name}
          onChange={(e) => set({ ...v, first_name: e.target.value })}
          className="mt-1.5"
          required
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-last_name`}>Last name</Label>
        <Input
          id={`${prefix}-last_name`}
          value={v.last_name}
          onChange={(e) => set({ ...v, last_name: e.target.value })}
          className="mt-1.5"
          required
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor={`${prefix}-email`}>Email</Label>
        <Input
          id={`${prefix}-email`}
          type="email"
          value={v.email}
          onChange={(e) => set({ ...v, email: e.target.value })}
          className="mt-1.5"
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor={`${prefix}-phone`}>Phone</Label>
        <Input
          id={`${prefix}-phone`}
          value={v.phone}
          onChange={(e) => set({ ...v, phone: e.target.value })}
          className="mt-1.5"
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor={`${prefix}-address`}>Address</Label>
        <Input
          id={`${prefix}-address`}
          value={v.address}
          onChange={(e) => set({ ...v, address: e.target.value })}
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-city`}>City</Label>
        <Input
          id={`${prefix}-city`}
          value={v.city}
          onChange={(e) => set({ ...v, city: e.target.value })}
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-state`}>State</Label>
        <Input
          id={`${prefix}-state`}
          value={v.state}
          onChange={(e) => set({ ...v, state: e.target.value })}
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-zip`}>ZIP</Label>
        <Input
          id={`${prefix}-zip`}
          value={v.zip_code}
          onChange={(e) => set({ ...v, zip_code: e.target.value })}
          className="mt-1.5"
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-fam`}>Family?</Label>
        <div className="mt-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={v.is_family}
              onChange={(e) => set({ ...v, is_family: e.target.checked })}
              className="h-4 w-4 rounded border-stone-300"
            />
            This is a family account
          </label>
        </div>
      </div>
      {v.is_family && (
        <div className="col-span-2">
          <Label htmlFor={`${prefix}-members`}>Family members (comma-separated)</Label>
          <Input
            id={`${prefix}-members`}
            placeholder="Marcus, Eliana, Sofia"
            value={v.family_members}
            onChange={(e) => set({ ...v, family_members: e.target.value })}
            className="mt-1.5"
          />
        </div>
      )}
      <div className="col-span-2">
        <Label htmlFor={`${prefix}-notes`}>Notes</Label>
        <Input
          id={`${prefix}-notes`}
          value={v.notes}
          onChange={(e) => set({ ...v, notes: e.target.value })}
          className="mt-1.5"
        />
      </div>
    </div>
  );

  // Expand a donor row to show their 12-month giving trend
  const toggleExpand = async (donor: Donor) => {
    if (expandedDonor === donor.id) {
      setExpandedDonor(null);
      return;
    }
    setExpandedDonor(donor.id);
    setChartLoading(true);
    const months: Record<string, number> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      // Use local-time formatting — toISOString() shifts to UTC and
      // causes off-by-one month labels in timezones east of UTC.
      months[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`] = 0;
    }
    const y0 = now.getFullYear();
    const m0 = now.getMonth() - 11;
    const startDate = new Date(y0, m0, 1);
    const yearStart = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;
    if (supabase) {
      const fullName = `${donor.first_name} ${donor.last_name}`.trim();
      const [res1, res2] = await Promise.all([
        supabase
          .from("donations")
          .select("amount, donation_date")
          .eq("donor_id", donor.id)
          .gte("donation_date", yearStart),
        supabase
          .from("donations")
          .select("amount, donation_date")
          .is("donor_id", null)
          .ilike("donor_name", `%${fullName.replace(/'/g, "''")}%`)
          .gte("donation_date", yearStart),
      ]);
      const allRows = [
        ...(res1.data ?? []),
        ...(res2.data ?? []),
      ] as { amount: number; donation_date: string }[];
      allRows.forEach((d) => {
        const key = d.donation_date.slice(0, 7);
        if (months[key] !== undefined) months[key] += Number(d.amount ?? 0);
      });
    }
    setDonorMonthly(
      Object.entries(months).map(([month, amt]) => ({
        month,
        amount: amt,
        label: new Date(parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7)) - 1, 1).toLocaleDateString("en-US", { month: "short" }),
      })),
    );
    setChartLoading(false);
  };

  const exportCsv = () => {
    const headers = ["First Name","Last Name","Email","Phone","Address","City","State","ZIP","Type","Total Given","Last Gift","Notes"];
    const rows = filtered.map((d) => {
      const st = statsFor(d);
      return [
        d.first_name, d.last_name, d.email ?? "", d.phone ?? "",
        d.address ?? "", d.city ?? "", d.state ?? "", d.zip_code ?? "",
        d.is_family ? "Family" : "Individual",
        st.total.toString(), st.last ?? "", (d.notes ?? "").replace(/"/g, '""'),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    });
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `donors-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      {!canAccess && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-6 py-16 text-center">
          <UsersIcon className="mb-3 h-10 w-10 text-amber-400" />
          <h2 className="font-serif text-xl font-semibold text-stone-800">Access restricted</h2>
          <p className="mt-2 max-w-md text-sm text-stone-500">
            The donor directory is managed by the church finance team.
            Your own giving record is available under My giving &amp; bills.
          </p>
        </div>
      )}
      {canAccess && (
      <>
      <PageHeader
        title="Donor directory"
        subtitle="The people who faithfully support your ministry. Totals are live from recorded giving."
        badge={`${donors.length} on file`}
        actions={
          isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Add donor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New donor</DialogTitle>
                <DialogDescription>
                  Add an individual or a family account. Family members are tracked as a comma-separated list.
                </DialogDescription>
              </DialogHeader>
              {donorFields(form, setForm, "new")}
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? "Saving…" : "Save donor"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          )
        }
      />

      {/* Quick stats cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <UsersIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Donors</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{donorQuickStats.totalDonors}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Active givers</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{donorQuickStats.activeGivers}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">Total given</div>
              <div className="font-serif text-xl font-semibold text-stone-900">{formatCurrency(donorQuickStats.totalGiving)}</div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4">
        <CardBody className="flex items-center gap-3">
          <Search className="h-4 w-4 text-stone-400" />
          <Input
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 shadow-none focus-visible:ring-0"
          />
          <Button variant="outline" size="sm" onClick={exportCsv} iconLeft={<Download className="h-4 w-4" />}>
            CSV
          </Button>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-6 w-6" />}
          title="No donors match"
          description={
            donors.length === 0
              ? "Add your first donor to begin tracking giving."
              : "Try a different search term."
          }
        />
      ) : (
        <TableWrap className="min-w-[640px]">
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>Type</Th>
              <Th>Last gift</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Actions</Th>
            </Tr>
          </THead>
          <tbody>
            {filtered.map((d) => {
              const st = statsFor(d);
              const isExpanded = expandedDonor === d.id;
              return (
                <>
                <Tr key={d.id} className={isExpanded ? "bg-indigo-50/30" : ""}>
                  <Td>
                    <div className="font-medium text-stone-900">
                      {d.first_name} {d.last_name}
                    </div>
                    {d.is_family && d.family_members.length > 0 && (
                      <div className="text-xs text-stone-500">
                        + {d.family_members.join(", ")}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-col text-xs text-stone-600">
                      {d.email && (
                        <span className="flex items-center gap-1.5">
                          <Mail className="h-3 w-3" /> {d.email}
                        </span>
                      )}
                      {d.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3" /> {d.phone}
                        </span>
                      )}
                      {(d.address || d.city) && (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3" />
                          {[d.address, [d.city, d.state, d.zip_code].filter(Boolean).join(" ")]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={d.is_family ? "indigo" : "neutral"}>
                      {d.is_family ? "Family" : "Individual"}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-stone-600">
                    {st.last ? formatDate(st.last) : "—"}
                  </Td>
                  <Td className="text-right font-serif text-base font-semibold text-stone-900">
                    {formatCurrency(st.total)}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<ChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? "rotate-180" : ""}`} />}
                        onClick={() => toggleExpand(d)}
                      >
                        {isExpanded ? "Hide" : "Trend"}
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          iconLeft={<Pencil className="h-3.5 w-3.5" />}
                          onClick={() => openEdit(d)}
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
                {isExpanded && (
                  <tr key={`${d.id}-chart`}>
                    <td colSpan={6} className="bg-indigo-50/20 px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-stone-500 mb-2">
                        <BarChart3 className="h-3.5 w-3.5" />
                        12-month giving trend
                        {chartLoading && <span className="text-stone-400"> · loading…</span>}
                      </div>
                      {donorMonthly.some((m) => m.amount > 0) ? (
                        <DonorBarChart data={donorMonthly} />
                      ) : (
                        <p className="text-xs text-stone-400 py-4">No gifts recorded in the past 12 months.</p>
                      )}
                    </td>
                  </tr>
                )}
                </>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      {/* Edit donor dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit donor</DialogTitle>
            <DialogDescription>
              Update contact and personal details for{" "}
              {editing ? `${editing.first_name} ${editing.last_name}` : "this donor"}.
            </DialogDescription>
          </DialogHeader>
          {donorFields(editForm, setEditForm, "edit")}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      </>
      )}
    </div>
  );
}

/* ── Donor monthly giving bar chart (inline SVG) ──────────────────── */
function DonorBarChart({ data }: { data: { month: string; amount: number; label: string }[] }) {
  const maxVal = Math.max(...data.map((d) => d.amount), 1);
  const h = 100;
  const w = Math.max(data.length * 38, 280);
  const pad = { top: 8, right: 8, bottom: 26, left: 8 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const barW = Math.min((chartW / data.length) * 0.7, 20);
  const gap = chartW / data.length;

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Donor giving trend" className="mx-auto">
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
              <rect x={x} y={y} width={barW} height={Math.max(barH, d.amount > 0 ? 2 : 0)} rx={3} fill={d.amount > 0 ? "#6366F1" : "#e7e5e4"} opacity={d.amount > 0 ? 0.85 : 0.4} />
              {showLabel && <text x={x + barW / 2} y={h - pad.bottom + 13} textAnchor="middle" style={{ fontSize: 9 }} fill="#78716c">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
