-- ============================================================================
-- GraceLedger — final fix for handle_new_user trigger with proper type
-- casting for the app_role enum.  Also backfills any orphaned auth.users
-- rows that were created while the trigger was broken.
-- ============================================================================

-- 1. Backfill profiles for any auth user who still doesn't have one.
insert into public.profiles (id, email, full_name, role, portal_access)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  'member'::app_role,
  false
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 2. Replace handle_new_user with a version that properly casts to
--    app_role and uses on-conflict-update so it never silently drops rows.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  admin_exists boolean;
begin
  select exists (
    select 1 from public.profiles
    where role::text in ('admin', 'treasurer', 'super_admin')
  ) into admin_exists;

  insert into public.profiles (id, email, full_name, role, portal_access)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    (case when admin_exists then 'member' else 'admin' end)::app_role,
    not admin_exists
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name);

  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
