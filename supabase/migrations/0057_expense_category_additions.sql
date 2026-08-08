-- Migration 0057: expand expense_category with the categories the bulk importer
-- auto-detects but that were missing from the enum — WITHOUT these values, rows
-- like "04/21/26 PURCHASE ZOOM.COM ... -14.44" (→ 'software') fail the RPC cast
-- p_category::public.expense_category and the import errors out for that row.
--
-- Run in Supabase → SQL Editor once. Safe to re-run (each value is guarded).

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'food_expenses'
  ) then alter type public.expense_category add value 'food_expenses'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'amazon_purchases'
  ) then alter type public.expense_category add value 'amazon_purchases'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'software'
  ) then alter type public.expense_category add value 'software'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'education'
  ) then alter type public.expense_category add value 'education'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'insurance'
  ) then alter type public.expense_category add value 'insurance'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'facility_rent'
  ) then alter type public.expense_category add value 'facility_rent'; end if;
end $$;
