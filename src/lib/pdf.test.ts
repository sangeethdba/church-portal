import { describe, expect, it } from "vitest";
import {
  ALF_DOCUMENT_BRANDING,
  generateAnnualConferenceReport,
  generateAnnualStatement,
  generateMemberReport,
  generateOfferingReceipt,
  generateOfferingSummary,
} from "./pdf";
import type { Donation, Donor } from "./supabase";

const donor: Donor = {
  id: "donor-1",
  first_name: "Sangeeth",
  last_name: "Talluri",
  email: "sangeeth@example.com",
  phone: null,
  address: "123 Main Street",
  city: "Atlanta",
  state: "GA",
  zip_code: "30350",
  is_family: false,
  family_members: [],
  notes: null,
  is_active: true,
  total_donations: 100,
  last_donation_date: "2026-07-18",
  linked_user_id: null,
  created_by: null,
  created_at: "2026-07-18T00:00:00Z",
};

const donation: Donation = {
  id: "donation-1",
  donor_id: donor.id,
  donor_name: "Sangeeth Talluri",
  donor_email: donor.email,
  amount: 100,
  donation_type: "offering",
  payment_method: "check",
  check_number: "1001",
  donation_date: "2026-07-18",
  entered_by: "admin-1",
  offering_id: null,
  notes: null,
  created_at: "2026-07-18T00:00:00Z",
};

