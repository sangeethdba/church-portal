import jsPDF from "jspdf";
import { formatCurrency, formatDateLong } from "./utils";
import type { Donor, Donation } from "./supabase";

/** Official Atlanta Little Flock Church details used on every generated document. */
export const ALF_DOCUMENT_BRANDING = {
  name: "Atlanta Little Flock Church",
  address: "7445 Cheswick Ct, Atlanta, GA 30350",
  phones: "404-660-6501 / 470-361-5878",
  website: "www.atlantalittleflock.org",
  email: "atlantalittleflock@gmail.com",
  ein: "81-3421276",
  treasurer: "Sangeeth Talluri",
} as const;

// ---- Logo preloading (fetched once at startup, used synchronously in PDFs) ----
let logoDataUrl: string | null = null;
let logoPromise: Promise<void> | null = null;

/** Call once at app startup to preload the church logo as a data URL.
 *  After this resolves, all PDF headers will use the real logo image. */
export async function initPdfLogo(): Promise<void> {
  if (logoDataUrl) return;
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    try {
      const resp = await fetch("/alf-logo.png");
      if (!resp.ok) return;
      const blob = await resp.blob();
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      // Silently fall back to the SVG mark if the image cannot load
    }
  })();
  return logoPromise;
}

/** Capitalize each word in a string (e.g. "offering" → "Offering"). */
function capitalizeWords(str: string): string {
  return str
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const displayChurchName = (churchName?: string | null) =>
  !churchName || churchName === "Grace Community Church" || churchName === "GraceLedger"
    ? ALF_DOCUMENT_BRANDING.name
    : churchName;

/** Draws the compact flock-and-cross mark used by the portal favicon. */
function drawBrandMark(doc: jsPDF, x: number, y: number, scale = 1) {
  doc.setFillColor(79, 70, 229);
  doc.roundedRect(x, y, 34 * scale, 34 * scale, 8 * scale, 8 * scale, "F");
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.6 * scale);
  doc.line(x + 17 * scale, y + 13 * scale, x + 17 * scale, y + 27 * scale);
  doc.line(x + 11 * scale, y + 20 * scale, x + 23 * scale, y + 20 * scale);
  doc.setFillColor(255, 255, 255);
  for (const [birdX, birdY] of [[9, 9], [15, 6], [21, 9]]) {
    doc.ellipse(x + birdX * scale, y + birdY * scale, 3 * scale, 1.7 * scale, "F");
  }
}

/** Shared branded letterhead header. Returns the first safe content baseline. */
function drawDocumentHeader(
  doc: jsPDF,
  churchName: string | null | undefined,
  title: string,
  meta: string[] = [],
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  const logoX = margin;
  const logoY = 24;

  // Logo — real image when preloaded, otherwise the drawn SVG mark
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "PNG", logoX, logoY, 64, 42); } catch { drawBrandMark(doc, logoX, logoY, 1.0); }
  } else {
    drawBrandMark(doc, logoX, logoY, 1.0);
  }

  // Church name — centered across full page width
  doc.setTextColor(28, 25, 23);
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.text(displayChurchName(churchName), pageWidth / 2, logoY + 16, { align: "center" });

  // Contact info — centered across full page width
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(87, 83, 78);
  doc.text(
    `${ALF_DOCUMENT_BRANDING.address}  \u00b7  Tel: ${ALF_DOCUMENT_BRANDING.phones}`,
    pageWidth / 2,
    logoY + 38,
    { align: "center" },
  );
  doc.text(
    `${ALF_DOCUMENT_BRANDING.website}  \u00b7  ${ALF_DOCUMENT_BRANDING.email}`,
    pageWidth / 2,
    logoY + 52,
    { align: "center" },
  );

  // Thin separator with brand-color accent line
  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(1.2);
  doc.line(margin, logoY + 66, pageWidth - margin, logoY + 66);
  doc.setDrawColor(214, 211, 209);
  doc.setLineWidth(0.5);
  doc.line(margin, logoY + 68, pageWidth - margin, logoY + 68);

  // Title — left-aligned below separator
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(title, margin, logoY + 84);

  // Meta lines — right-aligned near the top
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  meta.forEach((line, index) => {
    if (line) doc.text(line, pageWidth - margin, 33 + index * 14, { align: "right" });
  });

  return logoY + 104; // content start baseline
}

