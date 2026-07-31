import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ----- Domain types (mirror the SQL enums) ------------------------------
export type AppRole = "member" | "treasurer" | "admin" | "super_admin";

// Admin-level roles — mirrors public.is_admin_or_treasurer() in the database.
export const isAdminRole = (role: string | null | undefined): boolean =>
  role === "admin" || role === "treasurer" || role === "super_admin";

export type DonationKind = "tithe" | "offering" | "building" | "missions" | "other";
export type PaymentMethod = "cash" | "check" | "online" | "card";

export type ExpenseSource = "member_submitted" | "church_direct";
export type ExpenseStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paid"
  | "auto_paid";
export type DepositStatus = "pending_deposit" | "deposited";

export interface LineItem {
  description: string;
  amount: number;
  receipt_path?: string | null;
  /** Member's explanation when they couldn't attach a receipt for this bill. */
  no_receipt_note?: string | null;
}

/**
 * Safely interpret the `line_items` jsonb column.
 *
 * Older versions of the expense form stored the bill array as a *JSON string*
 * (JSON.stringify'd) inside the jsonb column, so the value round-trips as a JS
 * string (e.g. '[{"description":…}]') instead of an array. Callers must never
 * assume the shape — normalize it before calling .map/.some/.filter.
 */
export function normalizeLineItems(value: unknown): LineItem[] {
  if (Array.isArray(value)) return value as LineItem[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as LineItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Build a storage path inside the `receipts` bucket.
 *
 * Member-uploaded files are always prefixed with the uploader's profile id so
 * the storage RLS policies (`first folder = auth.uid()`) apply cleanly to both
 * upload and read. Layouts:
 *   <uid>/check-images/<stamp>-<file>
 *   <uid>/line-items/<stamp>-<file>
 *   <uid>/receipts/<expenseId>/<stamp>-<file>
 */
export function buildReceiptPath(
  userId: string | null | undefined,
  kind: "check-images" | "line-items" | "receipts",
  fileName: string,
  id?: string,
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = Date.now();
  const folder = userId ?? "unknown";
  if (kind === "receipts") return `${folder}/receipts/${id}/${stamp}-${safe}`;
  return `${folder}/${kind}/${stamp}-${safe}`;
}
export type ExpenseCategory =
  | "rent"
  | "utilities"
  | "internet_phone"
  | "maintenance"
  | "supplies"
  | "books"
  | "packaging"
  | "shipping"
  | "travel"
  | "hotel"
  | "tickets"
  | "salaries"
  | "benevolence"
  | "church_support"
  | "missions"
  | "events"
  | "vbs"
  | "conference"
  | "youth"
  | "sunday_snacks"
  | "sunday_school"
  | "reimbursements"
  | "bank_fees"
  | "other";

/** Human-friendly labels + grouping for the expense category enum. */
export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; group: string }[] = [
  { value: "rent", label: "Church rent", group: "Facility" },
  { value: "utilities", label: "Utilities (power, water)", group: "Facility" },
  { value: "internet_phone", label: "Internet & phone", group: "Facility" },
  { value: "maintenance", label: "Maintenance & repairs", group: "Facility" },
  { value: "salaries", label: "Pastor & staff salaries", group: "People" },
  { value: "benevolence", label: "Benevolence / helping families", group: "People" },
  { value: "church_support", label: "Supporting other pastors & churches", group: "People" },
  { value: "missions", label: "Missions & outreach", group: "Ministry" },
  { value: "books", label: "Book room & media", group: "Ministry" },
  { value: "packaging", label: "India packaging & goods", group: "Ministry" },
  { value: "shipping", label: "Shipping & courier", group: "Ministry" },
  { value: "vbs", label: "VBS (Vacation Bible School)", group: "Events" },
  { value: "conference", label: "Annual conference", group: "Events" },
  { value: "youth", label: "Youth ministry", group: "Events" },
  { value: "sunday_snacks", label: "Sunday snacks & fellowship meals", group: "Events" },
  { value: "sunday_school", label: "Sunday school ministry", group: "Events" },
  { value: "events", label: "Other events", group: "Events" },
  { value: "travel", label: "Travel (fuel, local)", group: "Travel & booking" },
  { value: "hotel", label: "Hotel booking (conferences / youth)", group: "Travel & booking" },
  { value: "tickets", label: "Tickets (flights, events)", group: "Travel & booking" },
  { value: "reimbursements", label: "Member reimbursements", group: "People" },
  { value: "bank_fees", label: "Bank & service fees", group: "Facility" },
  { value: "supplies", label: "General supplies", group: "Ministry" },
  { value: "other", label: "Other", group: "Other" },
];

/** Suggested event tags shown in the expense form. */
export const EVENT_SUGGESTIONS = [
  "VBS",
  "Annual Conference",
  "Sunday Snacks",
  "Youth Meeting",
  "Sunday School",
];

export interface Profile {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  role: AppRole;
  is_counter: boolean;
  portal_access: boolean;
  linked_donor_id?: string | null;
  church_name?: string | null;
  created_at: string;
}

export interface Donor {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  is_family: boolean;
  family_members: string[];
  notes?: string | null;
  is_active: boolean;
  total_donations: number;
  last_donation_date?: string | null;
  linked_user_id?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface Donation {
  id: string;
  donor_id?: string | null;
  donor_name: string;
  donor_email?: string | null;
  amount: number;
  donation_type: DonationKind;
  payment_method: PaymentMethod;
  check_number?: string | null;
  donation_date: string;
  entered_by: string;
  offering_id?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  source: ExpenseSource;
  title?: string | null;
  amount: number;
  category: ExpenseCategory;
  description?: string | null;
  receipt_paths: string[];
  transfer_receipt_path?: string | null;
  payment_method?: string | null;
  check_number?: string | null;
  event_name?: string | null;
  line_items?: LineItem[] | null;
  user_id?: string | null;
  status: ExpenseStatus;
  submitted_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  paid_by?: string | null;
  notes?: string | null;
  admin_note?: string | null;
  admin_note_at?: string | null;
  member_reply?: string | null;
  member_reply_at?: string | null;
  created_at: string;
}

export interface Reimbursement {
  id: string;
  expense_id: string;
  amount: number;
  settlement_method: string;
  reimbursed_by?: string | null;
  reimbursed_at: string;
  notes?: string | null;
}

export interface TaxReceipt {
  id: string;
  donor_id: string;
  year: number;
  total_amount: number;
  donation_count: number;
  generated_at: string;
  generated_by?: string | null;
  storage_path?: string | null;
}

export interface AuditEntry {
  id: string;
  actor?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

// ----- Client singleton -------------------------------------------------
// Supabase URL and anon key are public values (the anon key is a JWT designed
// for client-side use, governed by Row Level Security policies). Hardcoding
// them avoids Vite build-time env var issues on Vercel.
const SUPABASE_URL = "https://qjoxqfkdyugwmgzgjzir.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqb3hxZmtkeXVnd21nemdqemlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NDg1ODAsImV4cCI6MjEwMTAyNDU4MH0.CDTbsYOpSCBnhhKWBIv9K5R9A4dF7oNH7ul1dKznHvk";

export const isSupabaseConfigured = (): boolean => true;

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

/** Resolve a stored receipt path to a viewable URL (signed URL with public fallback). */
export async function getReceiptUrl(path: string | null | undefined): Promise<string | null> {
  if (!path || !supabase) return null;
  const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
  if (signed?.signedUrl) return signed.signedUrl;
  const { data: pub } = supabase.storage.from("receipts").getPublicUrl(path);
  return pub?.publicUrl ?? null;
}
