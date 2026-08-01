-- ============================================================================
-- FINAL FIX: Prevent duplicate profiles when Google re-auth creates new UUID.
-- 1. handle_new_user checks email first (skip insert if profile exists)
-- 2. get_my_profile falls back to email lookup (no UUID re-link attempt)
-- 3. Clean up any existing duplicates
-- ============================================================================

-- 1. Clean up any orphan profiles (auth.users deleted)
delete from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id);

-- 2. Fix handle_new_user: check by email FIRST, never create duplicates
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  existing public.profiles;
  admin_exists boolean;
begin
  -- Check if this email already has a profile (prevent duplicates)
  select * into existing from public.profiles where email = new.email limit 1;
  if found then
    return new;
  end if;

  -- First user gets admin, rest get member with portal_access=false
  select exists (
    select 1 from public.profiles where role::text in ('admin','treasurer','super_admin')
  ) into admin_exists;

  insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when admin_exists then 'member' else 'admin' end::app_role,
    not admin_exists,
    false
  );

  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Fix get_my_profile: email fallback, no UUID re-link (FK constraints block it)
create or replace function public.get_my_profile()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  profile_row public.profiles;
  auth_email text;
begin
  select email into auth_email from auth.users where id = auth.uid();

  -- Try UUID first
  select * into profile_row from public.profiles where id = auth.uid();
  if found then return to_jsonb(profile_row); end if;

  -- Fallback: find by email
  if auth_email is not null then
    select * into profile_row from public.profiles where email = auth_email limit 1;
    if found then return to_jsonb(profile_row); end if;
  end if;

  return null;
end $$;

-- 4. Fix the shared helper used by dashboard/reports RPCs
create or replace function public._get_caller_info()
returns table (
  uid uuid,
  email text,
  is_admin boolean,
  profile_row public.profiles
)
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
  e text;
begin
  uid := auth.uid();
  select u.email into e from auth.users u where u.id = uid;

  -- Try UUID first
  select * into p from public.profiles where id = uid;

  -- Fallback: email lookup
  if not found and e is not null then
    select * into p from public.profiles where email = e limit 1;
  end if;

  email := e;
  profile_row := p;
  is_admin := p.role::text in ('admin', 'treasurer', 'super_admin');

  return next;
end $$;

-- 5. Verify
select p.email, p.full_name, p.role, p.portal_access from public.profiles p order by p.created_at;
