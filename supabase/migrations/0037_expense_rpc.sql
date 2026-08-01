-- Migration 0037: Expense RPCs — security-definer functions that bypass RLS
-- for expense submission, listing, and updates.
-- 
-- The expense RLS policy requires `user_id = auth.uid()` on insert via
-- `expenses_member_insert`.  When the profile's id matches the JWT uid the
-- check passes, but edge cases (null profile, UUID mismatch after Google
-- re-auth) cause silent failures.  These RPCs eliminate that class of bug.
--
-- Similarly, the `is_admin_or_treasurer()` helper may fail when invoked from
-- a restricted `search_path` context.  Bypassing it here guarantees admin
-- users can always see and manage every expense.

-- ── submit_expense ──────────────────────────────────────────────────────
-- Members call this to submit a reimbursement request.  The function
-- enforces that user_id = auth.uid(), but does so server-side where the
-- JWT is reliable and there is no double-UUID mismatch issue.
create or replace function public.submit_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_line_items   jsonb default null
)
returns uuid   -- returns the newly created expense id
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid;
begin
  -- Verify the caller actually has a profile
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No profile found for this user. Please sign out and back in.';
  end if;

  insert into public.expenses (
    source, title, amount, category, description, notes,
    event_name, line_items, user_id, status, submitted_at
  ) values (
    'member_submitted',
    p_title,
    p_amount,
    p_category::public.expense_category,
    p_description,
    p_notes,
    p_event_name,
    p_line_items,
    auth.uid(),
    'pending',
    now()
  )
  returning id into v_expense_id;

  return v_expense_id;
end $$;

-- ── admin_insert_expense ────────────────────────────────────────────────
-- Admin/treasurer records a church-direct outlay (bank auto-debit).
create or replace function public.admin_insert_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_payment_method text default null,
  p_check_number text default null
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
    raise exception 'Only admins can record church-direct expenses.';
  end if;

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

  return v_expense_id;
end $$;

-- ── list_expenses ───────────────────────────────────────────────────────
-- Returns all expenses the caller is allowed to see.  Admins see
-- everything; members see only their own submissions.
create or replace function public.list_expenses()
returns setof public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call from public.profiles where id = auth.uid();

  if found and v_call.role::text in ('admin','treasurer','super_admin') then
    return query
      select * from public.expenses
      order by submitted_at desc;
  else
    return query
      select * from public.expenses
      where user_id = auth.uid()
      order by submitted_at desc;
  end if;
end $$;

-- ── admin_update_expense ────────────────────────────────────────────────
-- Admin operations: approve, reject, mark paid, add admin note, etc.
create or replace function public.admin_update_expense(
  p_expense_id uuid,
  p_status     text default null,
  p_admin_note text default null,
  p_paid_at    timestamptz default null
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
    status     = coalesce(p_status::public.expense_status, status),
    admin_note = coalesce(p_admin_note, admin_note),
    admin_note_at = case when p_admin_note is not null then now() else admin_note_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    paid_at    = coalesce(p_paid_at, paid_at),
    paid_by    = case when p_status = 'paid' then auth.uid() else paid_by end
  where id = p_expense_id;
end $$;
