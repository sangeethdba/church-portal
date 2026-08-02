import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Date-only strings (YYYY-MM-DD, e.g. service_date) are calendar dates, not
// instants. Parsing them with `new Date(str)` treats them as UTC midnight and
// then rendering in the viewer's timezone can shift them a day back (e.g. an
// Aug 02 service showing as Aug 01 in UTC-4). Anchor date-only strings at
// local noon so formatting never drifts with the viewer's timezone.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d =
    typeof value === "string"
      ? DATE_ONLY_RE.test(value)
        ? new Date(value + "T12:00:00")
        : new Date(value)
      : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

export function formatDateLong(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}
