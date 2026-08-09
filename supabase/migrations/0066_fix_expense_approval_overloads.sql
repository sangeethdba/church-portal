-- Migration 0066: approval not persisting — admin_update_expense overload pile-up.
--
-- Symptom: clicking Approve/Reject/"Clear reimbursement" appears to work for a
-- moment (optimistic UI) but the row is still "pending" after a refresh.
--
-- Root cause: `create or replace` with a NEW signature ADDS an overload; it
-- never replaces the old one. Across 0037 → 0039 → 0051 → 0058 → 0059 → 0065
-- the database accumulated up to six overloads of admin_update_expense
-- (the 0051 drops targeted signatures that did not exist yet). PostgREST then
-- cannot reliably choose between them for a call like
--   rpc("admin_update_expense", { p_expense_id, p_status })
-- so the call fails and the client silently swallowed the error.
--
-- Fix: drop EVERY overload, then recreate the single current definition
-- (identical to 0065). Safe to re-run anytime.
--
-- Run once in Supabase → SQL Editor.

-- ── 1. Drop every overload of admin_update_expense ──────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_update_expense'
  loop
    execute format(
      'drop function public.admin_update_expense(%s)',
      pg_get_function_identity_arguments(r.oid)
    );
  end loop;
end $$;

-- ── 2. Recreate the single current version (supersedes 0065) ────────────
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
                   else coalesce(p_paid_at, paid_at)
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

-- ── 3. Sanity: exactly one overload should remain ───────────────────────
-- Run afterwards:
--   select p.oid::regprocedure from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'admin_update_expense';
