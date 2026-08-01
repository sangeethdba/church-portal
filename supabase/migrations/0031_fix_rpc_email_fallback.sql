-- ============================================================================
-- Fix: all security-definer RPCs now use email fallback when auth.uid()
-- doesn't match a profile ID.  This is necessary because the FK constraint
-- on profiles.id (referenced by expenses.user_id, donations.entered_by, etc.)
-- prevents the UUID re-link in get_my_profile from succeeding.
-- ============================================================================

-- ── Helper: get the caller's email, role, and admin flag (email-aware) ──
create or replace function public._get_caller_info()
returns table (
  uid uuid,
  email text,
  is_admin boolean,
  profile_row public.profiles
)
language plpgsql security definer set search_path = ''
as $$
begin
  uid := auth.uid();
  select u.email into email from auth.users u where u.id = uid;

  -- Try UUID first
  select * into profile_row from public.profiles p where p.id = uid;

  -- Fallback: email lookup (UUID mismatch due to Google re-auth)
  if not found and email is not null then
    select * into profile_row from public.profiles p where p.email = email limit 1;
  end if;

  if found then
    is_admin := profile_row.role::text in ('admin', 'treasurer', 'super_admin');
  else
    is_admin := false;
  end if;

  return next;
end $$;

-- ── 1. Fix get_my_profile: don't try to update the PK (FK prevents it) ──
create or replace function public.get_my_profile()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public._get_caller_info();
  if c.profile_row.id is null then return null; end if;
  return to_jsonb(c.profile_row);
end $$;

-- ── 2. Fix is_admin_or_treasurer (used by many RLS policies) ──
create or replace function public.is_admin_or_treasurer()
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public._get_caller_info();
  return c.is_admin;
end $$;

-- ── 3. Fix get_dashboard_kpis (from migration 0028) ────────────────────
create or replace function public.get_dashboard_kpis(year_start date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
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
  select * into c from public._get_caller_info();

  if not c.is_admin then
    -- Member: only own data
    select coalesce(sum(d.amount), 0) into ytd_giving
    from public.donations d
    join public.donors dr on dr.id = d.donor_id
    where dr.linked_user_id = c.uid and d.donation_date >= year_start;

    select coalesce(sum(e.amount), 0) into ytd_expenses
    from public.expenses e
    where e.user_id = c.uid and e.submitted_at::date >= year_start;

    select jsonb_agg(x order by x->>'date' desc) into recent_giving
    from (
      select jsonb_build_object(
        'id', d.id, 'date', d.donation_date::text, 'name', d.donor_name,
        'meta', d.donation_type::text || ' · ' || d.payment_method::text, 'amount', d.amount
      ) as x
      from public.donations d
      join public.donors dr on dr.id = d.donor_id
      where dr.linked_user_id = c.uid
      order by d.donation_date desc limit 5
    ) sub;

    select jsonb_agg(
      jsonb_build_object(
        'id', e.id, 'title', e.title, 'amount', e.amount, 'status', e.status,
        'source', e.source, 'submitted_at', e.submitted_at, 'category', e.category,
        'description', e.description, 'receipt_paths', e.receipt_paths,
        'transfer_receipt_path', e.transfer_receipt_path, 'user_id', e.user_id,
        'approved_by', e.approved_by, 'approved_at', e.approved_at,
        'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes, 'created_at', e.created_at
      ) order by e.submitted_at desc
    ) into recent_expenses
    from (select * from public.expenses where user_id = c.uid order by submitted_at desc limit 5) e;

    return jsonb_build_object(
      'kind', 'member', 'ytdGiving', ytd_giving, 'ytdExpenses', ytd_expenses,
      'donors', 0, 'pendingExpenses', 0, 'pendingApprovals', 0,
      'pendingDeposits', 0, 'pendingDepositTotal', 0,
      'recentGiving', coalesce(recent_giving, '[]'::jsonb),
      'recentExpenses', coalesce(recent_expenses, '[]'::jsonb)
    );
  end if;

  -- Admin: church-wide data
  select coalesce(sum(d.amount), 0) into ytd_giving
  from public.donations d
  where d.donation_date >= year_start and d.offering_id is null;

  ytd_giving := ytd_giving + coalesce((
    select sum(o.total_amount) from public.offerings o where o.service_date >= year_start
  ), 0);

  select coalesce(sum(e.amount), 0) into ytd_expenses
  from public.expenses e
  where e.submitted_at::date >= year_start and e.status in ('paid', 'auto_paid');

  select count(*) into donor_count from public.donors d where d.is_active = true;

  select count(*) into pending_expenses from public.expenses e where e.status = 'pending';

  select count(*) into pending_approvals
  from public.profiles p
  where p.role::text not in ('admin', 'treasurer', 'super_admin') and p.portal_access = false;

  select count(*), coalesce(sum(o.total_amount), 0) into pending_deposits, pending_deposit_total
  from public.offerings o where o.deposit_status = 'pending_deposit';

  select jsonb_agg(x order by x->>'date' desc) into recent_giving
  from (
    select jsonb_build_object(
      'id', 'off-' || o.service_date::text || '-' || o.service_name,
      'date', o.service_date::text, 'name', o.service_name || ' collection',
      'meta', 'cash + checks', 'amount', o.total_amount
    ) as x
    from public.offerings o order by o.service_date desc limit 6
  ) sub;

  select jsonb_agg(
    jsonb_build_object(
      'id', e.id, 'title', e.title, 'amount', e.amount, 'status', e.status,
      'source', e.source, 'submitted_at', e.submitted_at, 'category', e.category,
      'description', e.description, 'receipt_paths', e.receipt_paths,
      'transfer_receipt_path', e.transfer_receipt_path, 'user_id', e.user_id,
      'approved_by', e.approved_by, 'approved_at', e.approved_at,
      'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes, 'created_at', e.created_at
    ) order by e.submitted_at desc
  ) into recent_expenses
  from (select * from public.expenses order by submitted_at desc limit 5) e;

  return jsonb_build_object(
    'kind', 'admin', 'ytdGiving', ytd_giving, 'ytdExpenses', ytd_expenses,
    'donors', donor_count, 'pendingExpenses', pending_expenses,
    'pendingApprovals', pending_approvals,
    'pendingDeposits', pending_deposits, 'pendingDepositTotal', pending_deposit_total,
    'recentGiving', coalesce(recent_giving, '[]'::jsonb),
    'recentExpenses', coalesce(recent_expenses, '[]'::jsonb)
  );
end $$;

-- ── 4. Fix get_all_profiles (from migration 0029) ──────────────────────
create or replace function public.get_all_profiles()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  profiles_json jsonb := '[]'::jsonb;
  donors_json jsonb := '[]'::jsonb;
begin
  select * into c from public._get_caller_info();

  if not c.is_admin then
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name,
      'role', p.role, 'is_counter', p.is_counter,
      'portal_access', p.portal_access, 'linked_donor_id', p.linked_donor_id
    )) into profiles_json
    from public.profiles p where p.id = c.uid;
  else
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name,
      'role', p.role, 'is_counter', p.is_counter,
      'portal_access', p.portal_access, 'linked_donor_id', p.linked_donor_id
    ) order by lower(p.full_name)) into profiles_json
    from public.profiles p;
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.first_name || ' ' || d.last_name
  ) order by lower(d.last_name)) into donors_json
  from public.donors d;

  return jsonb_build_object(
    'profiles', coalesce(profiles_json, '[]'::jsonb),
    'donorOptions', coalesce(donors_json, '[]'::jsonb)
  );
