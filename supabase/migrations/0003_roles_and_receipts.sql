-- ============================================================================
-- GraceLedger — simplify roles to member + admin, add transfer receipt column
-- Run in Supabase SQL editor after 0002_offerings.sql.
-- ============================================================================

-- 1. Update existing treasurer / super_admin users to 'admin'
update public.profiles set role = 'admin' where role in ('treasurer', 'super_admin');

-- 2. Update RLS helper to check for 'admin' role only
create or replace function public.is_admin_or_treasurer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('admin'), false);
$$;

-- 3. Set default role to 'member' (keep as-is, but ensure clarity)
alter table public.profiles alter column role set default 'member';

-- 4. Add transfer_receipt_path to expenses (for bank transfer proof when marking paid)
alter table public.expenses add column if not exists transfer_receipt_path text;
