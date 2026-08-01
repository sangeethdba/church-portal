-- ============================================================================
-- Admin needs to list all profiles for "Manage members & access" dialog.
-- The profiles RLS chain (profiles_select_own_or_admin → is_admin_or_treasurer
-- → current_role → profiles) breaks intermittently.  Fix: security-definer RPC.
-- ============================================================================

create or replace function public.get_all_profiles()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  is_admin boolean;
  profiles_json jsonb := '[]'::jsonb;
  donors_json jsonb := '[]'::jsonb;
begin
  -- Check admin role directly (no RLS, no function chain)
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role::text in ('admin', 'treasurer', 'super_admin')
  ) into is_admin;

  if not is_admin then
    -- Non-admin: return only own profile
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name,
      'role', p.role, 'is_counter', p.is_counter,
      'portal_access', p.portal_access, 'linked_donor_id', p.linked_donor_id
    )) into profiles_json
    from public.profiles p
    where p.id = uid;
  else
    -- Admin: return all profiles ordered by full_name
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name,
      'role', p.role, 'is_counter', p.is_counter,
      'portal_access', p.portal_access, 'linked_donor_id', p.linked_donor_id
    ) order by lower(p.full_name)) into profiles_json
    from public.profiles p;
  end if;

  -- Donor options for the link dropdown
  select jsonb_agg(jsonb_build_object(
    'id', d.id,
    'label', d.first_name || ' ' || d.last_name
  ) order by lower(d.last_name)) into donors_json
  from public.donors d;

  return jsonb_build_object(
    'profiles', coalesce(profiles_json, '[]'::jsonb),
    'donorOptions', coalesce(donors_json, '[]'::jsonb)
  );
end $$;
