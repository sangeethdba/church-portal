-- 0017: Expense clarification flow.
-- Before approving or rejecting a member submission, an admin can send a
-- clarification note; the member replies; only then does the admin approve or
-- reject. An expense is only "completed" once the bank transfer receipt is
-- uploaded (Clear reimbursement) — approval is not settlement.
--
-- Per-bill "no receipt" explanations live inside the jsonb line_items array
-- (no_receipt_note key), so no schema change is needed for those.

alter table public.expenses
  add column if not exists admin_note text,
  add column if not exists admin_note_at timestamptz,
  add column if not exists member_reply text,
  add column if not exists member_reply_at timestamptz;

-- Members cannot UPDATE their own expenses via RLS (updates are admin-only),
-- so the reply must go through this security-definer RPC, which verifies that
-- the caller owns the expense and that it is still pending.
create or replace function public.reply_to_expense(p_expense_id uuid, p_reply text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  updated integer;
begin
  if p_reply is null or length(trim(p_reply)) = 0 then
    return false;
  end if;

  update public.expenses
     set member_reply = trim(p_reply),
         member_reply_at = now()
   where id = p_expense_id
     and user_id = auth.uid()
     and status = 'pending';

  get diagnostics updated = row_count;
  return updated > 0;
end $$;

revoke all on function public.reply_to_expense(uuid, text) from public;
grant execute on function public.reply_to_expense(uuid, text) to authenticated;
