import { describe, it, expect } from "vitest";
import {
  normName,
  computeCashFromDenoms,
  aggregateDonorStats,
  buildWeeklyBuckets,
  buildWeeklyLedgerDetail,
  sundayWeekKey,
} from "./accounting";
import { isAdminRole, normalizeLineItems, buildReceiptPath } from "./supabase";
import { formatCurrency, formatDate } from "./utils";

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
