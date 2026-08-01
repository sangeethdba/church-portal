-- Migration 0034: Fix handle_new_user trigger — qualify app_role type
-- Root cause: search_path = '' means the trigger can't find the app_role enum type.
-- The cast `end::app_role` silently fails, exception handler swallows it,
-- and no profile is ever created for new Google sign-ins.

-- Also create bootstrap_first_admin if it doesn't exist (RequireAuth depends on it)
create or replace function public.bootstrap_first_admin()
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  admin_count int;
  uid uuid := auth.uid();
begin
  select count(*) into admin_count from public.profiles
  where role::text in ('admin', 'treasurer', 'super_admin');
  if admin_count = 0 and uid is not null then
    update public.profiles
    set role = 'admin'::public.app_role, portal_access = true
    where id = uid;
    return true;
  end if;
  return false;
end $$;

-- Fix handle_new_user: use fully qualified type casts
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  existing public.profiles;
  admin_exists boolean;
begin
  -- Check if this email already has a profile (dedup guard)
  select * into existing from public.profiles where email = new.email limit 1;
  if found then
    return new;
  end if;

  -- Is there already an admin in the system?
  select exists (
    select 1 from public.profiles
    where role::text in ('admin', 'treasurer', 'super_admin')
  ) into admin_exists;

  -- Insert with fully-qualified type cast (critical fix!)
  insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when admin_exists then 'member' else 'admin' end::public.app_role,
    not admin_exists,
    false
  );

  return new;
exception when others then
  raise warning 'handle_new_user failed for %: % (SQLSTATE: %)',
    new.email, sqlerrm, sqlstate;
  return new;
end $$;

-- Recreate trigger (ensures it's attached to the latest function)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
