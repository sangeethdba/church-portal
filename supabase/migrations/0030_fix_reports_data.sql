-- ============================================================================
-- Fix Reports page: offerings/donations queries blocked by fragile RLS chain.
-- Migration 0015 restricted offerings to (is_counter OR is_admin_or_treasurer),
-- both of which go through profiles RLS.  Use security-definer RPC instead.
-- ============================================================================

-- 1. Bulletproof RPC for the Reports page — returns all data in one call
create or replace function public.get_reports_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  is_admin boolean;
  donations_json jsonb := '[]'::jsonb;
  expenses_json jsonb := '[]'::jsonb;
  offerings_json jsonb := '[]'::jsonb;
begin
  -- Check admin/counter role directly (no RLS, no function chain)
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and (p.role::text in ('admin', 'treasurer', 'super_admin') or p.is_counter = true)
  ) into is_admin;

  if not is_admin then
    -- Non-admin member: only own linked donations + own expenses
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
    where dr.linked_user_id = uid;

    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'source', e.source, 'title', e.title, 'amount', e.amount,
      'category', e.category, 'description', e.description,
      'receipt_paths', e.receipt_paths, 'transfer_receipt_path', e.transfer_receipt_path,
      'user_id', e.user_id, 'status', e.status, 'submitted_at', e.submitted_at,
      'approved_by', e.approved_by, 'approved_at', e.approved_at,
      'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes,
      'created_at', e.created_at
    ) order by e.submitted_at desc) into expenses_json
    from public.expenses e
    where e.user_id = uid;

    -- Members don't see offerings
    offerings_json := '[]'::jsonb;
  else
    -- Admin/counter: see everything
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
      'paid_at', e.paid_at, 'paid_by', e.paid_by, 'notes', e.notes,
      'created_at', e.created_at
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

-- 2. Also fix the offerings RLS policy to be direct (avoid the fragile chain)
drop policy if exists offerings_read on public.offerings;
create policy offerings_read on public.offerings
  for select to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_counter = true or p.role::text in ('admin', 'treasurer', 'super_admin'))
    )
  );
