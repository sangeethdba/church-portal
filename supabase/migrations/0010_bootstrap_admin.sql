-- ============================================================================
-- GraceLedger — admin bootstrap (fixes first-user lockout)
-- Run in Supabase SQL editor after 0009_portal_access.sql.
-- ============================================================================

-- 1. RPC: promote the calling user to admin + portal access IF no admin-level
--    profile exists yet. This is a self-healing bootstrap so the very first
--    person to sign in (pastor/treasurer) can never be locked out by the
--    approval gate. Idempotent: returns true only when it actually promotes.
create or replace function public.bootstrap_first_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set role = 'admin', portal_access = true
  where id = auth.uid()
    and not exists (
      select 1 from public.profiles
      where role in ('admin', 'treasurer', 'super_admin')
    );
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'treasurer', 'super_admin')
  );
$$;

grant execute on function public.bootstrap_first_admin() to authenticated;

-- 2. First sign-up becomes admin automatically (fresh databases).
--    Replaces handle_new_user so the first ever profile gets admin rights.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, portal_access)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when not exists (select 1 from public.profiles)
         then 'admin' else 'member' end,
    not exists (select 1 from public.profiles)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Backfill: any existing admin-level profile gets portal_access so the
--    approval gate never blocks a super_admin / treasurer again.
update public.profiles
set portal_access = true
where role in ('admin', 'treasurer', 'super_admin')
  and portal_access = false;
