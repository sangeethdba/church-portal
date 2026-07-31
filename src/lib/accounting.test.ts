import { describe, it, expect } from "vitest";
import {
  normName,
  computeCashFromDenoms,
  aggregateDonorStats,
  buildWeeklyBuckets,
} from "./accounting";
import { isAdminRole } from "./supabase";
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

  it("handles empty input", () => {
    expect(buildWeeklyBuckets([], [])).toEqual([]);
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
  });
});
