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
import { supabase, isAdminRole } from "@/lib/supabase";
import type { Donor } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

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

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export default function Donors() {
  const ctx = useOutletContext<{ profile: { id?: string; role?: string } | null }>();
  const canAccess = isAdminRole(ctx.profile?.role);

  const [donors, setDonors] = useState<Donor[]>(sampleDonors);
  const [donations, setDonations] = useState<DonationStatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  // record-donation dialog state (admin adds a gift for a member directly)
  const [recDonor, setRecDonor] = useState<Donor | null>(null);
  const [recForm, setRecForm] = useState({
    amount: "",
    donation_type: "tithe",
    payment_method: "check",
    check_number: "",
    donation_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [recSaving, setRecSaving] = useState(false);

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
  const donorStats = useMemo(() => {
    const byId = new Map<string, { total: number; last: string | null }>();
    const byName = new Map<string, { total: number; last: string | null }>();
    for (const d of donations) {
      const amount = Number(d.amount ?? 0);
      if (d.donor_id) {
        const cur = byId.get(d.donor_id);
        if (cur) {
          cur.total += amount;
          if (d.donation_date > (cur.last ?? "")) cur.last = d.donation_date;
        } else {
          byId.set(d.donor_id, { total: amount, last: d.donation_date || null });
        }
      } else if (d.donor_name && d.donor_name.trim() && d.donor_name.trim().toLowerCase() !== "anonymous") {
        const key = normName(d.donor_name);
        const cur = byName.get(key);
        if (cur) {
          cur.total += amount;
          if (d.donation_date > (cur.last ?? "")) cur.last = d.donation_date;
        } else {
          byName.set(key, { total: amount, last: d.donation_date || null });
        }
      }
    }
    return { byId, byName };
  }, [donations]);

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

  const handleCreate = async () => {
    setSaving(true);
    const fam = form.family_members
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (supabase) {
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
      if (error) console.warn("Insert donor failed:", error);
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

  const openRecordDonation = (d: Donor) => {
    setRecDonor(d);
    setRecForm({
      amount: "",
      donation_type: "tithe",
      payment_method: "check",
      check_number: "",
      donation_date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
  };

  const handleRecordDonation = async () => {
    if (!recDonor) return;
    const value = Number(recForm.amount);
    if (!value || value <= 0) return;
    setRecSaving(true);
    const row = {
      donor_id: recDonor.id,
      donor_name: `${recDonor.first_name} ${recDonor.last_name}`.trim(),
      amount: value,
      donation_type: recForm.donation_type,
      payment_method: recForm.payment_method,
      check_number: recForm.check_number || null,
      donation_date: recForm.donation_date,
      entered_by: ctx.profile?.id ?? null,
      notes: recForm.notes || null,
    };
    if (supabase) {
      const { data, error } = await supabase.from("donations").insert(row).select().maybeSingle();
      if (data) {
        setDonations((rows) => [
          ...rows,
          { donor_id: recDonor.id, donor_name: row.donor_name, amount: value, donation_date: recForm.donation_date },
        ]);
        setRecDonor(null);
      }
      if (error) console.warn("Insert donation failed:", error);
    }
    setRecSaving(false);
  };

  const donorFields = (v: typeof editForm, set: (f: typeof editForm) => void, prefix: string) => (
    <div className="grid grid-cols-2 gap-3">
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
        }
      />

      <Card className="mb-4">
        <CardBody className="flex items-center gap-3">
          <Search className="h-4 w-4 text-stone-400" />
          <Input
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 shadow-none focus-visible:ring-0"
          />
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
        <TableWrap>
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
              return (
                <Tr key={d.id}>
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
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        iconLeft={<HandCoins className="h-3.5 w-3.5" />}
                        onClick={() => openRecordDonation(d)}
                      >
                        Record donation
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        iconLeft={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => openEdit(d)}
                      >
                        Edit
                      </Button>
                    </div>
                  </Td>
                </Tr>
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

      {/* Record donation dialog */}
      <Dialog open={recDonor !== null} onOpenChange={(o) => !o && setRecDonor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a donation</DialogTitle>
            <DialogDescription>
              Add a gift for {recDonor ? `${recDonor.first_name} ${recDonor.last_name}` : "this member"}. It will appear on their giving record and tax statement.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rec-amount">Amount (USD)</Label>
              <Input id="rec-amount" type="number" min="0.01" step="0.01" value={recForm.amount}
                onChange={(e) => setRecForm({ ...recForm, amount: e.target.value })} className="mt-1.5" required />
            </div>
            <div>
              <Label htmlFor="rec-date">Date</Label>
              <Input id="rec-date" type="date" value={recForm.donation_date}
                onChange={(e) => setRecForm({ ...recForm, donation_date: e.target.value })} className="mt-1.5" required />
            </div>
            <div>
              <Label htmlFor="rec-type">Type</Label>
              <Select id="rec-type" value={recForm.donation_type}
                onChange={(e) => setRecForm({ ...recForm, donation_type: e.target.value })} className="mt-1.5">
                <option value="tithe">Tithe</option>
                <option value="offering">Offering</option>
                <option value="building">Building fund</option>
                <option value="missions">Missions</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rec-method">Method</Label>
              <Select id="rec-method" value={recForm.payment_method}
                onChange={(e) => setRecForm({ ...recForm, payment_method: e.target.value })} className="mt-1.5">
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="online">Online</option>
                <option value="card">Card</option>
              </Select>
            </div>
            {recForm.payment_method === "check" && (
              <div className="col-span-2">
                <Label htmlFor="rec-check">Check number</Label>
                <Input id="rec-check" value={recForm.check_number}
                  onChange={(e) => setRecForm({ ...recForm, check_number: e.target.value })} className="mt-1.5" />
              </div>
            )}
            <div className="col-span-2">
              <Label htmlFor="rec-notes">Notes</Label>
              <Input id="rec-notes" value={recForm.notes}
                onChange={(e) => setRecForm({ ...recForm, notes: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRecDonor(null)}>Cancel</Button>
            <Button onClick={handleRecordDonation} disabled={recSaving || !recForm.amount || Number(recForm.amount) <= 0}>
              {recSaving ? "Saving…" : "Record gift"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}
