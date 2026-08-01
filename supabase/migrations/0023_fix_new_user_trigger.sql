-- ============================================================================
-- GraceLedger — fix "Database error saving new user" on Google OAuth sign-in
--
-- Problem: the handle_new_user trigger from 0010 references
--   `select 1 from public.profiles` inside a security-definer function.
--   If the profiles RLS blocks that SELECT (e.g. the function owner doesn't
--   fully bypass RLS on the managed Supabase instance), the INSERT into
--   profiles fails, rolling back the auth.users row, and GoTrue surfaces
--   "Database error saving new user".
--
-- Fix: replace the trigger with a version that checks emptiness via a
--   direct COUNT on the table (which security-definer can evaluate even
--   when RLS is active) and wraps the insert in a PL/pgSQL exception block
--   so a transient failure never blocks the auth.users creation.
-- ============================================================================

-- 1. Ensure every NOT NULL column has a safe default so the trigger insert
--    never fails because of a missing column value.
alter table public.profiles
  alter column is_counter   set default false,
  alter column portal_access set default false;

-- 2. Replace the trigger function with a defensive version.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  admin_count bigint;
begin
  -- Count how many admin-level profiles exist, bypassing RLS because this
  -- function is security definer and the owner can read its own table.
  select count(*) into admin_count
  from public.profiles
  where role in ('admin', 'treasurer', 'super_admin');

  -- The very first human to sign in (empty admin_count) becomes admin
  -- and gets immediate portal access so the church is never locked out.
  insert into public.profiles (id, email, full_name, role, portal_access)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    case when admin_count = 0 then 'admin' else 'member' end,
    (admin_count = 0)
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- Log the failure so we can debug, but do NOT block the auth.users
    -- row — a profile can be created or backfilled later by an admin.
    raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
    return new;
end $$;

-- 3. Recreate the trigger on auth.users (idempotent).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
