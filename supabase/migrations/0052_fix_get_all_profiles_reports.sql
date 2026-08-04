-- ============================================================================
-- 0052_fix_get_all_profiles_reports.sql
--
-- get_all_profiles and get_reports_data (from migration 0049) both call
-- _get_caller_info(), which was dropped by 0050_fix_dashboard_kpis.sql.
-- This makes counter names render as "Unknown" on the Offerings page and
-- the ledger PDF, and breaks the Reports page.
--
-- This migration rewrites both functions to query the caller's profile
-- directly (matching the pattern used by list_expenses), removing the
-- dependency on the missing helper.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Re-create get_all_profiles without _get_caller_info
create or replace function public.get_all_profiles()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  profiles_json jsonb := '[]'::jsonb;
  donors_json jsonb := '[]'::jsonb;
begin
  select role::text into v_role from public.profiles where id = auth.uid();

  if v_role not in ('admin','treasurer','super_admin','pastor') then
    -- Member: only see their own profile
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name,
      'role', p.role, 'is_counter', p.is_counter,
      'portal_access', p.portal_access, 'linked_donor_id', p.linked_donor_id
    )) into profiles_json
    from public.profiles p where p.id = auth.uid();
  else
    -- Admin/oversight: see all profiles
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name,
      'role', p.role, 'is_counter', p.is_counter,
      'portal_access', p.portal_access, 'linked_donor_id', p.linked_donor_id
    ) order by lower(p.full_name)) into profiles_json
    from public.profiles p;
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.first_name || ' ' || d.last_name
  ) order by lower(d.last_name)) into donors_json
  from public.donors d;

  return jsonb_build_object(
    'profiles', coalesce(profiles_json, '[]'::jsonb),
    'donorOptions', coalesce(donors_json, '[]'::jsonb)
  );
end $$;

-- 2. Re-create get_reports_data without _get_caller_info
create or replace function public.get_reports_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_donations jsonb;
  v_expenses  jsonb;
  v_offerings jsonb;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','treasurer','super_admin','pastor') then
    raise exception 'Not authorized';
  end if;

  select coalesce(jsonb_agg(row_to_json(d) order by d.donation_date desc), '[]'::jsonb)
  into v_donations
  from (
    select id, donor_id, donor_name, donor_email,
           amount, donation_type, payment_method,
           check_number, donation_date, entered_by,
           notes, created_at, offering_id
    from public.donations
  ) d;

  select coalesce(jsonb_agg(row_to_json(e) order by e.submitted_at desc nulls last), '[]'::jsonb)
  into v_expenses
  from (
    select id, source, title, amount, category,
           description, receipt_paths, transfer_receipt_path,
           payment_method,
           user_id, status,
           submitted_at, approved_by, approved_at,
           paid_at, paid_by, notes, created_at
    from public.expenses
  ) e;

  select coalesce(jsonb_agg(row_to_json(o) order by o.service_date desc), '[]'::jsonb)
  into v_offerings
  from (
    select id, service_date, service_name,
           coalesce(nullif(cash_amount, 0), cash_net) as cash_amount,
           cash_net,
           cash_deductions,
           check_amount, total_amount,
           check_count, deposit_status
    from public.offerings
  ) o;

  return jsonb_build_object(
    'donations', v_donations,
    'expenses',  v_expenses,
    'offerings', v_offerings
  );
end $$;
