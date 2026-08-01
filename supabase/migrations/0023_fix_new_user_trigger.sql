-- ============================================================================
-- GraceLedger — fix "Database error saving new user" on Google OAuth sign-in
-- AND enforce the approval gate (portal_access = false for new members)
--
-- Problem 1: the old handle_new_user trigger from 0010 referenced
--   `select 1 from public.profiles` inside a security-definer function.
--   If the profiles RLS blocks that SELECT, the INSERT fails, rolling back
--   the auth.users row, and GoTrue surfaces "Database error saving new user".
--
-- Problem 2: some existing non-admin profiles may have portal_access = true
--   from prior broken trigger runs or manual edits, letting unapproved users
--   straight into the app.
--
-- Fix: replace the trigger, set safe defaults, and clean up stale data.
-- ============================================================================

-- 1. Ensure every NOT NULL column has a safe default.
alter table public.profiles
  alter column is_counter   set default false,
  alter column portal_access set default false;

-- 2. Clean up: revoke portal access from every non-admin member who
--    should not have it yet. Admins/treasurers keep their access.
update public.profiles
set portal_access = false
where portal_access = true
  and role not in ('admin', 'treasurer', 'super_admin');

-- 3. Replace the trigger function with a defensive version.
--    New users always start as 'member' with portal_access = false.
--    The very first user (no admins exist yet) is auto-promoted to admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  admin_count bigint;
begin
  -- Count how many admin-level profiles already exist.
  select count(*) into admin_count
  from public.profiles
  where role in ('admin', 'treasurer', 'super_admin');

  -- First-ever user → admin + immediate access.
  -- Everyone else   → member + must be approved by an admin.
  insert into public.profiles (id, email, full_name, role, portal_access)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    case when admin_count = 0 then 'admin' else 'member' end,
    case when admin_count = 0 then true   else false  end
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
    return new;
end $$;

-- 4. Recreate the trigger on auth.users (idempotent).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
