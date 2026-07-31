-- Run in Supabase SQL editor.
--
-- 1) Expand the expense_category enum so the church can classify every kind of
--    spend — facility, people, ministry, events, travel, admin — for the yearly
--    "where did the money go?" review.
-- 2) Add expenses.event_name (optional free text) so expenses can be tagged to
--    events like VBS, Annual Conference, Sunday Snacks, Youth Meeting, etc.

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'rent'
  ) then alter type public.expense_category add value 'rent'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'internet_phone'
  ) then alter type public.expense_category add value 'internet_phone'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'salaries'
  ) then alter type public.expense_category add value 'salaries'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'church_support'
  ) then alter type public.expense_category add value 'church_support'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'books'
  ) then alter type public.expense_category add value 'books'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'packaging'
  ) then alter type public.expense_category add value 'packaging'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'shipping'
  ) then alter type public.expense_category add value 'shipping'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'travel'
  ) then alter type public.expense_category add value 'travel'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'hotel'
  ) then alter type public.expense_category add value 'hotel'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'tickets'
  ) then alter type public.expense_category add value 'tickets'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'vbs'
  ) then alter type public.expense_category add value 'vbs'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'conference'
  ) then alter type public.expense_category add value 'conference'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'youth'
  ) then alter type public.expense_category add value 'youth'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'sunday_snacks'
  ) then alter type public.expense_category add value 'sunday_snacks'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'sunday_school'
  ) then alter type public.expense_category add value 'sunday_school'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'reimbursements'
  ) then alter type public.expense_category add value 'reimbursements'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'expense_category' and e.enumlabel = 'bank_fees'
  ) then alter type public.expense_category add value 'bank_fees'; end if;
end $$;

-- Optional event tag, e.g. "VBS", "Annual Conference", "Sunday Snacks", "Youth Meeting".
alter table public.expenses add column if not exists event_name text;
