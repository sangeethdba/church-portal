// Pure accounting helpers shared by the pages and covered by unit tests.
// Keeping this logic outside the React components makes the church's math
// (donor totals, weekly offering buckets, cash-by-denomination) testable.

/** Normalize a typed name so the same person typed differently is one identity. */
export function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Sum cash from denomination counts: { 100: "2", 50: "0", 1: "5" } → 205. */
export function computeCashFromDenoms(dc: Record<number, string>): number {
  return Object.entries(dc).reduce(
    (s, [denom, cnt]) => s + Number(denom) * (Number(cnt) || 0),
    0,
  );
}

export interface DonationStatRow {
  donor_id: string | null;
  donor_name: string;
  amount: number;
  donation_date: string;
}

export interface DonorTotals {
  total: number;
  last: string | null;
}

/**
 * Aggregate donations per donor — matched by donor_id first, with a normalized
 * name fallback for rows recorded before donor linkage (walk-ins). Anonymous
 * rows are ignored by name. This is the math behind the Donor directory's
 * "Total" and "Last gift" columns.
 */
export function aggregateDonorStats(
  rows: DonationStatRow[],
): { byId: Map<string, DonorTotals>; byName: Map<string, DonorTotals> } {
  const byId = new Map<string, DonorTotals>();
  const byName = new Map<string, DonorTotals>();
  for (const d of rows) {
    const amount = Number(d.amount ?? 0);
    if (d.donor_id) {
      const cur = byId.get(d.donor_id);
      if (cur) {
        cur.total += amount;
        if (d.donation_date > (cur.last ?? "")) cur.last = d.donation_date;
      } else {
        byId.set(d.donor_id, { total: amount, last: d.donation_date || null });
      }
    } else if (
      d.donor_name &&
      d.donor_name.trim() &&
      d.donor_name.trim().toLowerCase() !== "anonymous"
    ) {
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
}

export interface WeeklyBucket {
  cash: number;
  check: number;
  other: number;
}

export interface OfferingLike {
  service_date: string;
  cash_amount: number;
  check_amount: number;
}

export interface DonationLike {
  donation_date: string;
  payment_method: string;
  amount: number;
}

/**
 * Weekly (Sunday-start) cash/check/other buckets from weekly offering rows plus
 * standalone gifts. Offering checks are already inside the offering totals, so
 * standalone gifts must exclude offering-linked rows to avoid double counting.
 */
export function buildWeeklyBuckets(
  offerings: OfferingLike[],
  standaloneDonations: DonationLike[],
): Array<[string, WeeklyBucket]> {
  const weeks = new Map<string, WeeklyBucket>();
  const bump = (dateStr: string, cash: number, check: number, other: number) => {
    const date = new Date(dateStr);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const cur = weeks.get(key) ?? { cash: 0, check: 0, other: 0 };
    cur.cash += cash;
    cur.check += check;
    cur.other += other;
    weeks.set(key, cur);
  };
  for (const o of offerings) {
    bump(o.service_date, Number(o.cash_amount ?? 0), Number(o.check_amount ?? 0), 0);
  }
  for (const d of standaloneDonations) {
    const amt = Number(d.amount);
    if (d.payment_method === "cash") bump(d.donation_date, amt, 0, 0);
    else if (d.payment_method === "check") bump(d.donation_date, 0, amt, 0);
    else bump(d.donation_date, 0, 0, amt);
  }
  return Array.from(weeks.entries()).sort(([a], [b]) => a.localeCompare(b));
}
