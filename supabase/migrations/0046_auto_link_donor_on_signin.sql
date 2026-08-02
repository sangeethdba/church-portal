-- 0046: Auto-link Google sign-ins to existing donors
-- When a user signs in with Google, the handle_new_user trigger creates
-- a profile row.  This migration enhances it to automatically find a
-- matching donor (by case-insensitive first+last name) and link both
-- sides.  If a match is found the member gets portal_access immediately
-- so they can see their giving history on the dashboard.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_exists   boolean;
  v_first        text;
  v_last         text;
  v_donor        record;
begin
  -- ── 1. Decide role / portal_access ──────────────────────────────────
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

  -- ── 2. Auto-link to existing donor by name ──────────────────────────
  -- Only for non-admin users (members) who signed in via Google.
  -- Split full_name into first / last and look for a matching donor.
  if admin_exists then
    v_first := split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1);
    v_last  := trim(substr(coalesce(new.raw_user_meta_data ->> 'full_name', ''), length(v_first) + 1));

    if v_first <> '' and v_last <> '' then
      select id, first_name, last_name into v_donor
      from public.donors
      where lower(first_name) = lower(v_first)
        and lower(last_name)  = lower(v_last)
        and is_active = true
      limit 1;

      if found then
        -- Link both directions: profile → donor and donor → profile
        update public.profiles
        set linked_donor_id = v_donor.id,
            portal_access   = true   -- grant access immediately
        where id = new.id;

        update public.donors
        set linked_user_id = new.id
        where id = v_donor.id and linked_user_id is null;

        raise notice 'Auto-linked new user % to existing donor % %',
          new.email, v_donor.first_name, v_donor.last_name;
      end if;
    end if;
  end if;

  return new;
exception
  when others then
    raise warning 'handle_new_user failed for %: %', new.email, sqlerrm;
    return new;
end $$;

-- Re-create the trigger (no-op if it already exists, but safe)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
