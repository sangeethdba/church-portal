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
const url = (import.meta.env.VITE_SUPABASE_URL as string) || "";
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "";

export const isSupabaseConfigured = (): boolean =>
  url.length > 0 && anon.length > 0;

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  // Only create the real client when env vars are present.
  // createClient throws on empty URL, so we guard it here.
  if (isSupabaseConfigured()) {
    _supabase = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  } else {
    console.error(
      "GraceLedger: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. " +
      "Add them in your Vercel project Settings → Environment Variables.",
    );
    // Return a no-op stub that won't crash the app.
    // Every method returns a rejected promise so callers can handle errors.
    _supabase = new Proxy({} as SupabaseClient, {
      get(_, prop) {
        if (prop === "auth") {
          return new Proxy({}, {
            get(_, authProp) {
              return (..._args: unknown[]) => {
                if (authProp === "onAuthStateChange") {
                  return {
                    data: { subscription: { unsubscribe: () => {} } },
                  };
                }
                return Promise.reject(
                  new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."),
                );
              };
            },
          });
        }
        if (prop === "from" || prop === "rpc" || prop === "storage" || prop === "channel") {
          return () =>
            Promise.reject(
              new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."),
            );
        }
        return undefined;
      },
    });
  }
  return _supabase;
}

export const supabase = getSupabase();
