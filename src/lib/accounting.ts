// Pure accounting helpers shared by the pages and covered by unit tests.
// Keeping this logic outside the React components makes the church's math
// (donor totals, weekly offering buckets, cash-by-denomination) testable.

/** Normalize a typed name so the same person typed differently is one identity. */
export function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Human-readable label for a donation type. Book room sales are a separate
 * income source, not a charitable gift, so they get their own friendly label.
 */
export function donationTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  if (type === "book_room") return "Book room";
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}

/**
 * True when a donation counts as charitable member giving. Book room sales
 * (books/bibles/calendars purchased from the church) are NOT charitable
 * contributions and must be excluded from donor totals, tax statements,
 * and member giving — they show only as church income.
 */
export function isCharitableGift(type: string | null | undefined): boolean {
  return type !== "book_room";
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

export interface MethodDisplayRow {
  label: string;
  amount: number;
  /** Indented derivation line under a group (gross plate, pastor gift…). */
  indent?: boolean;
  /** Headline group/line — rendered bold. */
  bold?: boolean;
  /** Negative money (deduction) — rendered in red. */
  neg?: boolean;
}

/**
 * Human-friendly "By method" presentation. Cash is grouped so the headline
 * number is the NET deposited figure, with indented lines showing how it's
 * derived (gross plate → pastor-gift deduction → named envelope gifts).
 * Checks and online giving keep their own rows. The rows always add up to
 * the same total income as the flat `buildIncomeByMethod` view.
 */
export function buildIncomeMethodDisplay(
  offerings: OfferingLike[],
  standaloneDonations: DonationLike[],
): MethodDisplayRow[] {
  const m = new Map(buildIncomeByMethod(offerings, standaloneDonations).map((r) => [r.method, r.amount]));
  const plateGross = m.get("cash (anonymous)") ?? 0;
  const pastor = m.get("pastor gifts") ?? 0; // stored negative
  const named = m.get("cash (named)") ?? 0;
  const check = m.get("check") ?? 0;
  const online = m.get("online") ?? 0;
  const other = m.get("other") ?? 0;
  const rows: MethodDisplayRow[] = [];
  const hasPlate = plateGross !== 0 || pastor !== 0;
  if (hasPlate || named !== 0) {
    const netCash = plateGross + pastor + named;
    if (hasPlate) {
      rows.push({ label: "Cash received (net)", amount: netCash, bold: true });
      if (plateGross !== 0) rows.push({ label: "Plate cash (gross)", amount: plateGross, indent: true });
      if (pastor !== 0) rows.push({ label: "Pastor gift — deducted before deposit", amount: pastor, indent: true, neg: true });
      if (named !== 0) rows.push({ label: "Named envelope gifts", amount: named, indent: true });
    } else {
      rows.push({ label: "Cash (named gifts)", amount: named, bold: true });
    }
  }
  if (check !== 0) rows.push({ label: "Checks", amount: check });
  if (online !== 0) rows.push({ label: "Online giving", amount: online });
  if (other !== 0) rows.push({ label: "Other", amount: other });
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual Sunday-ledger text import
// ─────────────────────────────────────────────────────────────────────────────
// The church's paper offering ledger has one sheet per service: a date at the
// top, one line per check (name + amount, often with a check number column),
// cash breakdown lines like "100 x 1", then CASH / CHECKS / TOTAL subtotals
// and the two counters' signatures. `parseLedgerText` turns a pasted sheet
// into the same shape the AI ledger scan produces, so both flows can pre-fill
// the Record-offering form identically.

const LEDGER_DENOM_VALUES = [100, 50, 20, 10, 5, 2, 1];

/** One named donation row parsed from a pasted ledger line. */
export interface ParsedLedgerRow {
  donorName: string;
  checkNumber: string;
  amount: number;
}

/** Result of parsing one pasted weekly ledger sheet. */
export interface ParsedLedger {
  /** Service date as YYYY-MM-DD, or "" when the sheet had no readable date. */
  serviceDate: string;
  serviceName: string;
  /** Cash counts by denomination, e.g. { 100: 1, 20: 32 }. */
  denominations: Record<number, number>;
  /** Named rows with a check number → recorded as checks. */
  checks: ParsedLedgerRow[];
  /** Named rows without a check number → recorded as named cash gifts. */
  cashGifts: ParsedLedgerRow[];
  deductions: { reason: string; amount: number }[];
  /** Stated on the sheet (CASH … / CHECKS … / TOTAL …), for cross-checking. */
  statedCash: number | null;
  statedChecks: number | null;
  statedTotal: number | null;
  /** Human-readable problems found while parsing (totals that don't match…). */
  warnings: string[];
}

const LEDGER_SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

const LEDGER_NUMBER_WORD =
  /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)/i;

/**
 * Parse one pasted Sunday-offering ledger sheet into offering-form fields.
 * Handles the paper sheet's format: a date line, name + amount check rows
 * (with optional check-number column), denomination lines like "100 x 1",
 * CASH / CHECKS / TOTAL subtotals, and number-word totals. Totals stated on
 * the sheet are compared against the parsed rows and mismatches become
 * warnings, so nothing is saved blind.
 */
export function parseLedgerText(raw: string): ParsedLedger {
  // Normalize superscript digits (from OCR) and "120 . 00" style spacing.
  const text = raw
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => LEDGER_SUPERSCRIPT[c] ?? c)
    .replace(/(\d)\s*\.\s*(\d{2})/g, "$1.$2");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const result: ParsedLedger = {
    serviceDate: "",
    serviceName: "Sunday Service",
    denominations: {},
    checks: [],
    cashGifts: [],
    deductions: [],
    statedCash: null,
    statedChecks: null,
    statedTotal: null,
    warnings: [],
  };
  const datesSeen: string[] = [];

  const moneyAtEnd = (line: string): number | null => {
    const m = line.match(/\$?([\d,]+(?:\.\d{2})?)\s*$/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ""));
    return Number.isFinite(v) ? v : null;
  };

  for (const line of lines) {
    // ── 1. Date line: "4/19/2026" or "2026-04-19" ──────────────────────
    const d1 = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    const d2 = line.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (d1) {
      const mon = parseInt(d1[1]);
      const day = parseInt(d1[2]);
      let yr = parseInt(d1[3]);
      if (yr < 100) yr += 2000;
      const iso = `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
        datesSeen.push(iso);
        if (!result.serviceDate) result.serviceDate = iso;
      }
      continue;
    }
    if (d2) {
      datesSeen.push(d2[0]);
      if (!result.serviceDate) result.serviceDate = d2[0];
      continue;
    }

    // ── 2. Signature lines carry a date next to the name ("S. Thent 4/19/2026") ──
    if (/[a-zA-Z]/.test(line) && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) continue;

    // ── 3. Denomination lines: "100 x 1", "20 × 32", "$100: 3", "100s = 2" ──
    const dm = line.match(/(\d{1,3})\s*[x×*]\s*(\d+)/);
    if (dm) {
      const denom = parseInt(dm[1]);
      const count = parseInt(dm[2]);
      if (LEDGER_DENOM_VALUES.includes(denom) && count > 0 && count < 10000) {
        result.denominations[denom] = count;
      }
      continue;
    }

    const upper = line.toUpperCase();
    const endMoney = moneyAtEnd(line);

    // ── 4. Stated subtotals: CASH / CHECKS / TOTAL ───────────────────────
    if (/^CASH\b/.test(upper)) {
      if (endMoney != null) result.statedCash = endMoney;
      continue;
    }
    if (/^CHECKS?\b/.test(upper)) {
      if (endMoney != null) result.statedChecks = endMoney;
      continue;
    }
    if (/^(TOTAL|GRAND)/.test(upper)) {
      if (endMoney != null) result.statedTotal = endMoney;
      continue;
    }

    // ── 5. Number-word total lines: "Four Thousand Three Hundred and …" ──
    if (LEDGER_NUMBER_WORD.test(line)) {
      if (endMoney != null && result.statedTotal == null) result.statedTotal = endMoney;
      continue;
    }

    // ── 6. Named donation rows: name (+ optional check number) + amount ──
    const nums = [...line.matchAll(/\$?([\d,]+(?:\.\d{2})?)/g)];
    let amount = 0;
    let amountIdx = -1;
    for (let i = nums.length - 1; i >= 0; i--) {
      const v = parseFloat(nums[i][1].replace(/,/g, ""));
      if (v > 0.5 && v <= 50000) {
        amount = v;
        amountIdx = i;
        break;
      }
    }
    if (amountIdx < 0) continue;

    const amIdx = nums[amountIdx].index ?? line.length;
    let namePart = line.slice(0, amIdx).replace(/checks?\s*\$?/i, "").trim();

    // Optional leading check number: "559 Sangeeth Talluri 100.00" or
    // "2105-2917 John Seeli … 120.00" (range) → keep as the check number.
    let checkNumber = "";
    const cn = namePart.match(/^(\d{3,6}(?:-\d{3,6})?)\s*/);
    if (cn) {
      checkNumber = cn[1];
      namePart = namePart.slice(cn[0].length).trim();
    }

    const donorName = namePart
      .replace(/[\d,.:;()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[^a-zA-Z]+/, "")
      .replace(/[^a-zA-Z]+$/, "");

    if (donorName.length < 2) continue;

    // On the paper sheet every named row lives in the checks section — the
    // check-number column is just optional (some weeks it's blank). So every
    // named row becomes a check; named cash envelopes aren't part of this
    // format and can be added in the form review.
    result.checks.push({ donorName, checkNumber, amount });
  }

  // ── Cross-check parsed totals against the stated ones ─────────────────
  const parsedCash = Object.entries(result.denominations).reduce((s, [d, c]) => s + Number(d) * (Number(c) || 0), 0);
  const parsedChecks = result.checks.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const parsedNamedCash = result.cashGifts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const parsedTotal = parsedCash + parsedChecks + parsedNamedCash;

  if (result.statedCash != null && Math.abs(result.statedCash - parsedCash) > 0.009) {
    result.warnings.push(`Cash total on sheet ($${result.statedCash.toFixed(2)}) doesn't match the denomination lines ($${parsedCash.toFixed(2)}).`);
  }
  if (result.statedChecks != null && Math.abs(result.statedChecks - parsedChecks) > 0.009) {
    result.warnings.push(`Checks total on sheet ($${result.statedChecks.toFixed(2)}) doesn't match the check rows ($${parsedChecks.toFixed(2)}).`);
  }
  if (result.statedTotal != null && Math.abs(result.statedTotal - parsedTotal) > 0.009) {
    result.warnings.push(`Grand total on sheet ($${result.statedTotal.toFixed(2)}) doesn't match cash + checks ($${parsedTotal.toFixed(2)}).`);
  }

  if (datesSeen.length > 1) {
    result.warnings.push(`Found ${datesSeen.length} dates (${datesSeen.join(", ")}) — paste one week at a time; using ${result.serviceDate}.`);
  }

  return result;
}
