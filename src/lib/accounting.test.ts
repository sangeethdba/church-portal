import { describe, it, expect } from "vitest";
import {
  normName,
  computeCashFromDenoms,
  aggregateDonorStats,
  buildWeeklyBuckets,
  buildWeeklyLedgerDetail,
  buildIncomeByMethod,
  buildIncomeMethodDisplay,
  sundayWeekKey,
  donationTypeLabel,
  isCharitableGift,
  parseLedgerText,
} from "./accounting";
import { isAdminRole, normalizeLineItems, buildReceiptPath } from "./supabase";
import { formatCurrency, formatDate } from "./utils";

// ── donationTypeLabel / isCharitableGift ────────────────────────────────────
describe("donationTypeLabel", () => {
  it("labels book_room as Book room", () => {
    expect(donationTypeLabel("book_room")).toBe("Book room");
  });
  it("title-cases plain types", () => {
    expect(donationTypeLabel("tithe")).toBe("Tithe");
    expect(donationTypeLabel("offering")).toBe("Offering");
  });
  it("handles empty values", () => {
    expect(donationTypeLabel("")).toBe("—");
    expect(donationTypeLabel(null)).toBe("—");
    expect(donationTypeLabel(undefined)).toBe("—");
  });
});

describe("isCharitableGift", () => {
  it("treats book room sales as non-charitable", () => {
    expect(isCharitableGift("book_room")).toBe(false);
  });
  it("treats offerings and tithes as charitable", () => {
    expect(isCharitableGift("offering")).toBe(true);
    expect(isCharitableGift("tithe")).toBe(true);
  });
});

// ── normName ───────────────────────────────────────────────────────────────
describe("normName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normName("  John   Seeli ")).toBe("john seeli");
    expect(normName("JOHN SEELI")).toBe("john seeli");
    expect(normName("  sangeeth\t talluri ")).toBe("sangeeth talluri");
  });
});

// ── computeCashFromDenoms ─────────────────────────────────────────────────
describe("computeCashFromDenoms", () => {
  it("sums denomination × count", () => {
    expect(computeCashFromDenoms({ 100: "2", 50: "1", 20: "0", 1: "5" })).toBe(255);
  });
  it("treats empty/NaN counts as zero", () => {
    expect(computeCashFromDenoms({ 100: "", 50: "x", 20: "0" })).toBe(0);
    expect(computeCashFromDenoms({})).toBe(0);
  });
});

// ── aggregateDonorStats ───────────────────────────────────────────────────
describe("aggregateDonorStats", () => {
  it("rolls up totals per donor_id and tracks the latest date", () => {
    const { byId } = aggregateDonorStats([
      { donor_id: "a", donor_name: "John Seeli", amount: 20, donation_date: "2026-07-04" },
      { donor_id: "a", donor_name: "John Seeli", amount: 30, donation_date: "2026-07-11" },
      { donor_id: "b", donor_name: "Sunny Talluri", amount: 10, donation_date: "2026-07-04" },
    ]);
    expect(byId.get("a")).toEqual({ total: 50, last: "2026-07-11" });
    expect(byId.get("b")).toEqual({ total: 10, last: "2026-07-04" });
  });

  it("falls back to normalized name for rows without a donor_id (walk-ins)", () => {
    const { byName } = aggregateDonorStats([
      { donor_id: null, donor_name: "  John   Seeli ", amount: 40, donation_date: "2026-07-04" },
      { donor_id: null, donor_name: "john seeli", amount: 60, donation_date: "2026-07-11" },
    ]);
    expect(byName.get("john seeli")).toEqual({ total: 100, last: "2026-07-11" });
  });

  it("ignores anonymous and blank names", () => {
    const { byName } = aggregateDonorStats([
      { donor_id: null, donor_name: "Anonymous", amount: 99, donation_date: "2026-07-04" },
      { donor_id: null, donor_name: "  ", amount: 5, donation_date: "2026-07-04" },
    ]);
    expect(byName.size).toBe(0);
  });
});

