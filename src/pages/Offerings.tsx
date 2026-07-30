import { useEffect, useMemo, useState } from "react";
import { Plus, Church, Banknote, ScrollText, Filter } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Textarea,
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
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Offering {
  id: string;
  service_date: string;
  service_name: string;
  cash_amount: number;
  check_amount: number;
  total_amount: number;
  check_count: number;
  recorded_by: string;
  notes: string | null;
  created_at: string;
}

const SAMPLE_OFFERINGS: Offering[] = [
  {
    id: "demo-o1",
    service_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    service_name: "Sunday Service",
    cash_amount: 342.5,
    check_amount: 1280,
    total_amount: 1622.5,
    check_count: 4,
    recorded_by: "demo",
    notes: "4 checks deposited",
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-o2",
    service_date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10),
    service_name: "Sunday Service",
    cash_amount: 275,
    check_amount: 950,
    total_amount: 1225,
    check_count: 3,
    recorded_by: "demo",
    notes: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-o3",
    service_date: new Date(Date.now() - 17 * 86400000).toISOString().slice(0, 10),
    service_name: "Christmas Eve",
    cash_amount: 610,
    check_amount: 2100,
    total_amount: 2710,
    check_count: 7,
    recorded_by: "demo",
    notes: "Special Christmas offering",
    created_at: new Date().toISOString(),
  },
];

