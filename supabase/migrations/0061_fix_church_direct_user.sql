-- Migration 0061: church-direct expenses must NOT carry a member user_id.
--
-- Bug: admin_insert_expense stamped church-direct rows with user_id = auth.uid()
-- (the importing admin/treasurer). That made every bulk-imported expense appear
-- "linked" to the admin in the Edit dialog's member dropdown. user_id means
-- "the member this belongs to" — church-direct outlays belong to nobody.
--
-- Fix: insert church-direct rows with user_id = null, and clean up existing rows.
-- (supersedes 0058's admin_insert_expense — member reimbursement + card_last4 +
-- statement-date behavior preserved)
--
-- Run once in Supabase → SQL Editor.

create or replace function public.admin_insert_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_payment_method text default null,
  p_check_number text default null,
  p_user_id      uuid default null,        -- member profile id → member reimbursement
  p_card_last4   text default null,        -- card used for this purchase (last 4)
  p_submitted_at timestamptz default null  -- bank-statement posted date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
  v_expense_id uuid;
  v_date timestamptz := coalesce(p_submitted_at, now());
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
      v_date,
      v_date,
      v_date
    )
    returning id into v_expense_id;
  else
    -- Church-direct outlay: belongs to the church, not to any member profile.
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
      null,
      'auto_paid',
      v_date,
      v_date,
      v_date
    )
    returning id into v_expense_id;
  end if;

  return v_expense_id;
end $$;

-- Clean up rows imported before this fix: church-direct expenses linked to the
-- importing admin's profile id are not member records.
update public.expenses
  set user_id = null
  where source = 'church_direct'
    and user_id is not null;
