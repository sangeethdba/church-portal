-- ============================================================================
-- FRESH RESET: Clear all financial + donor + profile data.
-- Preserves: schema, enums, functions, RLS policies, auth.users, storage.
-- After running, only the admin profile exists (linked to sangeeth.talluri).
-- ============================================================================

-- 1. Wipe financial tables (FK order: child tables first)
delete from public.tax_receipts;
delete from public.reimbursements;
delete from public.offering_checks;
delete from public.donations;
delete from public.offerings;
delete from public.expenses;
delete from public.audit_log;

-- 2. Wipe donors and profiles
delete from public.donors;
delete from public.profiles;

-- 3. Recreate admin profile for sangeeth.talluri
insert into public.profiles (id, email, full_name, role, portal_access, is_counter)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'full_name', 'Sangeeth Talluri'),
  'admin'::app_role,
  true,
  false
from auth.users
where email ilike '%sangeeth%'
limit 1;

-- 4. Verify the reset
select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.donors) as donors,
  (select count(*) from public.donations) as donations,
  (select count(*) from public.expenses) as expenses,
  (select count(*) from public.offerings) as offerings;

select p.email, p.full_name, p.role, p.portal_access from public.profiles p;
