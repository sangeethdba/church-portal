import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Plus, HandCoins, FileDown, Filter, Shield, Church } from "lucide-react";
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
} from "@/components/ui";
import { PageHeader } from "@/components/Layout";
import { supabase, isAdminRole } from "@/lib/supabase";
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

export default function Donations() {
  const navigate = useNavigate();
  const ctx = useOutletContext<{ profile: { id: string; role: string; is_counter?: boolean } | null; isCounter: boolean }>();
  const isAdmin = isAdminRole(ctx.profile?.role);
  // Counters verify and sign off, but the ledger pages are admin-only —
  // counters are otherwise regular members who only see their own records.
  const canAccess = isAdmin;

  const [donations, setDonations] = useState<Donation[]>(sampleDonations);
  const [donors, setDonors] = useState<{ id: string; label: string }[]>(sampleDonorsForPick);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("all");

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
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from("donations").select("*").order("donation_date", { ascending: false }),
      supabase.from("donors").select("id, first_name, last_name").eq("is_active", true),
    ]).then(([{ data: dData }, { data: ddData }]) => {
      if (dData) setDonations(dData as Donation[]);
      if (ddData)
        setDonors(
          (ddData as Pick<Donor, "id" | "first_name" | "last_name">[]).map((d) => ({
            id: d.id,
            label: `${d.first_name} ${d.last_name}`,
          })),
        );
      setLoading(false);
    });
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
          (filterYear === "all" || d.donation_date.startsWith(filterYear)),
      ),
    [donations, filterType, filterYear],
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
      const { data, error } = await supabase
        .from("donations")
        .insert({
          donor_id: baseRow.donor_id,
          donor_name: baseRow.donor_name,
          amount: baseRow.amount,
          donation_type: baseRow.donation_type,
          payment_method: baseRow.payment_method,
          check_number: baseRow.check_number,
          donation_date: baseRow.donation_date,
          notes: baseRow.notes,
        })
        .select()
        .maybeSingle();
      if (data) setDonations((rows) => [data as Donation, ...rows]);
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
        "Grace Community Church",
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
              <div className="grid grid-cols-2 gap-3">
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
        }
      />

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
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<HandCoins className="h-6 w-6" />}
          title="No donations recorded"
          description="Click New donation to log the first gift."
        />
      ) : (
        <TableWrap>
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
