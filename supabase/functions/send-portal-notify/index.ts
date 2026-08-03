import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const resend = new Resend(RESEND_API_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FROM = "GraceLedger <notifications@graceledger.org>";
const ADMIN_ROLES = ["admin", "treasurer", "super_admin"];

// Oversight recipients who may not have a portal account yet — e.g. the pastor
// is currently only a donor record, not a signed-up profile. Comma-separated
// emails set as the OVERSIGHT_EMAILS secret on this edge function. They are
// deduped against profile recipients so nobody gets the same email twice once
// they sign up and are promoted to the pastor role.
const OVERSIGHT_EMAILS = (Deno.env.get("OVERSIGHT_EMAILS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Best-effort caller id from the JWT — used only to stop members from
// triggering notifications about other people's records. Never blocks mail.
function callerSub(authHeader?: string): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

async function listAdminEmails(includePastor = false): Promise<{ email: string; full_name: string | null }[]> {
  const roles = includePastor ? [...ADMIN_ROLES, "pastor"] : ADMIN_ROLES;
  const { data } = await supabase
    .from("profiles")
    .select("email, full_name")
    .in("role", roles)
    .not("email", "is", null);
  const recipients = (data ?? []).filter((p) => p.email);
  if (!includePastor || OVERSIGHT_EMAILS.length === 0) return recipients;
  // Always include explicit oversight emails (pastor may not have a profile yet)
  // and drop any that already match a profile so there are no duplicates.
  const seen = new Set(recipients.map((r) => r.email.toLowerCase()));
  const extras = OVERSIGHT_EMAILS
    .filter((email) => !seen.has(email.toLowerCase()))
    .map((email) => ({ email, full_name: "Pastor" }));
  return [...recipients, ...extras];
}

function formatUsd(n: number | string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

function shell(body: string, footer: string): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      ${body}
      <div style="margin-top: 24px; padding: 16px; background: #f7f1e7; border-radius: 8px; color: #78716c; font-size: 13px;">
        ${footer}
      </div>
    </div>
  `;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const body = await req.json();
    const sub = callerSub(req.headers.get("Authorization") ?? undefined);
    const type = body?.type ?? "expense_submitted";

    // ── Member submitted an expense → notify every admin ────────────────
    if (type === "expense_submitted") {
      const expenseId: string | undefined = body?.expense_id;
      if (!expenseId) {
        return new Response(JSON.stringify({ error: "Missing expense_id" }), { status: 400 });
      }

      const { data: expense } = await supabase
        .from("expenses")
        .select("id, amount, title, description, user_id")
        .eq("id", expenseId)
        .maybeSingle();
      if (!expense) {
        return new Response(JSON.stringify({ error: "Expense not found" }), { status: 404 });
      }
      if (sub && expense.user_id && sub !== expense.user_id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }

      let submitterName = "A member";
      if (expense.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", expense.user_id)
          .maybeSingle();
        if (profile?.full_name) submitterName = profile.full_name;
      }

      const title = expense.title || expense.description || "Expense";
      // The pastor is a read-only overseer — they get notified when a member
      // submits a reimbursement so they can review bills without approving them.
      const admins = await listAdminEmails(true);
      const results = await Promise.allSettled(
        admins.map((a) =>
          resend.emails.send({
            from: FROM,
            to: a.email,
            subject: `New expense submitted — ${formatUsd(expense.amount)}`,
            html: shell(
              `<h2 style="color:#1c1917; font-size:20px;">New expense submitted</h2>
               <p style="color:#57534e;"><strong>${submitterName}</strong> submitted an expense:</p>
               <p style="color:#57534e;">${title} — <strong>${formatUsd(expense.amount)}</strong></p>
               <p style="color:#a8a29e; font-size:13px;">Sign in to the stewardship portal to review the receipt, approve, or mark it paid.</p>`,
              "Automated message from the stewardship portal.",
            ),
          }),
        ),
      );
      const sent = results.filter((r) => r.status === "fulfilled").length;
      return new Response(JSON.stringify({ success: true, sent }), { status: 200 });
    }

    // ── New member signed up → notify every admin + pastor oversight ────
    if (type === "member_signed_up") {
      const userId: string | undefined = body?.user_id;
      if (!userId) {
        return new Response(JSON.stringify({ error: "Missing user_id" }), { status: 400 });
      }
      if (sub && sub !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", userId)
        .maybeSingle();
      if (!profile) {
        return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404 });
      }

      const name = profile.full_name || profile.email || "A new member";
      // The pastor is an overseer too — include explicit oversight emails and
      // pastor-role profiles so they know new members are joining.
      const admins = await listAdminEmails(true);
      const results = await Promise.allSettled(
        admins.map((a) =>
          resend.emails.send({
            from: FROM,
            to: a.email,
            subject: `New member signed up — ${name}`,
            html: shell(
              `<h2 style="color:#1c1917; font-size:20px;">New member account</h2>
               <p style="color:#57534e;"><strong>${name}</strong> just created a member account.</p>
               <p style="color:#57534e;">Email: ${profile.email ?? "—"}</p>
               <p style="color:#a8a29e; font-size:13px;">Sign in to link their donor profile and set their role if needed.</p>`,
              "Automated message from the stewardship portal.",
            ),
          }),
        ),
      );
      const sent = results.filter((r) => r.status === "fulfilled").length;
      return new Response(JSON.stringify({ success: true, sent }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
