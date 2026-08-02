-- ============================================================================
-- 0042 — Atomic offering recording with PIN sign-off
-- ============================================================================
-- Old flow: insert offering → insert checks → sign_offering RPC
--   Problem: if sign-off fails (invalid PIN), offering + checks remain in DB
--            as unsigned orphan rows.
--
-- New flow: single RPC wraps everything in one transaction.
--   If PIN is wrong → RAISE EXCEPTION → everything rolls back.
-- ============================================================================

create or replace function public.record_offering(
  -- Offering fields
  p_service_date     date,
  p_service_name     text,
  p_cash_breakdown   jsonb,
  p_cash_deductions  jsonb,
  p_cash_net         numeric,
  p_check_amount     numeric,
  p_check_count      int,
  p_total_amount     numeric,
  p_notes            text,
  -- Check entries as JSON array: [{donor_name, donor_id, check_number, amount}]
  p_checks           jsonb,
  -- Named cash gifts as JSON array: [{donor_name, donor_id, amount}]
  p_cash_gifts       jsonb,
  -- Counter sign-off
  p_counter_1_id     uuid,
  p_pin_1            text,
  p_counter_2_id     uuid,
  p_pin_2            text
)
returns uuid  -- new offering id
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offering_id uuid;
  v_recorded_by uuid;
  v_pin_valid   boolean;
  ch            jsonb;
  v_donor_id    uuid;
  v_donation_id uuid;
  v_entered_by  uuid;
begin
  v_recorded_by := auth.uid();
  v_entered_by  := auth.uid();

  -- ── 1. Validate PINs ──────────────────────────────────────────────────
  select true into v_pin_valid
  from public.profiles
  where id = p_counter_1_id
    and pin_hash is not null
    and pin_hash = extensions.crypt(p_pin_1, pin_hash);

  if not v_pin_valid then
    raise exception 'PIN for counter 1 is invalid.';
  end if;

  select true into v_pin_valid
  from public.profiles
  where id = p_counter_2_id
    and pin_hash is not null
    and pin_hash = extensions.crypt(p_pin_2, pin_hash);

  if not v_pin_valid then
    raise exception 'PIN for counter 2 is invalid.';
  end if;

  -- ── 2. Insert offering ────────────────────────────────────────────────
  insert into public.offerings (
    service_date, service_name,
    cash_breakdown, cash_deductions, cash_net,
    check_amount, check_count, total_amount,
    recorded_by, notes,
    counter_1_id, counter_1_signed_at,
    counter_2_id, counter_2_signed_at
  ) values (
    p_service_date, p_service_name,
    p_cash_breakdown, p_cash_deductions, p_cash_net,
    p_check_amount, p_check_count, p_total_amount,
    v_recorded_by, p_notes,
    p_counter_1_id, now(),
    p_counter_2_id, now()
  )
  returning id into v_offering_id;

  -- ── 3. Insert check donations + offering_checks ───────────────────────
  for ch in select * from jsonb_array_elements(p_checks)
  loop
    -- Determine donor_id: use the one from the JSON, or look up by name,
    -- or create a new donor if needed
    v_donor_id := (ch->>'donor_id')::uuid;

    if v_donor_id is null and (ch->>'donor_name') is not null then
      -- Look up existing donor by case-insensitive name
      select d.id into v_donor_id
      from public.donors d
      where lower(trim(d.first_name || ' ' || d.last_name)) = lower(trim(ch->>'donor_name'))
      limit 1;

      -- If still not found, create a new donor
      if v_donor_id is null then
        with parts as (
          select split_part(trim(ch->>'donor_name'), ' ', 1) as fn,
                 trim(substr(trim(ch->>'donor_name'), length(split_part(trim(ch->>'donor_name'), ' ', 1)) + 1)) as ln
        )
        insert into public.donors (first_name, last_name)
        select fn, case when ln = '' then fn else ln end
        from parts
        returning id into v_donor_id;
      end if;
    end if;

    -- Insert donation
    insert into public.donations (
      donor_id, donor_name, amount,
      donation_type, payment_method,
      check_number, donation_date,
      entered_by, offering_id
    ) values (
      v_donor_id,
      coalesce(ch->>'donor_name', 'Anonymous'),
      coalesce((ch->>'amount')::numeric, 0),
      'offering',
      'check',
      nullif(ch->>'check_number', ''),
      p_service_date,
      v_entered_by,
      v_offering_id
    )
    returning id into v_donation_id;

    -- Insert offering_checks link
    insert into public.offering_checks (
      offering_id, donor_id, donor_name,
      check_number, amount, donation_id
    ) values (
      v_offering_id,
      v_donor_id,
      coalesce(ch->>'donor_name', 'Anonymous'),
      nullif(ch->>'check_number', ''),
      coalesce((ch->>'amount')::numeric, 0),
      v_donation_id
    );
  end loop;

  -- ── 4. Insert named cash gift donations ──────────────────────────────
  for ch in select * from jsonb_array_elements(p_cash_gifts)
  loop
    v_donor_id := (ch->>'donor_id')::uuid;

    if v_donor_id is null and (ch->>'donor_name') is not null then
      select d.id into v_donor_id
      from public.donors d
      where lower(trim(d.first_name || ' ' || d.last_name)) = lower(trim(ch->>'donor_name'))
      limit 1;

      if v_donor_id is null then
        with parts as (
          select split_part(trim(ch->>'donor_name'), ' ', 1) as fn,
                 trim(substr(trim(ch->>'donor_name'), length(split_part(trim(ch->>'donor_name'), ' ', 1)) + 1)) as ln
        )
        insert into public.donors (first_name, last_name)
        select fn, case when ln = '' then fn else ln end
        from parts
        returning id into v_donor_id;
      end if;
    end if;

    insert into public.donations (
      donor_id, donor_name, amount,
      donation_type, payment_method,
      donation_date,
      entered_by, offering_id
    ) values (
      v_donor_id,
      coalesce(ch->>'donor_name', 'Anonymous'),
      coalesce((ch->>'amount')::numeric, 0),
      'offering',
      'cash',
      p_service_date,
      v_entered_by,
      v_offering_id
    );
  end loop;

  return v_offering_id;
end $$;