// ── buildWeeklyBuckets ────────────────────────────────────────────────────
describe("buildWeeklyBuckets", () => {
  it("buckets offerings + standalone gifts by Sunday-start week", () => {
    // Fri Jul 10 2026 and Sun Jul 12 2026 both land in the Jul 12 week? No:
    // Sun-start means a Friday Jul 10 belongs to week starting Jul 5.
    const buckets = buildWeeklyBuckets(
      [
        { service_date: "2026-07-05", cash_amount: 200, check_amount: 2 }, // Sun
        { service_date: "2026-07-11", cash_amount: 541, check_amount: 60 }, // Sat (same week as 07-05)
      ],
      [
        { donation_date: "2026-07-12", payment_method: "cash", amount: 100 }, // next week
        { donation_date: "2026-07-05", payment_method: "check", amount: 50 }, // same week, standalone
        { donation_date: "2026-07-05", payment_method: "online", amount: 25 },
      ],
    );
    expect(buckets.length).toBe(2);
    const [week1, week2] = buckets;
    // Sun 07-05 week: 741 cash (541+200), 112 check (60+2+50), 25 other
    expect(week1[0]).toBe("2026-07-05");
    expect(week1[1]).toEqual({ cash: 741, check: 112, other: 25 });
    // Sun 07-12 week: 100 cash
    expect(week2[0]).toBe("2026-07-12");
    expect(week2[1]).toEqual({ cash: 100, check: 0, other: 0 });
  });

  it("falls back to cash_net for legacy rows (pre-0048) and folds named cash gifts into cash", () => {
    // Aug 01 2026 (Sat) — legacy row with only cash_net set, cash_amount = 0,
    // and $200 in named cash gifts hidden inside total_amount.
    const buckets = buildWeeklyBuckets(
      [
        {
          service_date: "2026-08-01",
          cash_amount: 0,
          cash_net: 224,
          check_amount: 200,
          total_amount: 624,
        },
      ],
      [],
    );
    expect(buckets).toEqual([["2026-07-26", { cash: 424, check: 200, other: 0 }]]);
  });

  it("handles empty input", () => {
    expect(buildWeeklyBuckets([], [])).toEqual([]);
  });
});

// ── buildWeeklyLedgerDetail ──────────────────────────────────────────────
describe("buildWeeklyLedgerDetail", () => {
  it("splits anonymous plate cash, named envelope gifts, checks, and pastor-gift deductions per week", () => {
    const buckets = buildWeeklyLedgerDetail(
      [
        {
          service_date: "2026-08-01", // Sat — same week as Sun Jul 26
          cash_amount: 0,
          cash_net: 224, // net after pastor gift
          check_amount: 200,
          total_amount: 624, // 224 net + 200 checks + 200 envelope gifts
          cash_deductions: [{ reason: "pastor gift", amount: 20 }],
        },
      ],
      [],
    );
    expect(buckets).toEqual([["2026-07-26", { anonymous: 244, named: 200, checks: 200, pastor: -20, online: 0, other: 0 }]]);
  });

  it("keeps online gifts separate from the Sunday offering and folds standalone cash into named", () => {
    const buckets = buildWeeklyLedgerDetail(
      [{ service_date: "2026-07-26", cash_amount: 100, check_amount: 50, total_amount: 150, cash_net: 100 }],
      [
        { donation_date: "2026-07-27", payment_method: "online", amount: 40 },
        { donation_date: "2026-07-28", payment_method: "cash", amount: 25 },
        { donation_date: "2026-07-29", payment_method: "card", amount: 10 },
      ],
    );
    expect(buckets).toEqual([["2026-07-26", { anonymous: 100, named: 25, checks: 50, pastor: 0, online: 40, other: 10 }]]);
  });
});

// ── sundayWeekKey ─────────────────────────────────────────────────────────
describe("sundayWeekKey", () => {
  it("returns the Sunday that starts a date's week, regardless of timezone", () => {
    expect(sundayWeekKey("2026-08-01")).toBe("2026-07-26"); // Sat
    expect(sundayWeekKey("2026-07-26")).toBe("2026-07-26"); // Sun
    expect(sundayWeekKey("2026-08-02")).toBe("2026-08-02"); // Sun
  });
});

