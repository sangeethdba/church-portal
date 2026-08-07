-- ============================================================================
-- 0056 — Admin corrections: edit & delete offerings
-- ============================================================================
-- Adds two security-definer RPCs so admins/treasurers can correct a wrongly
-- recorded Sunday offering from the UI. Everything stays atomic:
--
--   update_offering  – re-validates counter PINs, updates the offering row,
--                      replaces its checks + named cash gifts, and keeps the
--                      deposit status untouched (deposited stays deposited).
--   delete_offering  – removes the offering, its offering_checks (cascade),
--                      and its linked donation rows (so no orphaned "cash
--                      gift" rows reappear as standalone donations).
--
-- Run this in the Supabase SQL editor. Requires 0042 (record_offering) to
-- have been applied, since it mirrors the same PIN-verification + donor
-- lookup logic.
-- ============================================================================

-- ── Admin role guard (shared by both RPCs) ────────────────────────────────
-- Security definer functions bypass RLS, so every mutation must explicitly
-- require an admin/treasurer/super_admin caller.

-- ── 1. update_offering ────────────────────────────────────────────────────
create or replace function public.update_offering(
  p_offering_id     uuid,
  p_service_date    date,
  p_service_name    text,
  p_cash_breakdown  jsonb,
  p_cash_deductions jsonb,
  p_cash_net        numeric,
  p_check_amount    numeric,
  p_check_count     int,
  p_total_amount    numeric,
  p_notes           text,
  p_checks          jsonb,
  p_cash_gifts      jsonb,
  p_counter_1_id    uuid,
  p_pin_1           text,
  p_counter_2_id    uuid,
  p_pin_2           text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin_valid   boolean;
  v_donor_id    uuid;
  v_donation_id uuid;
  ch            jsonb;
begin
  -- Only admins/treasurers may correct the ledger.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','treasurer','super_admin')
  ) then
    raise exception 'Only admins and treasurers can edit offerings.';
  end if;

  -- 1. Validate both counter PINs (same as record_offering)
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

  -- 2. Update the offering row — deposit fields are intentionally untouched
  update public.offerings
     set service_date      = p_service_date,
         service_name      = p_service_name,
         cash_amount       = p_cash_net,
         cash_breakdown    = p_cash_breakdown,
         cash_deductions   = p_cash_deductions,
         cash_net          = p_cash_net,
         check_amount      = p_check_amount,
         check_count       = p_check_count,
         total_amount      = p_total_amount,
         notes             = p_notes,
         counter_1_id      = p_counter_1_id,
         counter_1_signed_at = now(),
         counter_2_id      = p_counter_2_id,
         counter_2_signed_at = now()
   where id = p_offering_id;

  if not found then
    raise exception 'Offering not found.';
  end if;

  -- 3. Replace children: remove old checks + linked donations, then re-insert
  delete from public.offering_checks where offering_id = p_offering_id;
  delete from public.donations where offering_id = p_offering_id;

  -- 4. Re-insert check donations + offering_checks (mirrors record_offering)
  for ch in select * from jsonb_array_elements(p_checks)
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
      auth.uid(),
      p_offering_id
    )
    returning id into v_donation_id;

    insert into public.offering_checks (
      offering_id, donor_id, donor_name,
      check_number, amount, donation_id
    ) values (
      p_offering_id,
      v_donor_id,
      coalesce(ch->>'donor_name', 'Anonymous'),
      nullif(ch->>'check_number', ''),
      coalesce((ch->>'amount')::numeric, 0),
      v_donation_id
    );
  end loop;

  -- 5. Re-insert named cash gift donations
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
      auth.uid(),
      p_offering_id
    );
  end loop;

  return true;
end $$;

-- ── 2. delete_offering ────────────────────────────────────────────────────
create or replace function public.delete_offering(p_offering_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean;
begin
  -- Only admins/treasurers may delete offerings.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','treasurer','super_admin')
  ) then
    raise exception 'Only admins and treasurers can delete offerings.';
  end if;

  -- Linked donation rows first (they would otherwise survive as standalone
  -- gifts once the offering is gone — donations.offering_id is ON DELETE
  -- SET NULL, so deleting the offering alone would leave them counting in
  -- Reports as standalone donations).
  delete from public.donations where offering_id = p_offering_id;

  -- offering_checks cascade automatically via the FK constraint.
  delete from public.offerings where id = p_offering_id;
  v_deleted := found;

  return v_deleted;
end $$;
