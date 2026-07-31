-- ============================================================================
-- GraceLedger — portal access approval
-- Run in Supabase SQL editor after 0008_expense_line_items.sql.
-- ============================================================================

-- 1. Portal access flag: only approved members can use the portal
alter table public.profiles
  add column if not exists portal_access boolean not null default false;

-- 2. RLS: only portal-approved members (or admins) can submit member expenses
drop policy if exists expenses_member_insert on public.expenses;
create policy expenses_member_insert on public.expenses
  for insert with check (
    source = 'member_submitted'
    and user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and (portal_access = true or role = 'admin')
    )
  );

-- 3. RLS: only portal-approved members can read their own submitted expenses
drop policy if exists expenses_self_read on public.expenses;
create policy expenses_self_read on public.expenses
  for select using (
    user_id = auth.uid()
    or public.is_admin_or_treasurer()
  );