end $$;

-- ── 5. Fix get_reports_data (from migration 0030) ──────────────────────
create or replace function public.get_reports_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  donations_json jsonb := '[]'::jsonb;
  expenses_json jsonb := '[]'::jsonb;
  offerings_json jsonb := '[]'::jsonb;
begin
  select * into c from public._get_caller_info();

  if not c.is_admin then
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'donor_id', d.donor_id, 'donor_name', d.donor_name,
      'donor_email', d.donor_email, 'amount', d.amount,
      'donation_type', d.donation_type, 'payment_method', d.payment_method,
      'check_number', d.check_number, 'donation_date', d.donation_date,
      'entered_by', d.entered_by, 'notes', d.notes, 'created_at', d.created_at,
      'offering_id', d.offering_id
    ) order by d.donation_date desc) into donations_json
    from public.donations d
    join public.donors dr on dr.id = d.donor_id
    where dr.linked_user_id = c.uid;

    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'source', e.source, 'title', e.title, 'amount', e.amount,
      'category', e.category, 'description', e.description,
      'receipt_paths', e.receipt_paths, 'transfer_receipt_path', e.transfer_receipt_path,
      'user_id', e.user_id, 'status', e.status, 'submitted_at', e.submitted_at,
      'approved_by', e.approved_by, 'approved_at', e.approved_at,
      'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes, 'created_at', e.created_at
    ) order by e.submitted_at desc) into expenses_json
    from public.expenses e where e.user_id = c.uid;

    offerings_json := '[]'::jsonb;
  else
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'donor_id', d.donor_id, 'donor_name', d.donor_name,
      'donor_email', d.donor_email, 'amount', d.amount,
      'donation_type', d.donation_type, 'payment_method', d.payment_method,
      'check_number', d.check_number, 'donation_date', d.donation_date,
      'entered_by', d.entered_by, 'notes', d.notes, 'created_at', d.created_at,
      'offering_id', d.offering_id
    ) order by d.donation_date desc) into donations_json
    from public.donations d;

    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'source', e.source, 'title', e.title, 'amount', e.amount,
      'category', e.category, 'description', e.description,
      'receipt_paths', e.receipt_paths, 'transfer_receipt_path', e.transfer_receipt_path,
      'user_id', e.user_id, 'status', e.status, 'submitted_at', e.submitted_at,
      'approved_by', e.approved_by, 'approved_at', e.approved_at,
      'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes, 'created_at', e.created_at
    ) order by e.submitted_at desc) into expenses_json
    from public.expenses e;

    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'service_date', o.service_date, 'service_name', o.service_name,
      'cash_amount', o.cash_amount, 'check_amount', o.check_amount,
      'total_amount', o.total_amount, 'check_count', o.check_count,
      'deposit_status', o.deposit_status
    ) order by o.service_date desc) into offerings_json
    from public.offerings o;
  end if;

  return jsonb_build_object(
    'donations', coalesce(donations_json, '[]'::jsonb),
    'expenses', coalesce(expenses_json, '[]'::jsonb),
    'offerings', coalesce(offerings_json, '[]'::jsonb)
  );
end $$;
