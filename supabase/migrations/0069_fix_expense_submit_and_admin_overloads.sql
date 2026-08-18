-- Migration 0069: expense submission fails for logged-in members, and admin
-- "Save expense" fails with an overload resolution error.
--
-- Bug 1 — "No profile found for this user" on member submissions.
--   submit_expense checked `exists (select 1 from profiles where id = auth.uid())`
--   strictly by UUID. get_my_profile (0035) resolves members by UUID, then by
--   EMAIL, then auto-creates the row. Google re-auth sometimes mints a new
--   auth.users UUID for the same email (see 0026), so the member stays signed
--   in through their email-matched profile — but submit_expense's strict id
--   check finds nothing and raises "No profile found for this user", which the
--   old client swallowed, so "Submit expense" appeared to do nothing. The read
--   paths (list_expenses, expenses_self_read RLS) also keyed strictly off
--   auth.uid(), so even a saved row would vanish from the member's own view.
--   Fix: resolve the member profile by UUID → email → auto-create (new
--   my_profile_id() helper mirroring get_my_profile) and use that profile's id
--   consistently in submit_expense, list_expenses, and the read policy.
--
-- Bug 2 — PGRST203 "Could not choose the best candidate function" on
--   admin_insert_expense. Migrations 0037 → 0054 → 0055 → 0058 → 0061
--   recreated it with growing signatures but never dropped the old overloads,
--   so production now holds three of them. PostgREST cannot pick one, so admin
--   "Save expense" and bank-statement bulk imports fail before the body runs.
--   Fix: mirror 0066/0067 — drop EVERY overload, recreate the single 0061
--   definition.
--
-- Also backfills a profile row for every auth.users account missing one
-- (without creating email duplicates).
--
-- Safe to re-run. Run once in Supabase → SQL Editor.

-- ── 0. Shared member resolution helper ─────────────────────────────────
-- Resolve the caller's profile id exactly like get_my_profile: exact UUID
-- first, then email fallback (Google re-auth can change the UUID). Returns
-- null when the caller has no profile at all.
create or replace function public.my_profile_id()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_id uuid;
begin
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then return null; end if;

  select p.id into v_id
    from public.profiles p
    where p.id = auth.uid() or p.email = v_email
    order by (p.id = auth.uid()) desc
    limit 1;
  return v_id;
end $$;

-- ── 1. submit_expense — resolve the member; never reject a real member ──
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

create or replace function public.submit_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_payment_method text default 'online',
  p_line_items   jsonb default null
)
returns uuid   -- returns the newly created expense id
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid;
  v_uid uuid;
  v_email text;
  v_admin_exists boolean;
begin
  -- Resolve the member profile (UUID → email). A member whose auth.users UUID
  -- changed after Google re-auth still has a profile matched by email — never
  -- reject them with "No profile found".
  v_uid := public.my_profile_id();

  if v_uid is null then
    -- No profile at all — auto-create one (mirrors get_my_profile's fallback).
    select u.email into v_email from auth.users u where u.id = auth.uid();
    if v_email is null then
      raise exception 'Not signed in. Please sign out and back in.';
    end if;
    select exists (
      select 1 from public.profiles
      where role::text in ('admin','treasurer','super_admin')
    ) into v_admin_exists;

    insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
    values (
      auth.uid(),
      v_email,
      coalesce(
        (select raw_user_meta_data ->> 'full_name' from auth.users where id = auth.uid()),
        split_part(v_email, '@', 1)
      ),
      (case when v_admin_exists then 'member' else 'admin' end)::public.app_role,
      not v_admin_exists,
      false
    )
    returning id into v_uid;
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
    v_uid,
    'pending',
    now()
  )
  returning id into v_expense_id;

  return v_expense_id;
end $$;

-- ── 2. admin_insert_expense — drop the overload pile-up ────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_insert_expense'
  loop
    execute format(
      'drop function public.admin_insert_expense(%s)',
      pg_get_function_identity_arguments(r.oid)
    );
  end loop;
end $$;

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
  -- Only admin / treasurer / super_admin — resolved via my_profile_id() so
  -- admins whose auth.users UUID changed still pass the role check.
  select * into v_call
    from public.profiles
    where id = public.my_profile_id()
    limit 1;
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

-- ── 3. list_expenses — members see rows keyed to their resolved profile ─
create or replace function public.list_expenses()
returns setof public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call
    from public.profiles
    where id = public.my_profile_id();

  if found and v_call.role::text in ('admin','treasurer','super_admin','pastor') then
    return query
      select * from public.expenses
      order by submitted_at desc;
  else
    return query
      select * from public.expenses
      where user_id = public.my_profile_id()
      order by submitted_at desc;
  end if;
end $$;

-- ── 4. RLS read policy — same profile resolution ──────────────────────
drop policy if exists expenses_self_read on public.expenses;
create policy expenses_self_read on public.expenses
  for select using (
    user_id = public.my_profile_id()
    or public.is_admin_or_treasurer()
  );

-- ── 5. Backfill: every auth user gets a profile row ───────────────────
-- Users whose email already matches a profile (the Google re-auth UUID change)
-- are intentionally left alone — their existing profile is what the email
-- fallback above resolves to.
insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  (case
    when exists (select 1 from public.profiles where role::text in ('admin','treasurer','super_admin'))
    then 'member' else 'admin'
  end)::public.app_role,
  true,
  false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
  and not exists (select 1 from public.profiles p where p.email = u.email);
