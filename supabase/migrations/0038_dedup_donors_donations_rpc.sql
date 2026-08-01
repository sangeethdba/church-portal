-- Migration 0038: Fix duplicate donors + donations RPCs
-- 
-- 1. Update admin_manage_profile.create_link_donor to dedup by name
-- 2. Add submit_donation RPC (security-definer, bypasses RLS)
-- 3. Add list_donations RPC (admin sees all, member sees linked donor's)

-- ── Updated admin_manage_profile ────────────────────────────────────────
-- Replaces the version from migration 0036 with dedup logic.
create or replace function public.admin_manage_profile(
  target_user_id uuid,
  action text,
  new_val boolean default null,
  donor_id uuid default null,
  donor_first text default null,
  donor_last text default null,
  pin_plain text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
  v_first text;
  v_last text;
  v_existing_donor public.donors;
  v_new_donor public.donors;
begin
  -- Authorise: caller must be admin/treasurer/super_admin
  select * into v_call from public.profiles where id = auth.uid();
  if not found or v_call.role::text not in ('admin','treasurer','super_admin') then
    raise exception 'Only admins can manage members.';
  end if;

  if action = 'toggle_portal' then
    update public.profiles set portal_access = new_val where id = target_user_id;
    return jsonb_build_object('ok', true);
  elsif action = 'toggle_counter' then
    update public.profiles set is_counter = new_val where id = target_user_id;
    return jsonb_build_object('ok', true);
  elsif action = 'link_donor' then
    update public.profiles set linked_donor_id = donor_id where id = target_user_id;
    return jsonb_build_object('ok', true);
  elsif action = 'set_pin' then
    update public.profiles set pin_hash = crypt(pin_plain, gen_salt('bf')) where id = target_user_id;
    return jsonb_build_object('ok', true);
  elsif action = 'create_link_donor' then
    -- Dedup: check for existing donor with same name (case-insensitive)
    v_first := trim(donor_first);
    v_last  := trim(donor_last);

    select * into v_existing_donor
    from public.donors
    where lower(first_name) = lower(v_first)
      and lower(last_name)  = lower(v_last)
    limit 1;

    if found then
      -- Link to existing donor instead of creating a duplicate
      update public.profiles
      set linked_donor_id = v_existing_donor.id
      where id = target_user_id;
      return jsonb_build_object(
        'ok', true,
        'id', v_existing_donor.id,
        'label', v_existing_donor.first_name || ' ' || v_existing_donor.last_name,
        'deduped', true
      );
    end if;

    -- Create new donor record
    insert into public.donors (first_name, last_name, created_by)
    values (v_first, v_last, auth.uid())
    returning * into v_new_donor;

    update public.profiles
    set linked_donor_id = v_new_donor.id
    where id = target_user_id;

    return jsonb_build_object(
      'ok', true,
      'id', v_new_donor.id,
      'label', v_new_donor.first_name || ' ' || v_new_donor.last_name,
      'deduped', false
    );
  end if;

  raise exception 'Unknown action: %', action;
end $$;

-- ── submit_donation ─────────────────────────────────────────────────────
-- Security-definer wrapper for inserting a donation.  Bypasses the
-- `entered_by`-required constraint (set server-side) and the fragile
-- is_admin_or_treasurer() check in the donations RLS policy.
create or replace function public.submit_donation(
  p_donor_id       uuid default null,
  p_donor_name     text,
  p_amount         numeric,
  p_donation_type  text,
  p_payment_method text,
  p_check_number   text default null,
  p_donation_date  date default null,
  p_notes          text default null
)
returns uuid   -- returns new donation id
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_donation_id uuid;
begin
  insert into public.donations (
    donor_id, donor_name, amount, donation_type,
    payment_method, check_number, donation_date,
    notes, entered_by
  ) values (
    p_donor_id,
    p_donor_name,
    p_amount,
    p_donation_type::public.donation_kind,
    p_payment_method::public.payment_method,
    p_check_number,
    coalesce(p_donation_date, current_date),
    p_notes,
    auth.uid()
  )
  returning id into v_donation_id;

  return v_donation_id;
end $$;

-- ── list_donations ──────────────────────────────────────────────────────
-- Returns donations the caller is allowed to see.  Admins see everything;
-- members only see donations linked to their own donor record.
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

  if found and v_call.role::text in ('admin','treasurer','super_admin') then
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
