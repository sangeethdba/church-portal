import { supabase } from "./supabase";

// Edge function deployed to the project's Supabase instance. See
// supabase/functions/send-portal-notify/index.ts. Kept separate from
// send-reimbursement-email so the expense-cleared flow is untouched.
const NOTIFY_URL =
  "https://qjoxqfkdyugwmgzgjzir.supabase.co/functions/v1/send-portal-notify";

const WEEKLY_SUMMARY_URL =
  "https://qjoxqfkdyugwmgzgjzir.supabase.co/functions/v1/send-weekly-summary";

export type PortalNotify =
  | { type: "expense_submitted"; expense_id: string }
  | { type: "member_signed_up"; user_id: string };

/**
 * Best-effort admin notification. Never throws and never blocks the
 * primary flow — if the edge function isn't deployed yet (or mail fails),
 * the save still succeeds and we just log a warning.
 */
export async function notifyPortal(payload: PortalNotify): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    await fetch(NOTIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Portal email notification failed (best-effort):", err);
  }
}

export interface WeeklySummaryResult {
  ok: boolean;
  sent: number;
  weekStart?: string;
  weekEnd?: string;
  message?: string;
}

/**
 * Send the pastor's weekly offerings + expenses summary via the
 * send-weekly-summary edge function. Best-effort — never throws.
 */
export async function notifyWeeklySummary(weekEnd?: string): Promise<WeeklySummaryResult> {
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(WEEKLY_SUMMARY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify(weekEnd ? { week_end: weekEnd } : {}),
    });
    const json = (await res.json().catch(() => null)) as WeeklySummaryResult | null;
    if (!res.ok) {
      return { ok: false, sent: 0, message: json?.message ?? `Edge function error (${res.status})` };
    }
    return {
      ok: true,
      sent: json?.sent ?? 0,
      weekStart: json?.weekStart,
      weekEnd: json?.weekEnd,
      message: json?.message,
    };
  } catch (err) {
    console.warn("Weekly summary email failed (best-effort):", err);
    return { ok: false, sent: 0 };
  }
}
