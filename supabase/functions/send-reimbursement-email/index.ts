import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const resend = new Resend(RESEND_API_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const { expense_id } = await req.json();
    if (!expense_id) {
      return new Response(JSON.stringify({ error: "Missing expense_id" }), { status: 400 });
    }

    // Fetch the expense with submitter info
    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .select("id, amount, title, description, status, user_id")
      .eq("id", expense_id)
      .maybeSingle();

    if (expErr || !expense) {
      return new Response(JSON.stringify({ error: "Expense not found" }), { status: 404 });
    }

    if (!expense.user_id) {
      return new Response(JSON.stringify({ error: "No submitter for this expense" }), { status: 400 });
    }

    // Fetch submitter's email
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", expense.user_id)
      .maybeSingle();

    if (!profile?.email) {
      return new Response(JSON.stringify({ error: "Submitter email not found" }), { status: 404 });
    }

    const expenseTitle = expense.title || expense.description || "Expense";
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(expense.amount));

    const statusLabel =
      expense.status === "paid" || expense.status === "auto_paid"
        ? "cleared and reimbursed"
        : "updated";

    await resend.emails.send({
      from: "GraceLedger <notifications@graceledger.org>",
      to: profile.email,
      subject: `Your reimbursement has been ${statusLabel}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1c1917; font-size: 20px;">Your reimbursement has been ${statusLabel}</h2>
          <p style="color: #57534e;">${profile.full_name ?? "Hello"},</p>
          <p style="color: #57534e;">
            Your expense <strong>${expenseTitle}</strong> for <strong>${amount}</strong>
            has been ${statusLabel}. The funds should appear in your account according to
            your church's standard transfer timeline.
          </p>
          <div style="margin-top: 24px; padding: 16px; background: #f7f1e7; border-radius: 8px; color: #78716c; font-size: 13px;">
            This is an automated message from GraceLedger. If you have questions about this
            reimbursement, please contact your church treasurer directly.
          </div>
        </div>
      `,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
