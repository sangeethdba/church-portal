import jsPDF from "jspdf";
import { formatCurrency, formatDateLong } from "./utils";
import type { Donor, Donation } from "./supabase";

export interface AnnualStatement {
  donor: Donor;
  year: number;
  donations: Donation[];
  total: number;
  churchName: string;
}

// ── Offering deposit slip ────────────────────────────────────────────────

export interface OfferingDenomEntry {
  denomination: number;
  count: number;
  subtotal: number;
}

export interface OfferingDeductionEntry {
  reason: string;
  amount: number;
}

export interface OfferingCheckEntry {
  donorName: string;
  checkNumber: string;
  amount: number;
}

export interface OfferingSummary {
  serviceDate: string;
  serviceName: string;
  cashDenoms: OfferingDenomEntry[];
  grossCash: number;
  deductions: OfferingDeductionEntry[];
  netCash: number;
  checks: OfferingCheckEntry[];
  totalChecks: number;
  totalDeposit: number;
  churchName: string;
  recordedBy: string;
  counter1Name: string;
  counter2Name: string;
}

const DENOM_ORDER = [100, 50, 20, 10, 5, 2, 1];

export function generateOfferingSummary(s: OfferingSummary): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  let y = margin;

  // ── Header ────────────────────────────────────────────────────────────
  doc.setFillColor(247, 241, 231);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor(28, 25, 23);
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.text(s.churchName, margin, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(87, 83, 78);
  doc.text(`Deposit Slip · ${s.serviceName}`, margin, 68);
  doc.setFontSize(9);
  doc.text(`Date: ${formatDateLong(s.serviceDate)}`, pageWidth - margin, 68, { align: "right" });

  y = 110;

  // ── Cash breakdown ────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text("Cash", margin, y);
  y += 20;

  // Denomination table
  doc.setFillColor(250, 250, 249);
  doc.rect(margin, y - 14, pageWidth - margin * 2, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text("Denomination", margin + 8, y);
  doc.text("Count", margin + 200, y);
  doc.text("Subtotal", pageWidth - margin - 8, y, { align: "right" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(28, 25, 23);
  for (const d of s.cashDenoms) {
    if (d.count === 0) continue;
    doc.text(`$${d.denomination.toLocaleString()}`, margin + 8, y);
    doc.text(`× ${d.count}`, margin + 200, y);
    doc.text(formatCurrency(d.subtotal), pageWidth - margin - 8, y, { align: "right" });
    y += 16;
  }

  // Gross cash
  doc.setDrawColor(231, 229, 228);
  doc.line(margin + 100, y, pageWidth - margin, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text("Gross cash", margin + 8, y);
  doc.text(formatCurrency(s.grossCash), pageWidth - margin - 8, y, { align: "right" });
  y += 20;

  // ── Deductions ────────────────────────────────────────────────────────
  if (s.deductions.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Deductions", margin, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const ded of s.deductions) {
      doc.text(ded.reason || "—", margin + 8, y);
      doc.text(`${formatCurrency(ded.amount)}`, pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }
    y += 5;
  }

  // Net cash
  doc.setDrawColor(231, 229, 228);
  doc.line(margin + 100, y, pageWidth - margin, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Net cash deposit", margin + 8, y);
  doc.text(formatCurrency(s.netCash), pageWidth - margin - 8, y, { align: "right" });
  y += 24;

  // ── Checks ────────────────────────────────────────────────────────────
  if (s.checks.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Checks", margin, y);
    y += 20;

    doc.setFillColor(250, 250, 249);
    doc.rect(margin, y - 14, pageWidth - margin * 2, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text("Donor", margin + 8, y);
    doc.text("Check #", margin + 260, y);
    doc.text("Amount", pageWidth - margin - 8, y, { align: "right" });
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(28, 25, 23);
    for (const ch of s.checks) {
      doc.text(ch.donorName, margin + 8, y);
      doc.text(ch.checkNumber || "—", margin + 260, y);
      doc.text(formatCurrency(ch.amount), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }

    doc.line(margin + 100, y, pageWidth - margin, y);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Total checks", margin + 8, y);
    doc.text(formatCurrency(s.totalChecks), pageWidth - margin - 8, y, { align: "right" });
    y += 24;
  }

  // ── Grand total ───────────────────────────────────────────────────────
  doc.setFillColor(28, 25, 23);
  doc.rect(margin, y - 10, pageWidth - margin * 2, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.text("Total deposit", margin + 12, y + 12);
  doc.setFontSize(16);
  doc.text(formatCurrency(s.totalDeposit), pageWidth - margin - 12, y + 12, { align: "right" });
  y += 38;

  // ── Sign-off ──────────────────────────────────────────────────────────
  y += 12;
  doc.setTextColor(28, 25, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Verified & signed by", margin, y);
  y += 22;

  // Two signature lines side by side
  const sigWidth = (pageWidth - margin * 2 - 30) / 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setDrawColor(120, 113, 108);

  // Counter 1
  doc.line(margin, y + 24, margin + sigWidth, y + 24);
  doc.text(s.counter1Name, margin, y + 20);
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text("Counter 1", margin, y + 36);

  // Counter 2
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(10);
  doc.line(margin + sigWidth + 30, y + 24, pageWidth - margin, y + 24);
  doc.text(s.counter2Name, margin + sigWidth + 30, y + 20);
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text("Counter 2", margin + sigWidth + 30, y + 36);

  y += 56;

  // ── Footer ────────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(168, 162, 158);
  doc.text(
    `${s.churchName} · Recorded by ${s.recordedBy} · ${formatDateLong(new Date())}`,
    pageWidth - margin,
    760,
    { align: "right" },
  );

  return doc;
}

export function downloadOfferingSummary(s: OfferingSummary) {
  const pdf = generateOfferingSummary(s);
  const datePart = s.serviceDate.replace(/-/g, "");
  pdf.save(`deposit-slip-${datePart}-${s.serviceName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
}

/** Generate a one-page annual donor statement PDF in the browser. */
export function generateAnnualStatement(s: AnnualStatement): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 56;
  let y = margin;

  // Header band (warm parchment)
  doc.setFillColor(247, 241, 231);
  doc.rect(0, 0, pageWidth, 96, "F");
  doc.setTextColor(28, 25, 23);
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.text(s.churchName, margin, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Annual Giving Statement · ${s.year}`, margin, 72);

  // Donor block
  y = 130;
  doc.setFontSize(10);
  doc.setTextColor(87, 83, 78);
  doc.text("Issued to", margin, y);
  y += 14;
  doc.setFontSize(13);
  doc.setTextColor(28, 25, 23);
  doc.setFont("helvetica", "bold");
  doc.text(`${s.donor.first_name} ${s.donor.last_name}`, margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(87, 83, 78);
  if (s.donor.address) {
    doc.text(s.donor.address, margin, y);
    y += 12;
  }
  const cityLine = [s.donor.city, s.donor.state, s.donor.zip_code]
    .filter(Boolean)
    .join(", ");
  if (cityLine) {
    doc.text(cityLine, margin, y);
    y += 12;
  }
  if (s.donor.email) {
    doc.text(s.donor.email, margin, y);
    y += 12;
  }

  // Statement body
  y += 16;
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(
    `For the calendar year ${s.year}, ${s.donor.first_name} ${s.donor.last_name} contributed the following:`,
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 },
  );
  y += 26;

  // Table header
  doc.setFillColor(247, 241, 231);
  doc.rect(margin, y - 14, pageWidth - margin * 2, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Date", margin + 8, y);
  doc.text("Type", margin + 110, y);
  doc.text("Method", margin + 200, y);
  doc.text("Memo", margin + 290, y);
  doc.text("Amount", pageWidth - margin - 8, y, { align: "right" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(10);
  // Sort ascending by date for statement readability
  const sorted = [...s.donations].sort((a, b) =>
    a.donation_date.localeCompare(b.donation_date),
  );
  for (const d of sorted) {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.text(formatDateLong(d.donation_date), margin + 8, y);
    doc.text(d.donation_type, margin + 110, y);
    doc.text(d.payment_method, margin + 200, y);
    doc.text((d.notes ?? d.check_number ?? "").slice(0, 32), margin + 290, y);
    doc.text(formatCurrency(d.amount), pageWidth - margin - 8, y, { align: "right" });
    y += 16;
  }

  // Divider
  y += 8;
  doc.setDrawColor(231, 229, 228);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // Total
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(28, 25, 23);
  doc.text("Total contributions", margin + 8, y);
  doc.text(formatCurrency(s.total), pageWidth - margin - 8, y, { align: "right" });
  y += 24;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(
    `${s.donations.length} gift${s.donations.length === 1 ? "" : "s"} recorded for ${s.year}. ` +
      `No goods or services were provided in exchange for these contributions. ` +
      `Please retain this statement for your records.`,
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 },
  );

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(168, 162, 158);
  doc.text(
    `${s.churchName} · Generated ${formatDateLong(new Date())}`,
    pageWidth - margin,
    760,
    { align: "right" },
  );

  return doc;
}

export function downloadStatement(s: AnnualStatement) {
  const pdf = generateAnnualStatement(s);
  pdf.save(`${s.donor.last_name}-${s.donor.first_name}-${s.year}-statement.pdf`);
}
