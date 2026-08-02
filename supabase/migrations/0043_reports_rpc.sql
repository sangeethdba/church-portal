-- ── get_reports_data ────────────────────────────────────────────────────
-- Security-definer RPC that the Reports page uses to fetch donations,
-- expenses, and offerings in a single call.  The Reports page previously
-- called this RPC but it never existed in any migration — so offerings
-- always showed $0 (silent failure).
create or replace function public.get_reports_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_donations jsonb;
  v_expenses  jsonb;
  v_offerings jsonb;
begin
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
           coalesce(nullif(cash_amount, 0), cash_net) as cash_amount, check_amount, total_amount,
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
