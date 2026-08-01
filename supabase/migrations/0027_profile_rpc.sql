-- ============================================================================
-- GraceLedger — bulletproof profile lookup that bypasses UUID mismatch
--
-- Creates an RPC that admins/searches profiles by UUID first, then falls
-- back to email.  Because it runs security-definer, it bypasses RLS entirely
-- and always returns the right profile regardless of auth UUID churn.
-- ============================================================================

create or replace function public.get_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles;
  auth_email text;
begin
  -- Get the current auth user's email
  select email into auth_email
  from auth.users
  where id = auth.uid();

  -- Try UUID first
  select * into profile_row
  from public.profiles
  where id = auth.uid();

  if found then
    return to_jsonb(profile_row);
  end if;

  -- Fallback: UUID mismatch (Google re-auth).  Find by email and re-link.
  if auth_email is not null then
    select * into profile_row
    from public.profiles
    where email = auth_email
    limit 1;

    if found then
      -- Re-link so future UUID lookups work
      update public.profiles
      set id = auth.uid()
      where id = profile_row.id;

      profile_row.id := auth.uid();
      return to_jsonb(profile_row);
    end if;
  end if;

  return null;
end $$;

grant execute on function public.get_my_profile() to authenticated;