export default function Offerings() {
  const [offerings, setOfferings] = useState<Offering[]>(SAMPLE_OFFERINGS);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterYear, setFilterYear] = useState<string>("all");

  const [form, setForm] = useState({
    service_date: new Date().toISOString().slice(0, 10),
    service_name: "Sunday Service",
    cash_amount: "",
    check_amount: "",
    check_count: "",
    notes: "",
  });

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from("offerings")
      .select("*")
      .order("service_date", { ascending: false })
      .then(({ data }) => {
        if (data) setOfferings(data as Offering[]);
        setLoading(false);
      });
  }, []);

  const years = useMemo(() => {
    const s = new Set<string>();
    offerings.forEach((o) => s.add(o.service_date.slice(0, 4)));
    return Array.from(s).sort().reverse();
  }, [offerings]);

  const filtered = useMemo(
    () =>
      filterYear === "all"
        ? offerings
        : offerings.filter((o) => o.service_date.startsWith(filterYear)),
    [offerings, filterYear],
  );

  const totals = filtered.reduce(
    (acc, o) => ({
      cash: acc.cash + Number(o.cash_amount),
      checks: acc.checks + Number(o.check_amount),
      grand: acc.grand + Number(o.total_amount),
    }),
    { cash: 0, checks: 0, grand: 0 },
  );

  const handleCreate = async () => {
    setSaving(true);
    const cash = Number(form.cash_amount) || 0;
    const checks = Number(form.check_amount) || 0;
    const count = Number(form.check_count) || 0;

    if (cash + checks <= 0) {
      setSaving(false);
      return;
    }

    const baseRow: Offering = {
      id: `local-${Date.now()}`,
      service_date: form.service_date,
      service_name: form.service_name,
      cash_amount: cash,
      check_amount: checks,
      total_amount: cash + checks,
      check_count: count,
      recorded_by: "demo",
      notes: form.notes || null,
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      const { data, error } = await supabase
        .from("offerings")
        .insert({
          service_date: form.service_date,
          service_name: form.service_name,
          cash_amount: cash,
          check_amount: checks,
          check_count: count,
          notes: form.notes || null,
        })
        .select()
        .maybeSingle();

      if (data) setOfferings((rows) => [data as Offering, ...rows]);
      if (error) console.warn("Insert offering failed:", error);
    } else {
      setOfferings((rows) => [baseRow, ...rows]);
    }

    setSaving(false);
    setOpen(false);
    setForm({
      service_date: new Date().toISOString().slice(0, 10),
      service_name: "Sunday Service",
      cash_amount: "",
      check_amount: "",
      check_count: "",
      notes: "",
    });
  };

  return (
    <div>
      <PageHeader
        title="Offerings"
        subtitle="Record weekly service collections — cash and checks from the offering plate."
        badge={`${filtered.length} services`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button iconLeft={<Plus className="h-4 w-4" />}>Record offering</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record a service offering</DialogTitle>
                <DialogDescription>
                  Enter the total cash and checks collected during this service.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="svc-date">Service date</Label>
                  <Input
                    id="svc-date"
                    type="date"
                    value={form.service_date}
                    onChange={(e) => setForm({ ...form, service_date: e.target.value })}
                    className="mt-1.5"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="svc-name">Service name</Label>
                  <Select
                    id="svc-name"
                    value={form.service_name}
                    onChange={(e) => setForm({ ...form, service_name: e.target.value })}
                    className="mt-1.5"
                  >
                    <option value="Sunday Service">Sunday Service</option>
                    <option value="Wednesday Bible Study">Wednesday Bible Study</option>
                    <option value="Christmas Eve">Christmas Eve</option>
                    <option value="Easter">Easter</option>
                    <option value="Special Event">Special Event</option>
                  </Select>
                </div>

                <div className="col-span-2 rounded-lg border border-stone-200 bg-parchment-50/60 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-stone-700">
                    <Banknote className="h-4 w-4 text-emerald-600" />
                    Cash collected
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="cash">Cash amount (USD)</Label>
                      <Input
                        id="cash"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={form.cash_amount}
                        onChange={(e) => setForm({ ...form, cash_amount: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                </div>

                <div className="col-span-2 rounded-lg border border-stone-200 bg-amber-50/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-stone-700">
                    <ScrollText className="h-4 w-4 text-amber-600" />
                    Checks collected
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="checks">Check amount (USD)</Label>
                      <Input
                        id="checks"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={form.check_amount}
                        onChange={(e) => setForm({ ...form, check_amount: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="check-count">Number of checks</Label>
                      <Input
                        id="check-count"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={form.check_count}
                        onChange={(e) => setForm({ ...form, check_count: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                </div>

                <div className="col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="mt-1.5"
                    placeholder="e.g. 3 checks held for deposit"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? "Saving…" : "Save offering"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Summary cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Total cash
              </div>
              <div className="font-serif text-xl font-semibold text-stone-900">
                {formatCurrency(totals.cash)}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Total checks
              </div>
              <div className="font-serif text-xl font-semibold text-stone-900">
                {formatCurrency(totals.checks)}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Church className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Grand total
              </div>
              <div className="font-serif text-xl font-semibold text-stone-900">
                {formatCurrency(totals.grand)}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Year filter */}
      <Card className="mb-4">
        <CardHeader className="border-b border-stone-100">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-stone-400" />
            <span className="text-stone-500">Filter by year</span>
          </div>
        </CardHeader>
        <CardBody>
          <Select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="w-36"
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Church className="h-6 w-6" />}
          title="No offerings recorded"
          description="Record your first service collection to start tracking weekly offerings."
        />
      ) : (
        <TableWrap>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Service</Th>
              <Th className="text-right">Cash</Th>
              <Th className="text-right">Checks</Th>
              <Th className="text-right">Total</Th>
              <Th>Notes</Th>
            </Tr>
          </THead>
          <tbody>
            {filtered.map((o) => (
              <Tr key={o.id}>
                <Td className="whitespace-nowrap font-medium">
                  {formatDate(o.service_date)}
                </Td>
                <Td>
                  <Badge tone="indigo">{o.service_name}</Badge>
                </Td>
                <Td className="text-right font-mono text-sm text-stone-700">
                  {formatCurrency(o.cash_amount)}
                </Td>
                <Td className="text-right font-mono text-sm text-stone-700">
                  <span>{formatCurrency(o.check_amount)}</span>
                  {o.check_count > 0 && (
                    <span className="ml-1 text-xs text-stone-400">
                      ({o.check_count} check{o.check_count === 1 ? "" : "s"})
                    </span>
                  )}
                </Td>
                <Td className="text-right font-serif text-base font-semibold text-stone-900">
                  {formatCurrency(o.total_amount)}
                </Td>
                <Td className="max-w-[200px] truncate text-sm text-stone-500">
                  {o.notes ?? "—"}
                </Td>
              </Tr>
            ))}
            <Tr>
              <Td colSpan={2} className="border-t-2 border-stone-200 py-4 text-right font-semibold">
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

      {!supabase && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Demo mode with sample data. Connect Supabase to persist offering records.
        </div>
      )}
    </div>
  );
}