// ── End-to-end data flow: a full year the way the Reports page computes it ─
describe("end-to-end: full-year data flow reconciles every report total", () => {
  // Two Sunday offerings:
  //  - Aug 2: $224 net plate ($244 gross − $20 pastor gift), $200 checks,
  //    $200 named envelope gifts → $624 deposited.
  //  - Sep 6: $300 plate (no deduction), $100 checks → $400 deposited.
  const offerings = [
    {
      service_date: "2026-08-02",
      cash_amount: 224,
      cash_net: 224,
      cash_deductions: [{ reason: "pastor gift", amount: 20 }],
      check_amount: 200,
      total_amount: 624,
    },
    {
      service_date: "2026-09-06",
      cash_amount: 300,
      cash_net: 300,
      cash_deductions: null,
      check_amount: 100,
      total_amount: 400,
    },
  ];

  // Offering-linked donations (envelopes + checks recorded via record_offering,
  // carrying offering_id) must never be counted as standalone gifts.
  const offeringLinked = [
    { donor_id: "d1", donor_name: "John Seeli", amount: 100, donation_date: "2026-08-02", payment_method: "check" },
    { donor_id: "d1", donor_name: "John Seeli", amount: 100, donation_date: "2026-08-02", payment_method: "check" },
    { donor_id: "d2", donor_name: "Sangeeth Talluri", amount: 100, donation_date: "2026-08-02", payment_method: "check" },
    { donor_id: "d1", donor_name: "John Seeli", amount: 100, donation_date: "2026-08-02", payment_method: "cash" },
    { donor_id: "d2", donor_name: "Sangeeth Talluri", amount: 100, donation_date: "2026-08-02", payment_method: "cash" },
  ].map((d) => ({ ...d, offering_id: "off-1" }));

  // Standalone gifts entered separately (online + one walk-in cash).
  const standalone = [
    { donation_date: "2026-07-27", payment_method: "online", amount: 100 },
    { donation_date: "2026-08-03", payment_method: "online", amount: 150 },
    { donation_date: "2026-08-15", payment_method: "online", amount: 75 },
    { donation_date: "2026-08-16", payment_method: "cash", amount: 25 },
  ];

  const totalIncome =
    standalone.reduce((s, d) => s + Number(d.amount), 0) +
    offerings.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  it("weekly ledger splits every week exactly (gross plate, negative pastor)", () => {
    expect(buildWeeklyLedgerDetail(offerings, standalone)).toEqual([
      ["2026-07-26", { anonymous: 0, named: 0, checks: 0, pastor: 0, online: 100, other: 0 }],
      ["2026-08-02", { anonymous: 244, named: 200, checks: 200, pastor: -20, online: 150, other: 0 }],
      ["2026-08-09", { anonymous: 0, named: 0, checks: 0, pastor: 0, online: 75, other: 0 }],
      ["2026-08-16", { anonymous: 0, named: 25, checks: 0, pastor: 0, online: 0, other: 0 }],
      ["2026-09-06", { anonymous: 300, named: 0, checks: 100, pastor: 0, online: 0, other: 0 }],
    ]);
  });

  it("weekly ledger grand total equals total income (offerings + standalone, no double count)", () => {
    const ledger = buildWeeklyLedgerDetail(offerings, standalone);
    const grand = ledger.reduce((s, [, v]) => s + v.anonymous + v.named + v.checks + v.pastor + v.online + v.other, 0);
    expect(grand).toBe(totalIncome); // 1374 = 624 + 400 + 100 + 150 + 75 + 25
    expect(totalIncome).toBe(1374);
  });

  it("by-method breakdown matches the ledger: gross anonymous, negative pastor, named, checks, online", () => {
    const byMethod = buildIncomeByMethod(offerings, standalone);
    const total = byMethod.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(totalIncome);
    expect(byMethod).toEqual([
      { method: "cash (anonymous)", amount: 544 }, // 244 + 300 gross
      { method: "online", amount: 325 },           // 100 + 150 + 75
      { method: "check", amount: 300 },            // 200 + 100
      { method: "cash (named)", amount: 225 },     // 200 envelope gifts + 25 walk-in
      { method: "pastor gifts", amount: -20 },     // the deduction, negative
    ]);
  });

  it("by-method display groups cash so the NET deposited figure is the headline and rows still sum to total income", () => {
    const display = buildIncomeMethodDisplay(offerings, standalone);
    // Cash group: net = gross(544) − pastor(20) + named(225) = 749, shown
    // first and bold, with the derivation indented underneath.
    expect(display).toEqual([
      { label: "Cash received (net)", amount: 749, bold: true },
      { label: "Plate cash (gross)", amount: 544, indent: true },
      { label: "Pastor gift — deducted before deposit", amount: -20, indent: true, neg: true },
      { label: "Named envelope gifts", amount: 225, indent: true },
      { label: "Checks", amount: 300 },
      { label: "Online giving", amount: 325 },
    ]);
    // The indented lines are the derivation — only the headline rows (group
    // + checks + online) sum to total income.
    expect(display.filter((r) => !r.indent).reduce((s, r) => s + r.amount, 0)).toBe(totalIncome);
  });

  it("by-method display shows a plain named-cash line when there is no plate", () => {
    expect(
      buildIncomeMethodDisplay([], [{ donation_date: "2026-08-03", payment_method: "cash", amount: 25 }]),
    ).toEqual([{ label: "Cash (named gifts)", amount: 25, bold: true }]);
  });

  it("weekly trend chart view (deposited cash) ties to the ledger's cash-equivalent", () => {
    const ledger = buildWeeklyLedgerDetail(offerings, standalone);
    const buckets = buildWeeklyBuckets(offerings, standalone);
    // For every week: ledger cash-equivalent (anon + named + pastor) = bucket cash,
    // ledger checks = bucket check, ledger online+other = bucket other.
    const ledgerByWeek = new Map(ledger);
    for (const [week, b] of buckets) {
      const v = ledgerByWeek.get(week)!;
      expect(v.anonymous + v.named + v.pastor).toBe(b.cash);
      expect(v.checks).toBe(b.check);
      expect(v.online + v.other).toBe(b.other);
    }
    // Deposited cash for the Aug 2 week is $424 ($244 gross − $20 pastor + $200 gifts)
    expect(buckets.find(([w]) => w === "2026-08-02")![1]).toEqual({ cash: 424, check: 200, other: 150 });
  });

  it("donor totals aggregate offering-linked + online gifts per donor, ignoring the anonymous plate", () => {
    const { byId } = aggregateDonorStats(
      [
        ...offeringLinked.map((d) => ({ donor_id: d.donor_id, donor_name: d.donor_name, amount: d.amount, donation_date: d.donation_date })),
        { donor_id: "d1", donor_name: "John Seeli", amount: 150, donation_date: "2026-08-03" },
        { donor_id: null, donor_name: "Anonymous", amount: 244, donation_date: "2026-08-02" },
      ],
    );
    expect(byId.get("d1")).toEqual({ total: 450, last: "2026-08-03" }); // 100+100+100+150
    expect(byId.get("d2")).toEqual({ total: 200, last: "2026-08-02" }); // 100+100
  });
});

