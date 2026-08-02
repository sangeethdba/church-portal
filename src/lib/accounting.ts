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
  cash_net?: number;
  total_amount?: number;
  cash_deductions?: Array<{ reason?: string; amount?: number }> | null;
}

export interface DonationLike {
  donation_date: string;
  payment_method: string;
  amount: number;
}

/** Per-service-week ledger breakdown of a Sunday offering. */
export interface WeeklyLedgerDetail {
  /** Plate cash BEFORE pastor-gift deductions (gross) — anonymous. */
  anonymous: number;
  /** Envelope cash gifts (named) + standalone cash donations (also named). */
  named: number;
  checks: number;
  /** Pastor-gift / cash deductions taken out of the plate (negative). */
  pastor: number;
  /** Online gifts entered separately — kept apart from the Sunday offering. */
  online: number;
  /** Any other standalone method (card, etc.). */
  other: number;
}

/** Sunday-start week key (UTC) for a YYYY-MM-DD date. */
export function sundayWeekKey(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  const weekStart = new Date(date.getTime() - date.getUTCDay() * 86400000);
  return weekStart.toISOString().slice(0, 10);
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
    const key = sundayWeekKey(dateStr);
    const cur = weeks.get(key) ?? { cash: 0, check: 0, other: 0 };
    cur.cash += cash;
    cur.check += check;
    cur.other += other;
    weeks.set(key, cur);
  };
  for (const o of offerings) {
    // Legacy rows may only have cash_net (pre-0048); prefer cash_amount when set.
    const cash = Number(o.cash_amount || o.cash_net || 0);
    const check = Number(o.check_amount || 0);
    // Named cash gifts (envelopes) are recorded as donations linked to this
    // offering, not on the offering row itself — derive them from the total so
    // they show up as cash in the weekly trend instead of vanishing.
    const total = Number(o.total_amount || 0);
    const gifts = Math.max(0, total - cash - check);
    bump(o.service_date, cash + gifts, check, 0);
  }
  for (const d of standaloneDonations) {
    const amt = Number(d.amount);
    if (d.payment_method === "cash") bump(d.donation_date, amt, 0, 0);
    else if (d.payment_method === "check") bump(d.donation_date, 0, amt, 0);
    else bump(d.donation_date, 0, 0, amt);
  }
  return Array.from(weeks.entries()).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Per-service-week ledger detail: anonymous plate cash, named envelope cash,
 * checks, pastor-gift deductions, plus separately-entered online/other gifts.
 * Standalone online gifts stay in their own bucket so the Sunday offering is
 * never merged with online giving. Offering-linked donation rows must be
 * excluded from `standaloneDonations` to avoid double counting.
 */
export function buildWeeklyLedgerDetail(
  offerings: OfferingLike[],
  standaloneDonations: DonationLike[],
): Array<[string, WeeklyLedgerDetail]> {
  const weeks = new Map<string, WeeklyLedgerDetail>();
  const zero = (): WeeklyLedgerDetail => ({ anonymous: 0, named: 0, checks: 0, pastor: 0, online: 0, other: 0 });
  const bump = (dateStr: string, part: Partial<WeeklyLedgerDetail>) => {
    const key = sundayWeekKey(dateStr);
    const cur = weeks.get(key) ?? zero();
    cur.anonymous += part.anonymous ?? 0;
    cur.named += part.named ?? 0;
    cur.checks += part.checks ?? 0;
    cur.pastor += part.pastor ?? 0;
    cur.online += part.online ?? 0;
    cur.other += part.other ?? 0;
    weeks.set(key, cur);
  };
  for (const o of offerings) {
    const cash = Number(o.cash_net || o.cash_amount || 0);
    const checks = Number(o.check_amount || 0);
    const total = Number(o.total_amount || 0);
    // Named envelope gifts are the leftover between total and cash+checks.
    const named = Math.max(0, total - cash - checks);
    const pastor = (Array.isArray(o.cash_deductions) ? o.cash_deductions : [])
      .reduce((s, d) => s + (Number(d?.amount) || 0), 0);
    // Anonymous cash is the GROSS plate (before pastor-gift deductions); the
    // deduction is stored negative so the week reads like a true ledger line.
    bump(o.service_date, { anonymous: cash + pastor, named, checks, pastor: -pastor });
  }
  for (const d of standaloneDonations) {
    const amt = Number(d.amount) || 0;
    const method = (d.payment_method || "").toLowerCase();
    if (method === "cash") bump(d.donation_date, { named: amt });
    else if (method === "check") bump(d.donation_date, { checks: amt });
    else if (method === "online") bump(d.donation_date, { online: amt });
    else bump(d.donation_date, { other: amt });
  }
  return Array.from(weeks.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export interface MethodRow {
  method: string;
  amount: number;
}

/**
 * Income broken down by method — the "By method" report card. Mirrors the
 * weekly ledger so both views reconcile identically: anonymous plate cash is
 * GROSS (before pastor-gift deductions), the deduction appears as a negative
 * "pastor gifts" line, envelope gifts are named cash, checks and online gifts
 * keep their own lines. Sum of all rows always equals total income.
 */
export function buildIncomeByMethod(
  offerings: OfferingLike[],
  standaloneDonations: DonationLike[],
): MethodRow[] {
  const m = new Map<string, number>();
  const add = (key: string, value: number) => {
    if (value === 0) return;
    m.set(key, (m.get(key) ?? 0) + value);
  };
  for (const d of standaloneDonations) {
    const amt = Number(d.amount) || 0;
    const method = (d.payment_method || "").toLowerCase();
    if (method === "cash") add("cash (named)", amt);
    else if (method === "online") add("online", amt);
    else if (method === "check") add("check", amt);
    else add("other", amt);
  }
  for (const o of offerings) {
    const cash = Number(o.cash_net || o.cash_amount || 0);
    const checks = Number(o.check_amount || 0);
    const total = Number(o.total_amount || 0);
    const pastor = (Array.isArray(o.cash_deductions) ? o.cash_deductions : [])
      .reduce((s, d) => s + (Number(d?.amount) || 0), 0);
    // Envelope gifts are the leftover between total and cash+checks.
    const gifts = Math.max(0, total - cash - checks);
    add("cash (anonymous)", cash + pastor);
    if (pastor > 0) add("pastor gifts", -pastor);
    add("cash (named)", gifts);
    add("check", checks);
  }
  return Array.from(m.entries())
    .map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
}
