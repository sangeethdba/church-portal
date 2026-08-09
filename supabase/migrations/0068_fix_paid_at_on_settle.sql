-- Migration 0068: "✓ settled —" — paid_at never persisted when marking paid.
--
-- Symptom: after "Clear reimbursement" (Mark Paid) + transfer receipt, the row
-- shows status paid with "✓ Transfer receipt attached", but the settled line
-- reads "✓ settled —" after refresh.
--
-- Root cause: the app only sent p_status/p_payment_method/p_transfer_receipt_path
-- to admin_update_expense. The RPC sets paid_at only from p_paid_at (or from
-- p_submitted_at for auto_paid back-dates), so for member reimbursements the
-- column stayed NULL → formatDate(NULL) renders "—".
--
-- Fix: when a transition sets status to 'paid', write paid_at = now() as a
-- fallback (p_paid_at still wins when provided), and backfill existing rows.
--
-- Supersedes 0066's admin_update_expense — same signature, one overload.
-- Run once in Supabase → SQL Editor.

create or replace function public.admin_update_expense(
  p_expense_id      uuid,
  p_status          text default null,
  p_admin_note      text default null,
  p_paid_at         timestamptz default null,
  p_transfer_receipt_path text default null,
  p_title           text default null,
  p_description     text default null,
  p_category        text default null,
  p_amount          numeric default null,
  p_submitted_at    timestamptz default null,
  p_payment_method  text default null,
  p_check_number    text default null,
  p_card_last4      text default null,
  p_event_name      text default null,
  p_notes           text default null,
  p_user_id         uuid default null,      -- link to member → member reimbursement
  p_clear_member    boolean default false   -- detach → church-direct
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call from public.profiles where id = auth.uid();
  if not found or v_call.role::text not in ('admin','treasurer','super_admin') then
    raise exception 'Only admins can update expenses.';
  end if;

  if p_amount is not null and p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_category is not null then
    perform p_category::public.expense_category;
  end if;
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That member profile does not exist.';
  end if;

  update public.expenses e
  set
    status     = coalesce(p_status::public.expense_status, status),
    admin_note = coalesce(p_admin_note, admin_note),
    admin_note_at = case when p_admin_note is not null then now() else admin_note_at end,
    approved_at = case
                    when p_submitted_at is not null and e.status = 'auto_paid' then p_submitted_at
                    when p_status = 'approved' then now()
                    else approved_at
                  end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    paid_at    = case
                   when p_submitted_at is not null and e.status = 'auto_paid' then p_submitted_at
                   when p_paid_at is not null then p_paid_at
                   when p_status = 'paid' then now()          -- ← never settle with a NULL date
                   else paid_at
                 end,
    paid_by    = case when p_status = 'paid' then auth.uid() else paid_by end,
    transfer_receipt_path = coalesce(p_transfer_receipt_path, transfer_receipt_path),
    title            = coalesce(p_title, title),
    description      = coalesce(p_description, description),
    category         = case when p_category is not null then p_category::public.expense_category else category end,
    amount           = coalesce(p_amount, amount),
    submitted_at     = coalesce(p_submitted_at, submitted_at),
    payment_method   = coalesce(p_payment_method, payment_method),
    check_number     = coalesce(p_check_number, check_number),
    card_last4       = coalesce(p_card_last4, card_last4),
    event_name       = coalesce(p_event_name, event_name),
    notes            = coalesce(p_notes, notes),
    user_id          = case
                         when p_clear_member then null
                         when p_user_id is not null then p_user_id
                         else user_id
                       end,
    source           = case
                         when p_clear_member then 'church_direct'::public.expense_source
                         when p_user_id is not null then 'member_submitted'::public.expense_source
                         else source
                       end
  where e.id = p_expense_id;
end $$;

-- ── Backfill: any settled row still missing a settled date ──────────────
-- Prefer the existing approval/submission date over "now" so historical
-- auto-settled imports keep their statement date.
update public.expenses
set paid_at = coalesce(paid_at, approved_at, submitted_at, now())
where status in ('paid', 'auto_paid')
  and paid_at is null;
