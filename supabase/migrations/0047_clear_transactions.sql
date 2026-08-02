-- ============================================================================
-- CLEAR TRANSACTIONS: Wipe all donations + expenses for a fresh start.
-- PRESERVES: donors, profiles, enums, functions, RLS, auth.users, storage.
-- Use this before starting fresh on a new fiscal period.
-- ============================================================================

-- 1. Wipe FK children first
delete from public.tax_receipts;
delete from public.reimbursements;
delete from public.offering_checks;
delete from public.donations;
delete from public.offerings;
delete from public.expenses;
delete from public.audit_log;

-- 2. Verify
select
  (select count(*) from public.donors) as donors_kept,
  (select count(*) from public.profiles) as profiles_kept,
  (select count(*) from public.donations) as donations_cleared,
  (select count(*) from public.expenses) as expenses_cleared,
  (select count(*) from public.offerings) as offerings_cleared;
