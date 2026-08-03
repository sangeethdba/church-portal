import { supabase } from "./supabase";

// Edge function deployed to the project's Supabase instance. See
// supabase/functions/send-portal-notify/index.ts. Kept separate from
// send-reimbursement-email so the expense-cleared flow is untouched.
const NOTIFY_URL =
  "https://qjoxqfkdyugwmgzgjzir.supabase.co/functions/v1/send-portal-notify";

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
