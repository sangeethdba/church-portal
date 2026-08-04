-- ============================================================================
-- 0054_add_expense_categories.sql
--
-- Adds 6 new values to the expense_category enum covering real church needs:
--   storage          – monthly storage unit for church items
--   domain_hosting   – GoDaddy domain renewal, web hosting
--   equipment        – music instruments, sound system, church equipment
--   love_gifts       – honorariums & love gifts for pastors / guest speakers
--   car_rental       – car/van rental for event pickup & drop
--   retreat          – retreat center bookings (youth conference, etc.)
--
-- Idempotent: safe to re-run.
-- Run this in the Supabase SQL editor.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'storage'
  ) then alter type public.expense_category add value 'storage'; end if;

  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'domain_hosting'
  ) then alter type public.expense_category add value 'domain_hosting'; end if;

  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'equipment'
  ) then alter type public.expense_category add value 'equipment'; end if;

  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'love_gifts'
  ) then alter type public.expense_category add value 'love_gifts'; end if;

  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'car_rental'
  ) then alter type public.expense_category add value 'car_rental'; end if;

  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'retreat'
  ) then alter type public.expense_category add value 'retreat'; end if;
end $$;