// ── parseLedgerText (manual Sunday ledger import) ─────────────────────────
describe("parseLedgerText", () => {
  it("parses the church's paper ledger sheet: date, check rows, denomination lines, stated totals", () => {
    const ledger = `4/19/2026
2105-2917 John Seeli 20,50,50 120.00
559 Sangeeth Talluri 100.00
128 Soumya Nalli 300.00
492 Sarah Talluri 150.00
119 Umasankara Rao Rakkam 637.00
125 Immanuel Sattenapalli 2000.00
Checks $ 3,307.00
100 x 1 100.00
20 x 32 640.00
10 x 11 110.00
5 x 24 120.00
2 x 3 6.00
1 x 61 61.00
CASH 1037.00
CHECKS 3,307.00
Four Thousand Three Hundred and Forty Four 4,344.00
S. Thent 4/19/2026
J. Counter 4/19/2026`;
    const parsed = parseLedgerText(ledger);
    expect(parsed.serviceDate).toBe("2026-04-19");
    expect(parsed.denominations).toEqual({ 100: 1, 20: 32, 10: 11, 5: 24, 2: 3, 1: 61 });
    expect(parsed.checks).toHaveLength(6);
    expect(parsed.checks[0]).toEqual({ donorName: "John Seeli", checkNumber: "2105-2917", amount: 120 });
    expect(parsed.checks[1]).toEqual({ donorName: "Sangeeth Talluri", checkNumber: "559", amount: 100 });
    expect(parsed.checks[5]).toEqual({ donorName: "Immanuel Sattenapalli", checkNumber: "125", amount: 2000 });
    expect(parsed.statedCash).toBe(1037);
    expect(parsed.statedChecks).toBe(3307);
    expect(parsed.statedTotal).toBe(4344);
    expect(parsed.warnings).toEqual([]); // every stated total reconciles
  });

  it("treats named rows without check numbers as checks (they live in the checks section)", () => {
    const parsed = parseLedgerText(`4/19/2026
John Seeli 120.00
Sangeeth Talluri 100.00
Checks $ 220.00
100 x 1
20 x 6
CASH 220.00
TOTAL 440.00`);
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[0].checkNumber).toBe("");
    expect(parsed.checks[0].donorName).toBe("John Seeli");
    expect(parsed.warnings).toEqual([]);
  });

  it("flags a mismatch between the stated checks total and the parsed check rows", () => {
    const parsed = parseLedgerText(`4/19/2026
John Seeli 120.00
Checks $ 220.00
100 x 1
CASH 100.00
TOTAL 220.00`);
    expect(parsed.checks).toHaveLength(1);
    expect(parsed.warnings.some((w) => w.includes("Checks total"))).toBe(true);
  });

  it("normalizes superscript digits and '120 . 00' style spacing from OCR", () => {
    const parsed = parseLedgerText(`4/19/2026
John Seeli 120 . ⁰⁰
100 x 1
CASH 100 . ⁰⁰`);
    expect(parsed.checks[0].amount).toBe(120);
    expect(parsed.statedCash).toBe(100);
  });

  it("warns when the paste contains more than one week's date", () => {
    const parsed = parseLedgerText(`4/19/2026
John Seeli 10.00
4/26/2026
Sarah Talluri 20.00`);
    expect(parsed.serviceDate).toBe("2026-04-19");
    expect(parsed.warnings.some((w) => w.includes("one week at a time"))).toBe(true);
  });

  it("returns empty fields for garbage input", () => {
    const parsed = parseLedgerText("hello world\nno numbers here");
    expect(parsed.checks).toEqual([]);
    expect(parsed.denominations).toEqual({});
    expect(parsed.serviceDate).toBe("");
  });
});