describe("Atlanta Little Flock PDF documents", () => {
  it("keeps the official address, contact details, and EIN centralized", () => {
    expect(ALF_DOCUMENT_BRANDING).toEqual({
      name: "Atlanta Little Flock Church",
      address: "7445 Cheswick Ct, Atlanta, GA 30350",
      phones: "404-660-6501 / 470-361-5878",
      website: "www.atlantalittleflock.org",
      email: "atlantalittleflock@gmail.com",
      ein: "81-3421276",
      treasurer: "Sangeeth Talluri",
    });
  });

  it("generates branded annual statements and repeats the header on overflow pages", () => {
    const statement = generateAnnualStatement({
      donor,
      year: 2026,
      donations: Array.from({ length: 42 }, (_, index) => ({
        ...donation,
        id: `donation-${index}`,
        donation_date: `2026-${String((index % 12) + 1).padStart(2, "0")}-15`,
      })),
      total: 4200,
      churchName: "Grace Community Church",
    });

    expect(statement.getNumberOfPages()).toBeGreaterThan(1);
    const statementPdf = new TextDecoder().decode(new Uint8Array(statement.output("arraybuffer")));
    expect(statementPdf).toContain("Annual Giving Statement");
    expect(statementPdf).toContain("Itemized contribution details are mentioned below.");
    expect(statementPdf).toContain("Identification Number");
    expect(statementPdf).toContain("81-3421276");
    expect(statementPdf).toContain("Sangeeth Talluri");
    expect(statement.output("datauristring")).toContain("data:application/pdf");
  });

  it("generates the ledger, receipt, and member report with the shared document shell", () => {
    const summary = generateOfferingSummary({
      serviceDate: "2026-07-18",
      serviceName: "Sunday Service",
      cashDenoms: [{ denomination: 20, count: 5, subtotal: 100 }],
      grossCash: 100,
      deductions: [],
      netCash: 100,
      checks: [],
      totalChecks: 0,
      cashGifts: [],
      totalCashGifts: 0,
      totalDeposit: 100,
      churchName: "Atlanta Little Flock Church",
      recordedBy: "Treasurer",
      counter1Name: "Counter One",
      counter2Name: "Counter Two",
    });
    const receipt = generateOfferingReceipt({
      churchName: "Atlanta Little Flock Church",
      receiptNumber: "2026-001",
      serviceName: "Sunday Service",
      serviceDate: "2026-07-18",
      cashDenoms: [],
      deductions: [],
      grossCash: 0,
      netCash: 0,
      checks: [{ donorName: donor.first_name + " " + donor.last_name, checkNumber: "1001", amount: 100 }],
      totalChecks: 100,
      totalDeposit: 100,
      counter1Name: "Counter One",
      counter2Name: "Counter Two",
    });
    const report = generateMemberReport({
      churchName: "Atlanta Little Flock Church",
      memberName: "Sangeeth Talluri",
      periodLabel: "2026",
      donations: [donation],
      expenses: [],
      givingTotal: 100,
      expensesTotal: 0,
      reimbursedTotal: 0,
      outstandingTotal: 0,
    });

    expect(summary.getNumberOfPages()).toBe(1);
    expect(receipt.getNumberOfPages()).toBe(1);
    expect(report.getNumberOfPages()).toBe(1);
    expect(summary.output("datauristring")).toContain("data:application/pdf");
    expect(receipt.output("datauristring")).toContain("data:application/pdf");
    expect(report.output("datauristring")).toContain("data:application/pdf");
  });

  it("generates a branded Annual Conference summary PDF with income, expenses, and net", () => {
    const report = generateAnnualConferenceReport({
      churchName: "Atlanta Little Flock Church",
      year: 2026,
      incomeRows: [
        { date: "2026-07-01", from: "John Smith", type: "Annual Conference", checkNumber: "2201", note: "use for annual conference", amount: 2000 },
        { date: "2026-07-15", from: "Anonymous", type: "Annual Conference", checkNumber: null, note: null, amount: 500 },
        { date: "2026-08-03", from: "Annual Conference offering", type: "Offering plate", checkNumber: null, note: null, amount: 3200 },
      ],
      incomeTotal: 5700,
      expenseRows: [
        { date: "2026-07-20", payee: "Venue rental", submittedBy: "Sangeeth Talluri", category: "conference", method: "check", amount: 1500 },
        { date: "2026-08-01", payee: "Catering", submittedBy: "Admin", category: "conference", method: "card", amount: 800 },
      ],
      expenseTotal: 2300,
      net: 3400,
      generatedBy: "Sangeeth Talluri",
    });

    expect(report.getNumberOfPages()).toBeGreaterThan(0);
    const pdfBytes = new TextDecoder().decode(new Uint8Array(report.output("arraybuffer")));
    expect(pdfBytes).toContain("Annual Conference Report");
    expect(pdfBytes).toContain("2026");
    expect(pdfBytes).toContain("John Smith");
    expect(pdfBytes).toContain("Venue rental");
    expect(pdfBytes).toContain("Surplus");
    expect(pdfBytes).toContain("Sangeeth Talluri");
    expect(report.output("datauristring")).toContain("data:application/pdf");
  });

  it("paginates the offering ledger so many checks never push the sign-off off the page", () => {
    const checks = Array.from({ length: 45 }, (_, index) => ({
      donorName: `Donor ${index + 1}`,
      checkNumber: String(1001 + index),
      amount: 40,
    }));
    const summary = generateOfferingSummary({
      serviceDate: "2026-08-02",
      serviceName: "Sunday Service",
      cashDenoms: [
        { denomination: 100, count: 2, subtotal: 200 },
        { denomination: 20, count: 5, subtotal: 100 },
      ],
      grossCash: 300,
      deductions: [{ reason: "pastor gift", amount: 20 }],
      netCash: 280,
      checks,
      totalChecks: 1800,
      cashGifts: [{ donorName: "Jane Doe", checkNumber: "", amount: 50 }],
      totalCashGifts: 50,
      totalDeposit: 2130,
      churchName: "Atlanta Little Flock Church",
      recordedBy: "Treasurer",
      counter1Name: "Counter One",
      counter2Name: "Counter Two",
    });

    // 45 checks at 16pt each can't fit one letter page — must span multiple
    // pages instead of drawing the totals/sign-off past the bottom edge.
    expect(summary.getNumberOfPages()).toBeGreaterThan(1);
    const pdfBytes = new TextDecoder().decode(new Uint8Array(summary.output("arraybuffer")));
    expect(pdfBytes).toContain("Total checks");
    expect(pdfBytes).toContain("Total to be deposited");
    expect(pdfBytes).toContain("Verified & signed by");
    expect(pdfBytes).toContain("Counter 1");
    expect(pdfBytes).toContain("Counter 2");
  });
});
