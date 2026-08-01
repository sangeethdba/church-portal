-- Migration 0036: Admin profile management RPC — bypasses RLS for admin operations.
-- All toggle/link operations go through this single function.

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
language plpgsql security definer set search_path = ''
as $$
declare
  caller_is_admin boolean;
  pin_hash_result text;
  new_donor_id uuid;
  result jsonb;
begin
  -- Verify caller is admin
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin','treasurer','super_admin')
  ) into caller_is_admin;

  if not caller_is_admin then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;

  -- Handle different actions
  case action
    when 'toggle_portal' then
      update public.profiles set portal_access = new_val where id = target_user_id;
      return jsonb_build_object('ok', true, 'portal_access', new_val);

    when 'toggle_counter' then
      update public.profiles set is_counter = new_val where id = target_user_id;
      return jsonb_build_object('ok', true, 'is_counter', new_val);

    when 'link_donor' then
      -- Link both sides
      update public.donors set linked_user_id = null where linked_user_id = target_user_id;
      update public.donors set linked_user_id = target_user_id where id = donor_id;
      update public.profiles set linked_donor_id = donor_id where id = target_user_id;
      return jsonb_build_object('ok', true, 'linked_donor_id', donor_id);

    when 'create_link_donor' then
      insert into public.donors (first_name, last_name, linked_user_id)
      values (donor_first, donor_last, target_user_id)
      returning id into new_donor_id;
      update public.profiles set linked_donor_id = new_donor_id where id = target_user_id;
      return jsonb_build_object(
        'ok', true,
        'id', new_donor_id,
        'label', donor_first || ' ' || donor_last
      );

    when 'set_pin' then
      if pin_plain is null or length(pin_plain) < 3 then
        return jsonb_build_object('ok', false, 'error', 'PIN too short');
      end if;
      pin_hash_result := crypt(pin_plain, gen_salt('bf', 4));
      update public.profiles set pin_hash = pin_hash_result where id = target_user_id;
      return jsonb_build_object('ok', true);

    else
      return jsonb_build_object('ok', false, 'error', 'Unknown action: ' || action);
  end case;
end $$;
