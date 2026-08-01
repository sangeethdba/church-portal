-- ============================================================================
-- GraceLedger — fix profiles RLS so admins reliably see all profiles,
-- including pending-approval members, without depending on the fragile
-- is_admin_or_treasurer() → current_role() → profiles-with-RLS chain.
-- ============================================================================

-- 1. Replace the profiles SELECT policy: check admin role directly instead
--    of going through is_admin_or_treasurer().  The sub-select on profiles
--    is safe because it only reads the caller's own row (auth.uid() = p2.id)
--    and that always matches the first branch of the old policy anyway.
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid()
        and p2.role in ('admin', 'treasurer', 'super_admin')
    )
  );

-- 2. Also fix is_admin_or_treasurer() so it recognises treasurer and
--    super_admin again (they were accidentally dropped in migration 0003).
--    All downstream RLS policies that reference this function get the fix
--    for free.
create or replace function public.is_admin_or_treasurer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'treasurer', 'super_admin')
  );
$$;

-- 3. Once more, revoke portal_access from any non-admin member who still
--    has it (belt-and-suspenders after the trigger fix in 0023).
update public.profiles
set portal_access = false
where portal_access = true
  and role not in ('admin', 'treasurer', 'super_admin');
