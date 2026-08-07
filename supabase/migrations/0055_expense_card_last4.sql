-- Migration 0055: track which card a purchase was made on.
--
-- The church account has multiple cards (treasurer, pastor, member) and BOA
-- groups card purchases under "Card account # XXXX XXXX XXXX 5375" headers.
-- Storing the last 4 digits lets the ledger show which card/whose purchases
-- each expense came from.
alter table public.expenses
  add column if not exists card_last4 text;

-- Re-define admin_insert_expense with the new optional p_card_last4 param
-- (supersedes 0054 — member reimbursement behavior is preserved).
create or replace function public.admin_insert_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_payment_method text default null,
  p_check_number text default null,
  p_user_id      uuid default null,   -- member profile id → member reimbursement
  p_card_last4   text default null    -- card used for this purchase (last 4)
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
  v_expense_id uuid;
begin
  -- Only admin / treasurer / super_admin
  select * into v_call from public.profiles where id = auth.uid();
  if not found or v_call.role::text not in ('admin','treasurer','super_admin') then
    raise exception 'Only admins can record expenses.';
  end if;

  if p_user_id is not null then
    -- Zelle payment made TO a member: record as their reimbursement, already settled.
    insert into public.expenses (
      source, title, amount, category, description, notes,
      event_name, payment_method, check_number, card_last4,
      user_id, status, submitted_at, approved_at, paid_at
    ) values (
      'member_submitted',
      p_title,
      p_amount,
      p_category::public.expense_category,
      p_description,
      p_notes,
      p_event_name,
      p_payment_method,
      p_check_number,
      p_card_last4,
      p_user_id,
      'auto_paid',
      now(),
      now(),
      now()
    )
    returning id into v_expense_id;
  else
    insert into public.expenses (
      source, title, amount, category, description, notes,
      event_name, payment_method, check_number, card_last4,
      user_id, status, submitted_at, approved_at, paid_at
    ) values (
      'church_direct',
      p_title,
      p_amount,
      p_category::public.expense_category,
      p_description,
      p_notes,
      p_event_name,
      p_payment_method,
      p_check_number,
      p_card_last4,
      auth.uid(),
      'auto_paid',
      now(),
      now(),
      now()
    )
    returning id into v_expense_id;
  end if;

  return v_expense_id;
end $$;
