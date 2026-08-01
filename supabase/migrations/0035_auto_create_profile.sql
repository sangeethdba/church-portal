-- Migration 0035: Make get_my_profile auto-create missing profiles.
-- This completely bypasses the handle_new_user trigger, which has been
-- silently failing due to search_path issues and type-cast problems.
-- Now every authenticated user is guaranteed a profile.

create or replace function public.get_my_profile()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles;
  ae text;
  admin_exists boolean;
begin
  -- Get the caller's email from auth.users
  select u.email into ae from auth.users u where u.id = auth.uid();
  if ae is null then return null; end if;

  -- Try UUID match first
  select * into pr from public.profiles where id = auth.uid();
  if found then return to_jsonb(pr); end if;

  -- Try email fallback
  select * into pr from public.profiles where email = ae limit 1;
  if found then return to_jsonb(pr); end if;

  -- Profile doesn't exist — create it now (bypass the broken trigger)
  select exists (
    select 1 from public.profiles
    where role::text in ('admin','treasurer','super_admin')
  ) into admin_exists;

  insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
  values (
    auth.uid(),
    ae,
    coalesce(
      (select raw_user_meta_data ->> 'full_name' from auth.users where id = auth.uid()),
      split_part(ae, '@', 1)
    ),
    case when admin_exists then 'member' else 'admin' end::public.app_role,
    not admin_exists,
    false
  )
  returning * into pr;

  return to_jsonb(pr);
end $$;

-- Also fix _get_caller_info to auto-create missing profiles
create or replace function public._get_caller_info()
returns table (uid uuid, email text, is_admin boolean, profile_row public.profiles)
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
  e text;
  admin_exists boolean;
begin
  uid := auth.uid();
  select u.email into e from auth.users u where u.id = uid;
  if e is null then return; end if;

  -- Try to find existing profile
  select * into p from public.profiles where id = uid;
  if not found then
    select * into p from public.profiles where email = e limit 1;
  end if;

  -- If still not found, create it
  if p is null then
    select exists (
      select 1 from public.profiles
      where role::text in ('admin','treasurer','super_admin')
    ) into admin_exists;

    insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
    values (
      uid, e,
      coalesce(
        (select raw_user_meta_data ->> 'full_name' from auth.users where id = uid),
        split_part(e, '@', 1)
      ),
      case when admin_exists then 'member' else 'admin' end::public.app_role,
      not admin_exists, false
    )
    returning * into p;
  end if;

  email := e;
  profile_row := p;
  is_admin := p.role::text in ('admin','treasurer','super_admin');
  return next;
end $$;
