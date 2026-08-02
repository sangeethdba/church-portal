-- 0046: Revert auto-link — restore safe handle_new_user trigger
-- Migration 0046 previously added auto-linking by Google full_name,
-- which is risky (email != real name).  This restores the original
-- trigger that creates profiles WITHOUT auto-linking.
-- 
-- Admin-controlled linking via Dashboard → Manage members & access
-- is the correct workflow.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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
