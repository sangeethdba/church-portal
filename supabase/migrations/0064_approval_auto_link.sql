-- ============================================================================
-- Member approval auto-links donors.
--
-- Approving a member (Manage members & access -> Access ON) now runs
-- public.link_donor_by_name(target_user_id), so a member who registered with
-- their Gmail account is automatically matched to their existing donor record
-- by name/email — no manual linking or SQL updates.
--
-- Also fixes link_donor / create_link_donor to set BOTH sides of the link
-- (profiles.linked_donor_id AND donors.linked_user_id). The previous version
-- only set the profile side — which is exactly how John Seeli ended up
-- one-sided in production (profile linked, donor side null).
-- ============================================================================

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
    if new_val then
      -- Approving a member: auto-match their existing donor record by name/email.
      return jsonb_build_object(
        'ok', true,
        'portal_access', new_val,
        'donor_link', public.link_donor_by_name(target_user_id)
      );
    end if;
    return jsonb_build_object('ok', true, 'portal_access', new_val);

  elsif action = 'toggle_counter' then
    update public.profiles set is_counter = new_val where id = target_user_id;
    return jsonb_build_object('ok', true);

  elsif action = 'link_donor' then
    -- Link BOTH sides so RLS and statements work in either direction.
    update public.donors set linked_user_id = null where linked_user_id = target_user_id;
    update public.donors set linked_user_id = target_user_id where id = donor_id;
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
      -- Link to existing donor instead of creating a duplicate (both sides)
      update public.donors set linked_user_id = null where linked_user_id = target_user_id;
      update public.donors set linked_user_id = target_user_id where id = v_existing_donor.id;
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

    -- Create new donor record (both sides)
    insert into public.donors (first_name, last_name, linked_user_id, created_by)
    values (v_first, v_last, target_user_id, auth.uid())
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
