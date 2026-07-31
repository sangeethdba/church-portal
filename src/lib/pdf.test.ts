import { describe, expect, it } from "vitest";
import {
  ALF_DOCUMENT_BRANDING,
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
});
