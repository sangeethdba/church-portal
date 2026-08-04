-- 0050: Fix dashboard KPIs — replace complex _get_caller_info-dependent
--       function with a self-contained SECURITY DEFINER implementation
--       that queries tables directly.
--
-- Run this in Supabase SQL Editor. It is idempotent (safe to re-run).

begin;

-- 1. Drop the broken chain so we can rebuild cleanly
drop function if exists public.get_dashboard_kpis(date);
drop function if exists public._get_caller_info();

-- 2. Create get_dashboard_kpis as a standalone SECURITY DEFINER function
--    that reads from donations, expenses, offerings, and profiles directly.
--    Returns jsonb with the exact shape src/pages/Dashboard.tsx expects:
--      ytdGiving, ytdExpenses, donors, pendingExpenses, pendingApprovals,
--      pendingDeposits, pendingDepositTotal, recentGiving[], recentExpenses[]
create or replace function public.get_dashboard_kpis(
  year_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ytd_giving         numeric;
  v_ytd_expenses        numeric;
  v_donors              integer;
  v_pending_expenses    integer;
  v_pending_approvals   integer;
  v_pending_deposits    integer;
  v_pending_dep_total   numeric;
  v_recent_giving       jsonb;
  v_recent_expenses     jsonb;
begin
  -- ── YTD Giving: sum of all donations this year + offering totals ──
  -- Offerings already insert child donation rows (via record_offering),
  -- so we sum offerings.total_amount for deposited offerings and add
  -- non-offering-linked donations to avoid double-counting.
  select coalesce(
    (select sum(o.total_amount)
       from public.offerings o
      where o.service_date >= year_start
        and o.deposit_status = 'deposited'),
    0
  ) + coalesce(
    (select sum(d.amount)
       from public.donations d
      where d.donation_date >= year_start
        and d.offering_id is null),
    0
  ) into v_ytd_giving;

  -- ── YTD Expenses: total of all expenses this year ──
  select coalesce(sum(e.amount), 0)
    into v_ytd_expenses
    from public.expenses e
   where e.created_at::date >= year_start;

  -- ── Donor count: active donors ──
  select coalesce(count(*), 0)
    into v_donors
    from public.donors
   where is_active = true;

  -- ── Pending expenses: count of pending/rejected expenses ──
  select coalesce(count(*), 0)
    into v_pending_expenses
    from public.expenses e
   where e.status in ('pending');

  -- ── Pending approvals: profiles that signed in but haven't been
  --    granted portal_access (and aren't already admins) ──
  select coalesce(count(*), 0)
    into v_pending_approvals
    from public.profiles p
   where p.portal_access = false
     and p.role not in ('admin', 'treasurer', 'super_admin');

  -- ── Pending deposits: offerings not yet deposited ──
  select coalesce(count(*), 0),
         coalesce(sum(o.total_amount), 0)
    into v_pending_deposits, v_pending_dep_total
    from public.offerings o
   where o.deposit_status = 'pending_deposit';

  -- ── Recent giving: latest 5 donations ──
  select coalesce(jsonb_agg(
    row_to_json(r.*)
    order by r.donation_date desc, r.created_at desc
  ) filter (where r.id is not null), '[]'::jsonb)
  into v_recent_giving
  from (
    select
      d.id,
      d.donation_date as date,
      d.donor_name   as name,
      (d.donation_type || ' · ' || d.payment_method) as meta,
      d.amount
    from public.donations d
    order by d.donation_date desc, d.created_at desc
    limit 5
  ) r;

  -- ── Recent expenses: latest 5 expenses ──
  select coalesce(jsonb_agg(
    row_to_json(e.*)
    order by e.submitted_at desc, e.created_at desc
  ) filter (where e.id is not null), '[]'::jsonb)
  into v_recent_expenses
  from public.expenses e
  order by e.submitted_at desc, e.created_at desc
  limit 5;

  -- ── Return as a single jsonb object ──
  return jsonb_build_object(
    'ytdGiving',           v_ytd_giving,
    'ytdExpenses',         v_ytd_expenses,
    'donors',              v_donors,
    'pendingExpenses',     v_pending_expenses,
    'pendingApprovals',    v_pending_approvals,
    'pendingDeposits',     v_pending_deposits,
    'pendingDepositTotal', v_pending_dep_total,
    'recentGiving',        v_recent_giving,
    'recentExpenses',      v_recent_expenses
  );
end;
$$;

-- 3. Grant execute to both authenticated users and the service_role
grant execute on function public.get_dashboard_kpis(date) to authenticated, service_role;

commit;
