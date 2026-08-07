-- Migration 0054: admin_insert_expense learns how to record member reimbursements.
--
-- The bulk import (BOA statement) sees Zelle payments TO members, e.g.
--   "Zelle payment to EPARAIM for 'VBS books and other sunday school'" -500.00
-- That is a reimbursement: the member spent their own money and the church paid
-- them back. When p_user_id is supplied, the expense is recorded as a
-- member_submitted, auto_paid row linked to that member so it appears in their
-- "My giving & bills" as reimbursed — instead of a church-direct outlay.
create or replace function public.admin_insert_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_payment_method text default null,
  p_check_number text default null,
  p_user_id      uuid default null   -- member profile id → member reimbursement
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
    -- Zelle payment made TO a member: record as their reimbursement, already
    -- settled (the money left the bank account when the Zelle was sent).
    insert into public.expenses (
      source, title, amount, category, description, notes,
      event_name, payment_method, check_number,
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
      event_name, payment_method, check_number,
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
