-- Migration 0067: member reimbursements show "—" for payment method.
--
-- Why: migration 0037's submit_expense omitted payment_method entirely, so the
-- column default 'online' (from 0007) filled it — old submissions show "online".
-- Migration 0051 then added p_payment_method default null, and the member
-- submission form has no method picker, so the client never passes it — every
-- new member submission stores NULL → the Method column renders "—".
--
-- Fix: default p_payment_method to 'online' (members are reimbursed by Zelle),
-- coalesce at insert so it can never store NULL, and backfill existing rows.
--
-- Also mirrors 0066: drop every overload of submit_expense before recreating,
-- so PostgREST can always resolve the call.
--
-- Run once in Supabase → SQL Editor.

-- ── 1. Drop every overload of submit_expense ────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_expense'
  loop
    execute format(
      'drop function public.submit_expense(%s)',
      pg_get_function_identity_arguments(r.oid)
    );
  end loop;
end $$;

-- ── 2. Recreate with payment method defaulting to 'online' ──────────────
create or replace function public.submit_expense(
  p_title text,
  p_amount numeric,
  p_category text,
  p_description text default null,
  p_notes text default null,
  p_event_name text default null,
  p_payment_method text default 'online',   -- was default null
  p_line_items jsonb default null
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
    event_name, payment_method, line_items, user_id, status, submitted_at
  ) values (
    'member_submitted',
    p_title,
    p_amount,
    p_category::public.expense_category,
    p_description,
    p_notes,
    p_event_name,
    coalesce(p_payment_method, 'online'),
    p_line_items,
    auth.uid(),
    'pending',
    now()
  )
  returning id into v_expense_id;

  return v_expense_id;
end $$;

-- ── 3. Backfill existing rows that stored NULL / empty ──────────────────
update public.expenses
set payment_method = 'online'
where payment_method is null or trim(coalesce(payment_method, '')) = '';
