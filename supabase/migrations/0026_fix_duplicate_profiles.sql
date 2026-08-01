-- ============================================================================
-- GraceLedger — fix duplicate profiles created by Google OAuth re-auth
--
-- Problem: Google OAuth sometimes mints a new auth.users UUID for the same
-- email.  The old handle_new_user trigger created a second profile row
-- instead of re-linking the existing one, so admins saw the member view.
--
-- Fix: on INSERT into auth.users, if a profile with the same email already
-- exists, update its UUID to the new auth id.  Only insert a fresh row when
-- the email is genuinely new.  Also clean up any existing duplicates.
-- ============================================================================

-- 1. Merge duplicate profiles: keep the FIRST (oldest) row for each email,
--    delete the newer duplicates after copying their data into the keeper.
do $$
declare
  rec record;
begin
  for rec in
    select email, array_agg(id order by created_at) as ids
    from public.profiles
    group by email
    having count(*) > 1
  loop
    -- Update the keeper (oldest) with any extra data from the duplicates,
    -- then delete the duplicates.  The keeper keeps its original role.
    update public.profiles
    set portal_access = true  -- if any duplicate had access, grant it
    where id = rec.ids[1]
      and exists (
        select 1 from public.profiles p2
        where p2.id = any(rec.ids[2:]) and p2.portal_access = true
      );

    -- Delete newer duplicates
    delete from public.profiles where id = any(rec.ids[2:]);
  end loop;
end $$;

-- 2. Replace handle_new_user: on email collision, re-link (update UUID)
--    instead of inserting a duplicate.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  existing_id uuid;
  admin_exists boolean;
begin
  -- Check if this email already has a profile (from a previous auth UUID)
  select id into existing_id
  from public.profiles
  where email = new.email
  limit 1;

  if found then
    -- Re-link: update the existing profile's UUID to the new auth id
    update public.profiles
    set id = new.id,
        full_name = coalesce(full_name,
          coalesce(new.raw_user_meta_data ->> 'full_name',
                   split_part(new.email, '@', 1)))
    where id = existing_id;
    return new;
  end if;

  -- Genuinely new user: check if any admin exists
  select exists (
    select 1 from public.profiles
    where role::text in ('admin', 'treasurer', 'super_admin')
  ) into admin_exists;

  insert into public.profiles (id, email, full_name, role, portal_access)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name',
             split_part(new.email, '@', 1)),
    (case when admin_exists then 'member' else 'admin' end)::app_role,
    not admin_exists
  );

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

-- 3. Verify no duplicates remain
select email, count(*) as cnt
from public.profiles
group by email
having count(*) > 1;