// ── isAdminRole (access rules) ────────────────────────────────────────────
describe("isAdminRole", () => {
  it("admits admin-level roles", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("treasurer")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
  });
  it("rejects members, counters, and unknown", () => {
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("counter")).toBe(false);
  });
});

// ── utils formatting ──────────────────────────────────────────────────────
describe("formatCurrency", () => {
  it("formats dollars", () => {
    expect(formatCurrency(202)).toBe("$202.00");
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(12.5)).toBe("$12.50");
  });
});

describe("formatDate", () => {
  it("formats ISO dates as MMM DD, YYYY", () => {
    expect(formatDate("2026-07-18")).toBe("Jul 18, 2026");
    expect(formatDate("2026-08-02")).toBe("Aug 02, 2026");
  });

  it("never shifts a date-only string with the viewer's timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/New_York"; // UTC-4 — the zone that showed Aug 01 for Aug 02
      // Re-read the formatter under the shifted zone.
      expect(formatDate("2026-08-02")).toBe("Aug 02, 2026");
      expect(formatDate("2026-08-01")).toBe("Aug 01, 2026");
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("normalizeLineItems", () => {
  it("returns an empty array for null/undefined", () => {
    expect(normalizeLineItems(null)).toEqual([]);
    expect(normalizeLineItems(undefined)).toEqual([]);
  });

  it("passes real arrays through unchanged", () => {
    const items = [{ description: "Pens", amount: 4.5, receipt_path: "receipts/a.png" }];
    expect(normalizeLineItems(items)).toBe(items);
  });

  it("parses legacy stringified arrays (old JSON.stringify inserts)", () => {
    const raw = JSON.stringify([
      { description: "Electricity — December", amount: 184.32, no_receipt_note: "lost the paper bill" },
      { description: "Paper", amount: 12, receipt_path: "receipts/b.png" },
    ]);
    const result = normalizeLineItems(raw);
    expect(result).toHaveLength(2);
    expect(result[0].description).toBe("Electricity — December");
    expect(result[1].receipt_path).toBe("receipts/b.png");
  });

  it("never crashes on malformed strings or non-array shapes", () => {
    expect(normalizeLineItems("not json at all")).toEqual([]);
    expect(normalizeLineItems('{"a":1}')).toEqual([]);
    expect(normalizeLineItems(42)).toEqual([]);
  });
});

describe("buildReceiptPath", () => {
  it("prefixes member uploads with their profile id (first folder = uid for storage RLS)", () => {
    expect(buildReceiptPath("uid-123", "line-items", "My Receipt!.png")).toMatch(
      /^uid-123\/line-items\/\d+-My_Receipt_\.png$/,
    );
  });

  it("places expense receipts under <uid>/receipts/<expenseId>/", () => {
    expect(buildReceiptPath("uid-123", "receipts", "bill.jpg", "exp-9")).toMatch(
      /^uid-123\/receipts\/exp-9\/\d+-bill\.jpg$/,
    );
  });

  it("sanitizes unsafe filename characters", () => {
    expect(buildReceiptPath("uid-1", "check-images", "a/b\\c:d?.png")).toMatch(
      /\/check-images\/\d+-a_b_c_d_\.png$/,
    );
  });

  it("falls back to the unknown folder when there is no user id", () => {
    expect(buildReceiptPath(null, "line-items", "x.png")).toMatch(/^unknown\/line-items\//);
  });
});
