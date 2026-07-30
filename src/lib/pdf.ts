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
