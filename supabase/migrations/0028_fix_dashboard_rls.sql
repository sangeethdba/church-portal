-- ============================================================================
-- Fix dashboard donations/expenses queries blocked by fragile RLS chain.
-- The old flow: donations_admin_all → is_admin_or_treasurer() → current_role()
-- → SELECT profiles (which has RLS) — breaks intermittently.
-- Fix: security-definer RPCs that read auth.uid() directly, bypassing RLS.
-- ============================================================================

-- 1. Dashboard KPI RPC — returns YTD giving, expenses, pending counts, recent items
create or replace function public.get_dashboard_kpis(year_start date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  profile_role text;
  ytd_giving numeric := 0;
  ytd_expenses numeric := 0;
  donor_count bigint := 0;
  pending_expenses bigint := 0;
  pending_approvals bigint := 0;
  pending_deposits bigint := 0;
  pending_deposit_total numeric := 0;
  recent_giving jsonb := '[]'::jsonb;
  recent_expenses jsonb := '[]'::jsonb;
  month_start date := date_trunc('month', current_date)::date;
begin
  -- Get the caller's role directly (no RLS on this function)
  select p.role::text into profile_role
  from public.profiles p
  where p.id = uid;

  -- If no profile, return empty
  if profile_role is null then
    return jsonb_build_object(
      'kind', 'member',
      'ytdGiving', 0,
      'ytdExpenses', 0,
      'donors', 0,
      'pendingExpenses', 0,
      'pendingApprovals', 0,
      'pendingDeposits', 0,
      'pendingDepositTotal', 0,
      'recentGiving', '[]'::jsonb,
      'recentExpenses', '[]'::jsonb
    );
  end if;

  -- Admin/treasurer: see all church-wide data
  if profile_role in ('admin', 'treasurer', 'super_admin') then
    -- YTD giving: standalone donations + offerings
    select coalesce(sum(d.amount), 0)
    into ytd_giving
    from public.donations d
    where d.donation_date >= year_start
      and d.offering_id is null;

    ytd_giving := ytd_giving + coalesce((
      select sum(o.total_amount) from public.offerings o
      where o.service_date >= year_start
    ), 0);

    -- YTD settled expenses
    select coalesce(sum(e.amount), 0)
    into ytd_expenses
    from public.expenses e
    where e.submitted_at::date >= year_start
      and e.status in ('paid', 'auto_paid');

    -- Active donor count
    select count(*) into donor_count
    from public.donors d
    where d.is_active = true;

    -- Pending expenses
    select count(*) into pending_expenses
    from public.expenses e
    where e.status = 'pending';

    -- Pending approvals (non-admin profiles without portal_access)
    select count(*) into pending_approvals
    from public.profiles p
    where p.role::text not in ('admin', 'treasurer', 'super_admin')
      and p.portal_access = false;

    -- Pending deposits
    select count(*), coalesce(sum(o.total_amount), 0)
    into pending_deposits, pending_deposit_total
    from public.offerings o
    where o.deposit_status = 'pending_deposit';

    -- Recent giving (last 6 items, offerings + donations)
    select jsonb_agg(x order by x->>'date' desc) into recent_giving
    from (
      select jsonb_build_object(
        'id', 'off-' || o.service_date::text || '-' || o.service_name,
        'date', o.service_date::text,
        'name', o.service_name || ' collection',
        'meta', 'cash + checks',
        'amount', o.total_amount
      ) as x
      from public.offerings o
      order by o.service_date desc
      limit 6
    ) sub;

    -- Recent expenses (last 5)
    select jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'amount', e.amount,
        'status', e.status,
        'source', e.source,
        'submitted_at', e.submitted_at,
        'category', e.category,
        'description', e.description,
        'receipt_paths', e.receipt_paths,
        'transfer_receipt_path', e.transfer_receipt_path,
        'user_id', e.user_id,
        'approved_by', e.approved_by,
        'approved_at', e.approved_at,
        'paid_at', e.paid_at,
        'paid_by', e.paid_by,
        'notes', e.notes,
        'created_at', e.created_at
      )
      order by e.submitted_at desc
    ) into recent_expenses
    from (
      select * from public.expenses
      order by submitted_at desc
      limit 5
    ) e;

    return jsonb_build_object(
      'kind', 'admin',
      'ytdGiving', ytd_giving,
      'ytdExpenses', ytd_expenses,
      'donors', donor_count,
      'pendingExpenses', pending_expenses,
      'pendingApprovals', pending_approvals,
      'pendingDeposits', pending_deposits,
      'pendingDepositTotal', pending_deposit_total,
      'recentGiving', coalesce(recent_giving, '[]'::jsonb),
      'recentExpenses', coalesce(recent_expenses, '[]'::jsonb)
    );
  else
    -- Member: see only their linked donor's donations + their own expenses
    -- YTD giving via linked donor
    select coalesce(sum(d.amount), 0)
    into ytd_giving
    from public.donations d
    join public.donors dr on dr.id = d.donor_id
    where dr.linked_user_id = uid
      and d.donation_date >= year_start;

    -- YTD expenses
    select coalesce(sum(e.amount), 0)
    into ytd_expenses
    from public.expenses e
    where e.user_id = uid
      and e.submitted_at::date >= year_start;

    -- Recent giving
    select jsonb_agg(x order by x->>'date' desc) into recent_giving
    from (
      select jsonb_build_object(
        'id', d.id,
        'date', d.donation_date::text,
        'name', d.donor_name,
        'meta', d.donation_type::text || ' · ' || d.payment_method::text,
        'amount', d.amount
      ) as x
      from public.donations d
      join public.donors dr on dr.id = d.donor_id
      where dr.linked_user_id = uid
      order by d.donation_date desc
      limit 5
    ) sub;

    -- Recent expenses
    select jsonb_agg(
      jsonb_build_object(
        'id', e.id, 'title', e.title, 'amount', e.amount,
        'status', e.status, 'source', e.source,
        'submitted_at', e.submitted_at, 'category', e.category,
        'description', e.description, 'receipt_paths', e.receipt_paths,
        'transfer_receipt_path', e.transfer_receipt_path,
        'user_id', e.user_id,
        'approved_by', e.approved_by, 'approved_at', e.approved_at,
        'paid_at', e.paid_at, 'paid_by', e.paid_by,
        'notes', e.notes, 'created_at', e.created_at
      )
      order by e.submitted_at desc
    ) into recent_expenses
    from (
      select * from public.expenses where user_id = uid
      order by submitted_at desc
      limit 5
    ) e;

    return jsonb_build_object(
      'kind', 'member',
      'ytdGiving', ytd_giving,
      'ytdExpenses', ytd_expenses,
      'donors', 0,
      'pendingExpenses', 0,
      'pendingApprovals', 0,
      'pendingDeposits', 0,
      'pendingDepositTotal', 0,
      'recentGiving', coalesce(recent_giving, '[]'::jsonb),
      'recentExpenses', coalesce(recent_expenses, '[]'::jsonb)
    );
  end if;
end $$;

-- 2. Also fix the is_admin_or_treasurer helper once and for all
-- (some migrations may have left it in a broken state)
create or replace function public.is_admin_or_treasurer()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text in ('admin', 'treasurer', 'super_admin')
  );
$$;

-- 3. Rebuild donations RLS to use the fixed helper
drop policy if exists donations_admin_all on public.donations;
create policy donations_admin_all on public.donations
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

drop policy if exists donations_self_read on public.donations;
create policy donations_self_read on public.donations
  for select using (
    donor_id is not null and exists (
      select 1 from public.donors d
      where d.id = donations.donor_id and d.linked_user_id = auth.uid()
    )
  );

-- 4. Verify the fix
select
  (select count(*) from public.donations) as total_donations,
  (select count(*) from public.expenses) as total_expenses,
  (select count(*) from public.profiles where portal_access = false and role::text not in ('admin','treasurer','super_admin')) as pending_approvals;
