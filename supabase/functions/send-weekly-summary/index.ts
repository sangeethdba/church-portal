import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const resend = new Resend(RESEND_API_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FROM = "GraceLedger <notifications@graceledger.org>";

// Pastor recipients — comma-separated emails, same OVERSIGHT_EMAILS secret as
// send-portal-notify, so the pastor gets the summary even before he has a
// portal account. Deduped against pastor-role profiles below.
const OVERSIGHT_EMAILS = (Deno.env.get("OVERSIGHT_EMAILS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtDate(d: string): string {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Week (Sunday → Saturday) containing `anchor`, matched to the portal's weekly
// buckets, which are keyed by their Sunday start in UTC.
function weekRange(anchor: Date): { start: string; end: string } {
  const start = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - anchor.getUTCDay()),
  );
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
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
    const body = await req.json().catch(() => ({}));
    const sub = callerSub(req.headers.get("Authorization") ?? undefined);

    // Only admins/treasurer/super_admin or the pastor may trigger a summary.
    if (sub) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", sub)
        .maybeSingle();
      const role: string | null = profile?.role ?? null;
      if (!role || !["admin", "treasurer", "super_admin", "pastor"].includes(role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
    }

    const anchor =
      typeof body?.week_end === "string" && body.week_end
        ? new Date(body.week_end + "T12:00:00Z")
        : new Date();
    const { start, end } = weekRange(anchor);

    const [offResp, expResp, donResp, pastorResp] = await Promise.all([
      supabase
        .from("offerings")
        .select("service_date, service_name, total_amount, cash_net, cash_amount, check_amount, deposit_status")
        .gte("service_date", start)
        .lte("service_date", end)
        .order("service_date"),
      supabase
        .from("expenses")
        .select("amount, status, source, submitted_at")
        .gte("submitted_at", start)
        .lte("submitted_at", end),
      supabase
        .from("donations")
        .select("amount, payment_method, offering_id")
        .gte("donation_date", start)
        .lte("donation_date", end),
      supabase
        .from("profiles")
        .select("email")
        .eq("role", "pastor")
        .not("email", "is", null),
    ]);

    const offerings = offResp.data ?? [];
    const expenses = expResp.data ?? [];
    const donations = donResp.data ?? [];

    const offeringsTotal = offerings.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    const cashNet = offerings.reduce((s, o) => s + Number(o.cash_net ?? o.cash_amount ?? 0), 0);
    const checks = offerings.reduce((s, o) => s + Number(o.check_amount ?? 0), 0);
    // Standalone / online gifts are donations with no linked offering.
    const onlineGifts = donations
      .filter((d) => !d.offering_id)
      .reduce((s, d) => s + Number(d.amount ?? 0), 0);
    const paidExpenses = expenses.filter((e) => e.status === "paid" || e.status === "auto_paid");
    const paidTotal = paidExpenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const pendingTotal = expenses
      .filter((e) => e.status === "pending" || e.status === "approved")
      .reduce((s, e) => s + Number(e.amount ?? 0), 0);
    const income = offeringsTotal + onlineGifts;

    // Recipients: explicit oversight emails + pastor-role profiles (deduped).
    const seen = new Set<string>();
    const to: string[] = [];
    for (const email of [
      ...OVERSIGHT_EMAILS,
      ...(pastorResp.data ?? []).map((p) => p.email).filter(Boolean),
    ]) {
      const key = email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        to.push(email);
      }
    }

    if (to.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          weekStart: start,
          weekEnd: end,
          message: "No pastor email configured — set the OVERSIGHT_EMAILS secret on this function.",
        }),
        { status: 200 },
      );
    }

    const offeringRows = offerings
      .map(
        (o) =>
          `<tr>
             <td style="padding:6px 0; color:#57534e;">${fmtDate(o.service_date)} — ${o.service_name}</td>
             <td style="padding:6px 0; text-align:right; color:#1c1917; font-weight:600;">${fmtUsd(Number(o.total_amount ?? 0))}</td>
           </tr>`,
      )
      .join("");

    const html = shell(
      `<h2 style="color:#1c1917; font-size:20px;">Weekly summary — ${fmtDate(start)} to ${fmtDate(end)}</h2>
       <p style="color:#a8a29e; font-size:13px;">A stewardship snapshot for ${fmtDate(start)} – ${fmtDate(end)}.</p>

       <table style="width:100%; border-collapse:collapse; margin-top:8px;">
         <tr>
           <td style="padding:10px 12px; background:#f5f5f4; border-radius:8px;">
             <div style="color:#78716c; font-size:12px;">Offerings (cash + checks)</div>
             <div style="color:#1c1917; font-size:22px; font-weight:700;">${fmtUsd(offeringsTotal)}</div>
           </td>
           <td style="width:12px;"></td>
           <td style="padding:10px 12px; background:#f5f5f4; border-radius:8px;">
             <div style="color:#78716c; font-size:12px;">Online &amp; standalone gifts</div>
             <div style="color:#1c1917; font-size:22px; font-weight:700;">${fmtUsd(onlineGifts)}</div>
           </td>
         </tr>
         <tr>
           <td style="padding:10px 12px; background:#f5f5f4; border-radius:8px;">
             <div style="color:#78716c; font-size:12px;">Expenses cleared</div>
             <div style="color:#1c1917; font-size:22px; font-weight:700;">${fmtUsd(paidTotal)}</div>
           </td>
           <td style="width:12px;"></td>
           <td style="padding:10px 12px; background:#f5f5f4; border-radius:8px;">
             <div style="color:#78716c; font-size:12px;">Net position</div>
             <div style="color:${income - paidTotal >= 0 ? "#15803d" : "#b91c1c"}; font-size:22px; font-weight:700;">${fmtUsd(income - paidTotal)}</div>
           </td>
         </tr>
       </table>

       <div style="margin-top:20px;">
         <div style="font-weight:600; color:#1c1917;">Offerings this week</div>
         ${offerings.length === 0
           ? `<p style="color:#a8a29e; font-size:13px;">No offerings recorded in this period.</p>`
           : `<table style="width:100%; border-collapse:collapse; font-size:14px;">${offeringRows}</table>`}
       </div>

       <div style="margin-top:16px; padding:12px; background:#f7f1e7; border-radius:8px; font-size:13px; color:#57534e;">
         Cash (net) <strong style="float:right;">${fmtUsd(cashNet)}</strong><br/>
         Checks <strong style="float:right;">${fmtUsd(checks)}</strong><br/>
         ${pendingTotal > 0 ? `Awaiting payment (approved/pending) <strong style="float:right;">${fmtUsd(pendingTotal)}</strong>` : ""}
       </div>

       <p style="color:#a8a29e; font-size:13px; margin-top:16px;">
         Sign in to the stewardship portal for full weekly, monthly, and yearly reports.
       </p>`,
      "Automated weekly summary from the stewardship portal.",
    );

    const results = await Promise.allSettled(
      to.map((email) =>
        resend.emails.send({
          from: FROM,
          to: email,
          subject: `Weekly summary — ${fmtDate(start)} to ${fmtDate(end)}`,
          html,
        }),
      ),
    );
    const sent = results.filter((r) => r.status === "fulfilled").length;

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        weekStart: start,
        weekEnd: end,
        offerings: offerings.length,
        offeringsTotal,
        cashNet,
        checks,
        onlineGifts,
        paidTotal,
        pendingTotal,
        net: income - paidTotal,
      }),
      { status: 200 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
