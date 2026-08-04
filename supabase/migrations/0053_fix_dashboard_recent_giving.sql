-- ============================================================================
-- 0053_fix_dashboard_recent_giving.sql
--
-- The admin dashboard's "Recent giving" widget currently shows the latest 5
-- raw donation rows — which means every $20 check from an offering shows as a
-- separate card. For admins, this should display offering summaries (one per
-- Sunday service) so the widget stays clean as more offerings are recorded.
--
-- Also increases recent expenses from 5 → 8.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.get_dashboard_kpis(
  year_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ytd_giving numeric;
  v_ytd_expenses numeric;
  v_donors integer;
  v_pending_expenses integer;
  v_pending_approvals integer;
  v_pending_deposits integer;
  v_pending_dep_total numeric;
  v_recent_giving jsonb;
  v_recent_expenses jsonb;
begin
  -- ── YTD Giving ──
  select coalesce(
    (select sum(o.total_amount) from public.offerings o where o.service_date >= year_start),
    0
  ) + coalesce(
    (select sum(d.amount) from public.donations d
     where d.donation_date >= year_start and d.offering_id is null),
    0
  ) into v_ytd_giving;

  -- ── YTD Expenses: only paid ──
  select coalesce(sum(e.amount), 0)
  into v_ytd_expenses
  from public.expenses e
  where e.created_at::date >= year_start
    and e.status in ('paid', 'auto_paid');

  -- ── Donors ──
  select coalesce(count(*), 0)
  into v_donors
  from public.donors
  where is_active = true;

  -- ── Pending expenses ──
  select coalesce(count(*), 0)
  into v_pending_expenses
  from public.expenses e
  where e.status in ('pending');

  -- ── Pending approvals ──
  select coalesce(count(*), 0)
  into v_pending_approvals
  from public.profiles p
  where p.portal_access = false
    and p.role not in ('admin', 'treasurer', 'super_admin');

  -- ── Pending deposits ──
  select coalesce(count(*), 0), coalesce(sum(o.total_amount), 0)
  into v_pending_deposits, v_pending_dep_total
  from public.offerings o
  where o.deposit_status = 'pending_deposit';

  -- ── Recent giving: latest 5 offering summaries (not raw donations) ──
  -- One card per Sunday service, not one per $20 check.
  select coalesce((
    select jsonb_agg(t.obj)
    from (
      select jsonb_build_object(
        'id', 'off-' || o.service_date::text || '-' || o.service_name,
        'date', o.service_date,
        'name', o.service_name || ' collection',
        'meta', 'cash + checks',
        'amount', o.total_amount
      ) as obj
      from public.offerings o
      order by o.service_date desc
      limit 5
    ) t
  ), '[]'::jsonb) into v_recent_giving;

  -- ── Recent expenses: latest 8 ──
  select coalesce((
    select jsonb_agg(t.obj)
    from (
      select jsonb_build_object(
        'id', e.id, 'title', e.title, 'amount', e.amount, 'status', e.status,
        'source', e.source, 'submitted_at', e.submitted_at, 'category', e.category,
        'description', e.description, 'receipt_paths', e.receipt_paths,
        'transfer_receipt_path', e.transfer_receipt_path,
        'payment_method', e.payment_method,
        'user_id', e.user_id,
        'approved_by', e.approved_by, 'approved_at', e.approved_at,
        'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes,
        'created_at', e.created_at
      ) as obj
      from public.expenses e
      order by e.submitted_at desc, e.created_at desc
      limit 8
    ) t
  ), '[]'::jsonb) into v_recent_expenses;

  return jsonb_build_object(
    'ytdGiving', v_ytd_giving,
    'ytdExpenses', v_ytd_expenses,
    'donors', v_donors,
    'pendingExpenses', v_pending_expenses,
    'pendingApprovals', v_pending_approvals,
    'pendingDeposits', v_pending_deposits,
    'pendingDepositTotal', v_pending_dep_total,
    'recentGiving', v_recent_giving,
    'recentExpenses', v_recent_expenses
  );
end;
$$;

grant execute on function public.get_dashboard_kpis(date) to authenticated, service_role;
