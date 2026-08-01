-- Migration 0040: Fix infinite RLS recursion on profiles
--
-- The chain was:
--   sign_offering() → SELECT profiles (PIN verify)
--   → RLS: profiles_select_own_or_admin → is_admin_or_treasurer()
--   → current_role() → SELECT profiles → RLS fires again → ∞
--
-- Fix: recreate the recursive functions with set search_path='' using
-- create-or-replace (safe, doesn't drop dependents). Then rewrite the
-- profiles RLS policy to split into a safe self-read + separate admin-read
-- so the admin-read policy can use the freshly recreated is_admin_or_treasurer.

-- ── 1. Recreate current_role with set search_path = '' ──────────────────
--    NOTE: returns app_role (NOT text) — the original return type.
create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ── 2. Recreate is_admin_or_treasurer ───────────────────────────────────
create or replace function public.is_admin_or_treasurer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select role::text in ('admin','treasurer','super_admin')
     from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ── 3. Recreate sign_offering with set search_path = '' ────────────────
--    (was previously altered to public,extensions — now empty for RLS safety)
create or replace function public.sign_offering(
  p_offering_id uuid,
  p_counter_1_id uuid,
  p_pin_1 text,
  p_counter_2_id uuid,
  p_pin_2 text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  valid_1 boolean;
  valid_2 boolean;
begin
  if p_counter_1_id = p_counter_2_id then
    raise exception 'Counters must be two different people';
  end if;

  select (pin_hash = extensions.crypt(p_pin_1, pin_hash))
    into valid_1 from public.profiles
   where id = p_counter_1_id and is_counter = true;

  select (pin_hash = extensions.crypt(p_pin_2, pin_hash))
    into valid_2 from public.profiles
   where id = p_counter_2_id and is_counter = true;

  if valid_1 and valid_2 then
    update public.offerings
       set counter_1_id = p_counter_1_id,
           counter_1_signed_at = now(),
           counter_2_id = p_counter_2_id,
           counter_2_signed_at = now()
     where id = p_offering_id;
    return true;
  end if;

  raise exception 'Invalid PIN or unauthorized counter';
end $$;

-- ── 4. Also recreate hash_pin for consistency ──────────────────────────
create or replace function public.hash_pin(pin text)
returns text
language sql security definer set search_path = ''
as $$
  select extensions.crypt(pin, extensions.gen_salt('bf'));
$$;

-- ── 5. Rewrite profiles RLS to avoid the recursive chain ───────────────
--    Drop old policies, create non-recursive replacements.
drop policy if exists profiles_select_own_or_admin on public.profiles;

--    Self-read: everyone can read their own profile (safe, no function calls)
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

--    Admin read: uses is_admin_or_treasurer() which is now security-definer
--    with set search_path='' → owned by supabase_admin → bypasses RLS.
create policy profiles_admin_select on public.profiles
  for select using (public.is_admin_or_treasurer());

--    Admin write already exists as profiles_admin_write, but update it too
--    to ensure it uses the recreated function without caching issues.
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (public.is_admin_or_treasurer())
  with check (public.is_admin_or_treasurer());
