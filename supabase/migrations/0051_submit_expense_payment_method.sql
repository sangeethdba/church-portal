-- ============================================================================
-- 0051_submit_expense_payment_method.sql
--
-- The front-end now sends p_payment_method on member reimbursement calls,
-- but migration 0037 defined submit_expense without that parameter.  This
-- migration adds it so the column is populated when members submit expenses.
--
-- Also adds p_payment_method & p_check_number to admin_update_expense so
-- admins can update the method after submission.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Re-create submit_expense with p_payment_method
drop function if exists public.submit_expense(text,numeric,text,text,text,text,jsonb);
drop function if exists public.submit_expense(text,numeric,text,text,text,text,text,jsonb);

create or replace function public.submit_expense(
  p_title text,
  p_amount numeric,
  p_category text,
  p_description text default null,
  p_notes text default null,
  p_event_name text default null,
  p_payment_method text default null,
  p_line_items jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No profile found for this user. Please sign out and back in.';
  end if;

  insert into public.expenses (
    source, title, amount, category, description, notes,
    event_name, payment_method, line_items, user_id, status, submitted_at
  ) values (
    'member_submitted',
    p_title,
    p_amount,
    p_category::public.expense_category,
    p_description,
    p_notes,
    p_event_name,
    p_payment_method,
    p_line_items,
    auth.uid(),
    'pending',
    now()
  )
  returning id into v_expense_id;

  return v_expense_id;
end $$;

grant execute on function public.submit_expense(text,numeric,text,text,text,text,text,jsonb) to authenticated;

-- 2. Re-create admin_update_expense to accept payment_method updates
drop function if exists public.admin_update_expense(uuid,text,text,timestamptz,text,text);
drop function if exists public.admin_update_expense(uuid,text,text,timestamptz,text,text,text);

create or replace function public.admin_update_expense(
  p_expense_id uuid,
  p_status text default null,
  p_admin_note text default null,
  p_paid_at timestamptz default null,
  p_transfer_receipt_path text default null,
  p_payment_method text default null,
  p_check_number text default null
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

  update public.expenses
  set
    status = coalesce(p_status::public.expense_status, status),
    admin_note = coalesce(p_admin_note, admin_note),
    admin_note_at = case when p_admin_note is not null then now() else admin_note_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    paid_at = coalesce(p_paid_at, paid_at),
    paid_by = case when p_status = 'paid' then auth.uid() else paid_by end,
    transfer_receipt_path = coalesce(p_transfer_receipt_path, transfer_receipt_path),
    payment_method = coalesce(p_payment_method, payment_method),
    check_number = coalesce(p_check_number, check_number)
  where id = p_expense_id;
end $$;

grant execute on function public.admin_update_expense(uuid,text,text,timestamptz,text,text,text) to authenticated;