const TOTAL_PAGES_TOKEN = "{total_pages_count_string}";

function drawDocumentFooter(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  const center = pageWidth / 2;

  // Separator line
  doc.setDrawColor(214, 211, 209);
  doc.setLineWidth(0.5);
  doc.line(margin, 720, pageWidth - margin, 720);

  // All footer text centered — church name + page on same line
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 113, 108);

  doc.setFontSize(8);
  doc.text(
    `${ALF_DOCUMENT_BRANDING.name}  ·  Page ${doc.getCurrentPageInfo().pageNumber} of ${TOTAL_PAGES_TOKEN}`,
    center,
    738,
    { align: "center" },
  );

  doc.setFontSize(7);
  doc.text(
    `${ALF_DOCUMENT_BRANDING.address}  ·  Tel: ${ALF_DOCUMENT_BRANDING.phones}`,
    center,
    752,
    { align: "center" },
  );
  doc.text(
    `${ALF_DOCUMENT_BRANDING.website}  ·  ${ALF_DOCUMENT_BRANDING.email}`,
    center,
    766,
    { align: "center" },
  );
}

function finalizeDocument(doc: jsPDF) {
  doc.putTotalPages(TOTAL_PAGES_TOKEN);
  return doc;
}

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
  cashGifts: OfferingCheckEntry[];
  totalCashGifts: number;
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

  // ── Branded header ────────────────────────────────────────────────────
  y = drawDocumentHeader(doc, s.churchName, `Offering ledger · ${s.serviceName}`, [
    `Date: ${formatDateLong(s.serviceDate)}`,
  ]);

  // Continuation page: close the current page and restart with letterhead.
  const newPage = () => {
    drawDocumentFooter(doc);
    doc.addPage();
    y = drawDocumentHeader(doc, s.churchName, `Offering ledger · ${s.serviceName}`);
    y += 10;
  };

  // Header row for the checks table (re-drawn after a page break).
  const drawChecksHeader = () => {
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
  };

  // Header row for the named-cash-gifts table (re-drawn after a page break).
  const drawGiftsHeader = () => {
    doc.setFillColor(240, 253, 244);
    doc.rect(margin, y - 14, pageWidth - margin * 2, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text("Donor", margin + 8, y);
    doc.text("Amount", pageWidth - margin - 8, y, { align: "right" });
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(28, 25, 23);
  };

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
    if (y > 700) newPage();
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

  // ── Cash deductions (pastor gift, etc.) ───────────────────────────────
  if (s.deductions.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Cash deductions (pastor gift, etc.)", margin, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const ded of s.deductions) {
      if (y > 700) newPage();
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
  doc.text("Total cash", margin + 8, y);
  doc.text(formatCurrency(s.netCash), pageWidth - margin - 8, y, { align: "right" });
  y += 24;

  // ── Checks ────────────────────────────────────────────────────────────
  if (s.checks.length > 0) {
    if (y > 680) newPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Checks", margin, y);
    y += 20;

    drawChecksHeader();

    for (const ch of s.checks) {
      if (y > 700) {
        newPage();
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Checks", margin, y);
        y += 20;
        drawChecksHeader();
      }
      doc.text(ch.donorName, margin + 8, y);
      doc.text(ch.checkNumber || "—", margin + 260, y);
      doc.text(formatCurrency(ch.amount), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }

    if (y > 690) newPage();
    doc.line(margin + 100, y, pageWidth - margin, y);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Total checks", margin + 8, y);
    doc.text(formatCurrency(s.totalChecks), pageWidth - margin - 8, y, { align: "right" });
    y += 24;
  }

  // ── Named cash gifts ─────────────────────────────────────────────────
  if (s.cashGifts && s.cashGifts.length > 0) {
    if (y > 680) newPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Named cash gifts (envelopes)", margin, y);
    y += 18;

    drawGiftsHeader();

    for (const g of s.cashGifts) {
      if (y > 700) {
        newPage();
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Named cash gifts (envelopes)", margin, y);
        y += 18;
        drawGiftsHeader();
      }
      doc.text(g.donorName, margin + 8, y);
      doc.text(formatCurrency(g.amount), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }

    if (y > 690) newPage();
    doc.line(margin + 100, y, pageWidth - margin, y);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Named cash total", margin + 8, y);
    doc.text(formatCurrency(s.totalCashGifts), pageWidth - margin - 8, y, { align: "right" });
    y += 24;
  }

  // ── Grand total ───────────────────────────────────────────────────────
  // Keep the deposit box and the sign-off block together on one page —
  // the sign-off needs ~120pt after the box, so break early if needed.
  if (y > 600) newPage();
  doc.setFillColor(28, 25, 23);
  doc.rect(margin, y - 10, pageWidth - margin * 2, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.text("Total to be deposited", margin + 12, y + 12);
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
  drawDocumentFooter(doc);
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text(`Recorded by ${s.recordedBy} · ${formatDateLong(new Date())}`, margin, 775);

  return finalizeDocument(doc);
}

export function downloadOfferingSummary(s: OfferingSummary) {
  const pdf = generateOfferingSummary(s);
  const datePart = s.serviceDate.replace(/-/g, "");
  pdf.save(`deposit-slip-${datePart}-${s.serviceName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
}

/** Render the slip to a data URL so it can be previewed in-app (iframe) when browser downloads are blocked. */
export function offeringSummaryDataUrl(s: OfferingSummary): string {
  return generateOfferingSummary(s).output("datauristring");
}

// ── Offering receipt ────────────────────────────────────────────────────

export interface OfferingReceipt {
  churchName: string;
  receiptNumber: string;
  serviceName: string;
  serviceDate: string;
  cashDenoms: OfferingDenomEntry[];
  deductions: OfferingDeductionEntry[];
  grossCash: number;
  netCash: number;
  checks: OfferingCheckEntry[];
  totalChecks: number;
  totalDeposit: number;
  counter1Name: string;
  counter2Name: string;
  notes?: string | null;
}

export function generateOfferingReceipt(r: OfferingReceipt): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  let y = margin;

  // ── Branded header ────────────────────────────────────────────────────
  y = drawDocumentHeader(doc, r.churchName, `Offering receipt · ${r.serviceName}`, [
    `Receipt # ${r.receiptNumber}`,
    `Date: ${formatDateLong(r.serviceDate)}`,
  ]);

  // ── Acknowledgment line ───────────────────────────────────────────────
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text(
    `This receipt acknowledges the offering received on ${formatDateLong(r.serviceDate)} for the ${r.serviceName}.`,
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 },
  );
  y += 30;

  // ── Amounts box ───────────────────────────────────────────────────────
  doc.setFillColor(250, 250, 249);
  doc.rect(margin, y - 14, pageWidth - margin * 2, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text("Cash (net)", margin + 8, y);
  doc.text("Checks", pageWidth / 2, y);
  doc.text("Total received", pageWidth - margin - 8, y, { align: "right" });
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text(formatCurrency(r.netCash), margin + 8, y);
  doc.text(formatCurrency(r.totalChecks), pageWidth / 2, y);
  doc.text(formatCurrency(r.totalDeposit), pageWidth - margin - 8, y, { align: "right" });
  y += 26;

  // ── Cash by denomination ──────────────────────────────────────────────
  if (r.cashDenoms.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(28, 25, 23);
    doc.text("Cash by denomination", margin, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const d of r.cashDenoms) {
      doc.text(`$${d.denomination.toLocaleString()} × ${d.count}`, margin + 8, y);
      doc.text(formatCurrency(d.subtotal), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }
    y += 5;
  }

  // ── Deductions ────────────────────────────────────────────────────────
  if (r.deductions.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(28, 25, 23);
    doc.text("Cash deductions", margin, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const ded of r.deductions) {
      doc.text(ded.reason || "—", margin + 8, y);
      doc.text(`(${formatCurrency(ded.amount)})`, pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }
    y += 5;
  }

  // ── Checks received ───────────────────────────────────────────────────
  if (r.checks.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(28, 25, 23);
    doc.text("Checks received", margin, y);
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
    for (const ch of r.checks) {
      doc.text(ch.donorName, margin + 8, y);
      doc.text(ch.checkNumber || "—", margin + 260, y);
      doc.text(formatCurrency(ch.amount), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }
    y += 8;
  }

  // ── Notes ─────────────────────────────────────────────────────────────
  if (r.notes) {
    y += 6;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text(`Note: ${r.notes}`, margin, y, { maxWidth: pageWidth - margin * 2 });
    y += 18;
  }

  // ── Verified by ───────────────────────────────────────────────────────
  y += 16;
  doc.setDrawColor(231, 229, 228);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text("Verified by", margin, y);
  y += 22;
  const sigWidth = (pageWidth - margin * 2 - 30) / 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setDrawColor(120, 113, 108);
  doc.line(margin, y + 24, margin + sigWidth, y + 24);
  doc.text(r.counter1Name, margin, y + 20);
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text("Counter 1", margin, y + 36);
  doc.setTextColor(28, 25, 23);
  doc.setFontSize(10);
  doc.line(margin + sigWidth + 30, y + 24, pageWidth - margin, y + 24);
  doc.text(r.counter2Name, margin + sigWidth + 30, y + 20);
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text("Counter 2", margin + sigWidth + 30, y + 36);

  y += 56;

  // ── Thank you ─────────────────────────────────────────────────────────
  doc.setFont("times", "italic");
  doc.setFontSize(10);
  doc.setTextColor(87, 83, 78);
  doc.text("Thank you for your faithful giving.", margin, y);

  // ── Footer ────────────────────────────────────────────────────────────
  drawDocumentFooter(doc);
  doc.setFontSize(7.5);
  doc.setTextColor(120, 113, 108);
  doc.text(`Generated ${formatDateLong(new Date())}`, margin, 775);

  return finalizeDocument(doc);
}

export function downloadOfferingReceipt(r: OfferingReceipt) {
  const pdf = generateOfferingReceipt(r);
  pdf.save(`offering-receipt-${r.receiptNumber.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`);
}

export function offeringReceiptDataUrl(r: OfferingReceipt): string {
  return generateOfferingReceipt(r).output("datauristring");
}

/** Generate a professional letterhead annual donor statement PDF. */
export function generateAnnualStatement(s: AnnualStatement): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 56;
  const bodyWidth = pageWidth - margin * 2;
  const churchName = displayChurchName(s.churchName);
  const donorFull = `${s.donor.first_name} ${s.donor.last_name}`;
  let y = margin;

  // Column positions (5-column layout: Date | Type | Method | Memo | Amount)
  const colDate = margin + 8;
  const colType = margin + 98;
  const colMethod = margin + 185;
  const colMemo = margin + 268;
  const colAmount = pageWidth - margin - 8;

  // Helper: draw the statement table header
  const drawTableHeader = () => {
    doc.setFillColor(245, 243, 240);
    doc.rect(margin, y - 14, bodyWidth, 24, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(87, 83, 78);
    doc.text("Date", colDate, y);
    doc.text("Type", colType, y);
    doc.text("Method", colMethod, y);
    doc.text("Memo", colMemo, y);
    doc.text("Amount", colAmount, y, { align: "right" });
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(28, 25, 23);
    doc.setFontSize(10);
  };

  // Helper: new page with letterhead + table header
  const newPage = () => {
    drawDocumentFooter(doc);
    doc.addPage();
    y = drawDocumentHeader(doc, s.churchName, `Annual Giving Statement · ${s.year}`);
    y += 10;
    drawTableHeader();
  };

  // Page 1: Letterhead + letter body
  y = drawDocumentHeader(doc, s.churchName, `Annual Giving Statement · ${s.year}`);
  y += 10;

  // Salutation
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text(`Dear ${donorFull},`, margin, y);
  y += 22;

  // Body intro
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(68, 64, 60);
  doc.text(
    `Our records show that you have contributed to ${churchName} in the Year ${s.year}.`,
    margin,
    y,
    { maxWidth: bodyWidth },
  );
  y += 18;
  doc.text("Itemized contribution details are mentioned below.", margin, y);
  y += 24;

  // Table
  drawTableHeader();

  // Helper: build a readable type label (always the gift category)
  const typeLabel = (d: Donation) => capitalizeWords(d.donation_type);

  // Helper: build the memo (check number, notes, or empty)
  const memoLabel = (d: Donation) => {
    const method = d.payment_method?.toLowerCase() || "";
    if (method === "check" && d.check_number) return `#${d.check_number}`;
    if (d.notes) return d.notes.slice(0, 28);
    return "";
  };

  const sorted = [...s.donations].sort((a, b) =>
    a.donation_date.localeCompare(b.donation_date),
  );
  for (const d of sorted) {
    if (y > 680) newPage();
    doc.text(formatDateLong(d.donation_date), colDate, y);
    doc.text(typeLabel(d), colType, y);
    doc.text(capitalizeWords(d.payment_method), colMethod, y);
    const memo = memoLabel(d);
    if (memo) doc.text(memo, colMemo, y);
    doc.text(formatCurrency(d.amount), colAmount, y, { align: "right" });
    y += 18;
  }

  // Total
  if (y > 640) newPage();
  y += 6;
  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text("Total contributions", margin + 10, y);
  doc.setFontSize(14);
  doc.text(formatCurrency(s.total), pageWidth - margin - 10, y, { align: "right" });
  y += 28;

  // Closing text
  if (y > 620) newPage();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(87, 83, 78);

  const thankYou =
    "Thank you for joining us to impact numerous lives and in expansion of God's kingdom through your donations. " +
    "We praise and thank our Lord Jesus Christ for His provision and faithfulness.";
  const thankYouLines = doc.splitTextToSize(thankYou, bodyWidth);
  doc.text(thankYouLines, margin, y);
  y += thankYouLines.length * 13 + 16;

  if (y > 630) newPage();

  const taxLanguage =
    `Your gift is a tax-deductible contribution through our nonprofit 501(c)(3) organization. ` +
    `Our nonprofit Employer Identification Number (EIN): ${ALF_DOCUMENT_BRANDING.ein}.`;
  const taxLines = doc.splitTextToSize(taxLanguage, bodyWidth);
  doc.text(taxLines, margin, y);
  y += taxLines.length * 13 + 16;

  if (y > 650) newPage();

  doc.setFont("times", "normal");
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text("God bless you!", margin, y);
  y += 28;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Sincerely yours,", margin, y);
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(ALF_DOCUMENT_BRANDING.treasurer, margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(87, 83, 78);
  doc.text("Treasurer", margin, y);
  y += 14;
  doc.setFontSize(9);
  doc.text(churchName, margin, y);

  // Footer
  drawDocumentFooter(doc);

  return finalizeDocument(doc);
}

export function downloadStatement(s: AnnualStatement) {
  const pdf = generateAnnualStatement(s);
  pdf.save(`${s.donor.last_name}-${s.donor.first_name}-${s.year}-statement.pdf`);
}

// ── Member personal report (own giving + expenses, any period) ──────────

export interface MemberReportExpenseRow {
  date: string;
  title: string;
  category: string;
  status: string;
  amount: number;
}

export interface MemberReportData {
  churchName: string;
  memberName: string;
  periodLabel: string;
  donations: Donation[];
  expenses: MemberReportExpenseRow[];
  givingTotal: number;
  expensesTotal: number;
  reimbursedTotal: number;
  outstandingTotal: number;
}

const reportStatusLabel = (s: string) =>
  s === "paid" || s === "auto_paid"
    ? "Reimbursed"
    : s === "approved"
      ? "Approved"
      : s === "rejected"
        ? "Rejected"
        : "Pending";

/** Generate a personal member report (giving + expenses) for any period as a PDF. */
export function generateMemberReport(m: MemberReportData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 56;
  let y = margin;

  // Branded header
  y = drawDocumentHeader(doc, m.churchName, `Personal giving & expense report · ${m.periodLabel}`);

  // Member block
  y = 142;
  doc.setFontSize(10);
  doc.setTextColor(87, 83, 78);
  doc.text("Issued to", margin, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(28, 25, 23);
  doc.text(m.memberName, margin, y);
  y += 24;

  // ── Giving ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text("Giving", margin, y);
  y += 20;

  const drawMemberGivingHeader = () => {
    doc.setFillColor(247, 241, 231);
    doc.rect(margin, y - 14, pageWidth - margin * 2, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(120, 113, 108);
    doc.text("Date", margin + 8, y);
    doc.text("Type", margin + 110, y);
    doc.text("Method", margin + 200, y);
    doc.text("Memo", margin + 290, y);
    doc.text("Amount", pageWidth - margin - 8, y, { align: "right" });
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(28, 25, 23);
    doc.setFontSize(10);
  };

  drawMemberGivingHeader();

  const sortedDon = [...m.donations].sort((a, b) => a.donation_date.localeCompare(b.donation_date));
  if (sortedDon.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 113, 108);
    doc.text("No gifts recorded in this period.", margin + 8, y);
    y += 16;
    doc.setFont("helvetica", "normal");
  } else {
    for (const d of sortedDon) {
      if (y > 700) {
        drawDocumentFooter(doc);
        doc.addPage();
        y = drawDocumentHeader(doc, m.churchName, `Personal giving & expense report · ${m.periodLabel}`);
        y = 132;
        drawMemberGivingHeader();
      }
      doc.setTextColor(28, 25, 23);
      doc.text(formatDateLong(d.donation_date), margin + 8, y);
      doc.text(d.donation_type, margin + 110, y);
      doc.text(d.payment_method, margin + 200, y);
      doc.text((d.notes ?? d.check_number ?? "").slice(0, 32), margin + 290, y);
      doc.text(formatCurrency(d.amount), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }
  }

  y += 8;
  doc.setDrawColor(231, 229, 228);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text("Total giving", margin + 8, y);
  doc.text(formatCurrency(m.givingTotal), pageWidth - margin - 8, y, { align: "right" });
  y += 26;

  // ── Expenses & reimbursements ────────────────────────────────────────
  if (y > 700) {
    drawDocumentFooter(doc);
    doc.addPage();
    y = drawDocumentHeader(doc, m.churchName, `Personal giving & expense report · ${m.periodLabel}`);
    y = 142;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(28, 25, 23);
  doc.text("Expenses & reimbursements", margin, y);
  y += 20;

  doc.setFillColor(247, 241, 231);
  doc.rect(margin, y - 14, pageWidth - margin * 2, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text("Date", margin + 8, y);
  doc.text("Description", margin + 110, y);
  doc.text("Category", margin + 260, y);
  doc.text("Status", margin + 350, y);
  doc.text("Amount", pageWidth - margin - 8, y, { align: "right" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (m.expenses.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 113, 108);
    doc.text("No expense submissions in this period.", margin + 8, y);
    y += 16;
    doc.setFont("helvetica", "normal");
  } else {
    for (const e of m.expenses) {
      if (y > 700) {
        drawDocumentFooter(doc);
        doc.addPage();
        y = drawDocumentHeader(doc, m.churchName, `Personal giving & expense report · ${m.periodLabel}`);
        y = 132;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(28, 25, 23);
        doc.text("Expenses & reimbursements", margin, y);
        y += 20;
        doc.setFillColor(247, 241, 231);
        doc.rect(margin, y - 14, pageWidth - margin * 2, 22, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(120, 113, 108);
        doc.text("Date", margin + 8, y);
        doc.text("Description", margin + 110, y);
        doc.text("Category", margin + 260, y);
        doc.text("Status", margin + 350, y);
        doc.text("Amount", pageWidth - margin - 8, y, { align: "right" });
        y += 14;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
      }
      doc.setTextColor(28, 25, 23);
      doc.text(formatDateLong(e.date), margin + 8, y);
      doc.text((e.title || "Expense").slice(0, 26), margin + 110, y);
      doc.text(e.category, margin + 260, y);
      doc.text(reportStatusLabel(e.status), margin + 350, y);
      doc.text(formatCurrency(e.amount), pageWidth - margin - 8, y, { align: "right" });
      y += 16;
    }
  }

  if (y > 700) {
    drawDocumentFooter(doc);
    doc.addPage();
    y = drawDocumentHeader(doc, m.churchName, `Personal giving & expense report · ${m.periodLabel}`);
    y = 142;
  }

  y += 8;
  doc.setDrawColor(231, 229, 228);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text("Reimbursed", margin + 8, y);
  doc.text(formatCurrency(m.reimbursedTotal), pageWidth - margin - 8, y, { align: "right" });
  y += 16;
  doc.text("Outstanding", margin + 8, y);
  doc.text(formatCurrency(m.outstandingTotal), pageWidth - margin - 8, y, { align: "right" });
  y += 16;
  doc.setFontSize(12);
  doc.text("Total expenses", margin + 8, y);
  doc.text(formatCurrency(m.expensesTotal), pageWidth - margin - 8, y, { align: "right" });
  y += 26;

  // Footer
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(
    "This personal report summarizes your recorded contributions and expense reimbursements. " +
      "For tax purposes, use the official annual contribution statement.",
    margin,
    Math.min(y + 6, 720),
    { maxWidth: pageWidth - margin * 2 },
  );
  drawDocumentFooter(doc);

  return finalizeDocument(doc);
}

export function downloadMemberReport(m: MemberReportData) {
  const pdf = generateMemberReport(m);
  pdf.save(`member-report-${m.periodLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`);
}
