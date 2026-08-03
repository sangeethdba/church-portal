-- 0049: Pastor oversight role (read-only)
--
-- Gives the pastor a "see everything / change nothing" account:
--   * can view all expenses (bills, line-item receipts, bank transfer slips),
--     offerings, donations, donor directory, reports, tax statements
--   * keeps member abilities (own giving under My giving & bills, submitting
--     their own reimbursements)
--   * cannot record offerings, deposit, approve/reject/clear expenses, import,
--     or edit anything — every write path stays admin/treasurer/super_admin
--
-- Safe to re-run (idempotent). Run this whole file in the Supabase SQL
-- Editor, then promote the pastor's account:
--
--   update public.profiles
--      set role = 'pastor', portal_access = true
--    where email = 'pastor@yourchurch.org';
--
-- Note: roles are compared as ::text everywhere below so this script never
-- needs the new enum value to be usable mid-transaction.

-- 1. Add 'pastor' to the app_role enum (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'pastor'
  ) then
    alter type public.app_role add value 'pastor';
  end if;
end $$;

-- 2. Read-only oversight check: admin trio + pastor.
--    Deliberately separate from is_admin_or_treasurer() (which gates write
--    access) so the pastor can never satisfy a write-gated policy or RPC.
create or replace function public.is_oversight_read()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role()::text in ('admin','treasurer','super_admin','pastor'), false);
$$;

-- 3. SELECT-only RLS policies for the pastor (OR'd with existing policies,
--    so nothing else changes). No insert/update/delete is granted.
drop policy if exists profiles_pastor_read on public.profiles;
create policy profiles_pastor_read on public.profiles
  for select using (public.is_oversight_read());

drop policy if exists donors_pastor_read on public.donors;
create policy donors_pastor_read on public.donors
  for select using (public.is_oversight_read());

drop policy if exists donations_pastor_read on public.donations;
create policy donations_pastor_read on public.donations
  for select using (public.is_oversight_read());

drop policy if exists offerings_pastor_read on public.offerings;
create policy offerings_pastor_read on public.offerings
  for select using (public.is_oversight_read());

drop policy if exists offering_checks_pastor_read on public.offering_checks;
create policy offering_checks_pastor_read on public.offering_checks
  for select using (public.is_oversight_read());

drop policy if exists expenses_pastor_read on public.expenses;
create policy expenses_pastor_read on public.expenses
  for select using (public.is_oversight_read());

drop policy if exists reimbursements_pastor_read on public.reimbursements;
create policy reimbursements_pastor_read on public.reimbursements
  for select using (public.is_oversight_read());

drop policy if exists tax_receipts_pastor_read on public.tax_receipts;
create policy tax_receipts_pastor_read on public.tax_receipts
  for select using (public.is_oversight_read());

-- 4. Storage: pastor may view every member's bills/transfer receipts and all
--    tax statements (read-only; upload/overwrite stays with the owner/admin).
drop policy if exists "receipts overseer read" on storage.objects;
create policy "receipts overseer read" on storage.objects
  for select to authenticated using (
    bucket_id = 'receipts' and public.is_oversight_read()
  );

drop policy if exists "tax overseer read" on storage.objects;
create policy "tax overseer read" on storage.objects
  for select to authenticated using (
    bucket_id = 'tax-statements' and public.is_oversight_read()
  );

-- 5. list_expenses — pastor sees every expense (read-only; the admin_* write
--    RPCs still reject anything except the admin trio).
create or replace function public.list_expenses()
returns setof public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call from public.profiles where id = auth.uid();

  if found and v_call.role::text in ('admin','treasurer','super_admin','pastor') then
    return query
      select * from public.expenses
      order by submitted_at desc;
  else
    return query
      select * from public.expenses
      where user_id = auth.uid()
      order by submitted_at desc;
  end if;
end $$;

-- 6. list_donations — pastor sees the full donations ledger.
create or replace function public.list_donations()
returns setof public.donations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call from public.profiles where id = auth.uid();

  if found and v_call.role::text in ('admin','treasurer','super_admin','pastor') then
    return query
      select * from public.donations
      order by donation_date desc;
  else
    return query
      select d.* from public.donations d
      where exists (
        select 1 from public.donors dr
        where dr.id = d.donor_id and dr.linked_user_id = auth.uid()
      )
      order by d.donation_date desc;
  end if;
end $$;

-- 7. get_reports_data — now guarded: admin trio + pastor only. (This also
--    closes a latent gap where any signed-in member could previously pull the
--    full ledger through this security-definer RPC.)
create or replace function public.get_reports_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_donations jsonb;
  v_expenses  jsonb;
  v_offerings jsonb;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','treasurer','super_admin','pastor') then
    raise exception 'Not authorized';
  end if;

  select coalesce(jsonb_agg(row_to_json(d) order by d.donation_date desc), '[]'::jsonb)
  into v_donations
  from (
    select id, donor_id, donor_name, donor_email,
           amount, donation_type, payment_method,
           check_number, donation_date, entered_by,
           notes, created_at, offering_id
    from public.donations
  ) d;

  select coalesce(jsonb_agg(row_to_json(e) order by e.submitted_at desc nulls last), '[]'::jsonb)
  into v_expenses
  from (
    select id, source, title, amount, category,
           description, receipt_paths, transfer_receipt_path,
           user_id, status,
           submitted_at, approved_by, approved_at,
           paid_at, paid_by, notes, created_at
    from public.expenses
  ) e;

  select coalesce(jsonb_agg(row_to_json(o) order by o.service_date desc), '[]'::jsonb)
  into v_offerings
  from (
    select id, service_date, service_name,
           coalesce(nullif(cash_amount, 0), cash_net) as cash_amount,
           cash_net,
           cash_deductions,
           check_amount, total_amount,
           check_count, deposit_status
    from public.offerings
  ) o;

  return jsonb_build_object(
    'donations', v_donations,
    'expenses',  v_expenses,
    'offerings', v_offerings
  );
end;
$$;

-- 8. get_dashboard_kpis — the pastor's dashboard shows church-wide totals
--    (same read-only scope as the treasurer's), never the member-only view.
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

  if not (c.is_admin or c.profile_row.role::text = 'pastor') then
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

  -- Admin/oversight: church-wide data
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
  where p.role::text not in ('admin', 'treasurer', 'super_admin', 'pastor') and p.portal_access = false;

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

-- 9. get_all_profiles — pastor gets the full roster (read-only) so counter
--    names render on ledger previews; donor options were already public.
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

  if not (c.is_admin or c.profile_row.role::text = 'pastor') then
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

-- 10. Promote the pastor (edit the email, then run this line):
--   update public.profiles
--      set role = 'pastor', portal_access = true
--    where email = 'pastor@yourchurch.org';
