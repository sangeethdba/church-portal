import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Users as UsersIcon,
  Mail,
  Phone,
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
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase } from "@/lib/supabase";
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

export default function Donors() {
  const [donors, setDonors] = useState<Donor[]>(sampleDonors);
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

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from("donors")
      .select("*")
      .order("last_name")
      .then(({ data, error }) => {
        if (!error && data) setDonors(data as Donor[]);
        setLoading(false);
      });
  }, []);

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

  return (
    <div>
      <PageHeader
        title="Donor directory"
        subtitle="The people who faithfully support your ministry. Click any donor to see their annual giving."
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="first_name">First name</Label>
                  <Input
                    id="first_name"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="mt-1.5"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="last_name">Last name</Label>
                  <Input
                    id="last_name"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="mt-1.5"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="zip">ZIP</Label>
                  <Input
                    id="zip"
                    value={form.zip_code}
                    onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="fam">Family?</Label>
                  <div className="mt-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.is_family}
                        onChange={(e) => setForm({ ...form, is_family: e.target.checked })}
                        className="h-4 w-4 rounded border-stone-300"
                      />
                      This is a family account
                    </label>
                  </div>
                </div>
                {form.is_family && (
                  <div className="col-span-2">
                    <Label htmlFor="members">Family members (comma-separated)</Label>
                    <Input
                      id="members"
                      placeholder="Marcus, Eliana, Sofia"
                      value={form.family_members}
                      onChange={(e) => setForm({ ...form, family_members: e.target.value })}
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
            </Tr>
          </THead>
          <tbody>
            {filtered.map((d) => (
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
                  </div>
                </Td>
                <Td>
                  <Badge tone={d.is_family ? "indigo" : "neutral"}>
                    {d.is_family ? "Family" : "Individual"}
                  </Badge>
                </Td>
                <Td className="text-xs text-stone-600">
                  {d.last_donation_date ? formatDate(d.last_donation_date) : "—"}
                </Td>
                <Td className="text-right font-serif text-base font-semibold text-stone-900">
                  {formatCurrency(d.total_donations)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
