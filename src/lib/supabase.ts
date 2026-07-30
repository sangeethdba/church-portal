import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ----- Domain types (mirror the SQL enums) ------------------------------
export type AppRole = "member" | "treasurer" | "admin" | "super_admin";

export type DonationKind = "tithe" | "offering" | "building" | "missions" | "other";
export type PaymentMethod = "cash" | "check" | "online" | "card";

export type ExpenseSource = "member_submitted" | "church_direct";
export type ExpenseStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paid"
  | "auto_paid";
export type ExpenseCategory =
  | "utilities"
  | "maintenance"
  | "supplies"
  | "missions"
  | "events"
  | "staff"
  | "benevolence"
  | "other";

export interface Profile {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  role: AppRole;
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
  user_id?: string | null;
  status: ExpenseStatus;
  submitted_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  paid_by?: string | null;
  notes?: string | null;
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
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = (): boolean =>
  url.startsWith("https://") && anon.length > 20;

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
