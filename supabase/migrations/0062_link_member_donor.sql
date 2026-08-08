-- ============================================================================
-- Auto-link portal members to their donor records.
--
-- Problem: a member registers and their giving shows $0 because their profile
-- is not linked to their donor record. The link is two-way
-- (donors.linked_user_id <-> profiles.linked_donor_id) and was only ever set
-- manually by an admin from the Dashboard.
--
-- This adds public.link_donor_by_name(p_user_id): matches a profile to a donor
-- by normalized name (exact -> reversed -> email -> containment -> token
-- subset -> first/last token) and links both sides, mirroring the
-- admin_manage_profile 'link_donor' action. Any authenticated member may call
-- it for their own account; only admins may pass another user id.
--
-- The DO block at the end backfills every currently-unlinked profile (so
-- already-registered members like John are linked the moment this runs).
-- ============================================================================

create or replace function public.link_donor_by_name(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := coalesce(p_user_id, auth.uid());
  caller_role text;
  v_profile public.profiles;
  qname text;
  qemail text;
  best record;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'no user');
  end if;

  -- A real logged-in member may only link their own account; the admin trio
  -- (and the backfill DO block below, where auth.uid() is null) may pass ids.
  select p.role::text into caller_role from public.profiles p where p.id = auth.uid();
  if p_user_id is not null and p_user_id <> auth.uid()
     and auth.uid() is not null
     and coalesce(caller_role, '') not in ('admin', 'treasurer', 'super_admin') then
    uid := auth.uid();
  end if;

  select * into v_profile from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no profile');
  end if;
  if v_profile.linked_donor_id is not null then
    return jsonb_build_object('ok', true, 'linked_donor_id', v_profile.linked_donor_id, 'already', true);
  end if;

  qname := lower(regexp_replace(coalesce(v_profile.full_name, ''), '\s+', ' ', 'g'));
  qemail := lower(coalesce(v_profile.email, ''));

  select d.id,
         d.first_name || ' ' || d.last_name as label,
         case
           when qname = lower(regexp_replace(d.first_name || ' ' || d.last_name, '\s+', ' ', 'g')) then 4
           when qname = lower(regexp_replace(d.last_name || ' ' || d.first_name, '\s+', ' ', 'g')) then 4
           when qemail <> '' and qemail = lower(coalesce(d.email, '')) then 3.5
           when qname <> '' and cardinality(string_to_array(qname, ' ')) >= 2
                and position(qname in lower(regexp_replace(d.first_name || ' ' || d.last_name, '\s+', ' ', 'g'))) > 0 then 3
           when qname <> '' and cardinality(string_to_array(qname, ' ')) >= 2
                and string_to_array(qname, ' ')
                    <@ string_to_array(lower(regexp_replace(d.first_name || ' ' || d.last_name, '\s+', ' ', 'g')), ' ') then 2.5
           when qname <> '' and cardinality(string_to_array(qname, ' ')) >= 2
                and string_to_array(qname, ' ')[1] = lower(d.first_name)
                and string_to_array(qname, ' ')[cardinality(string_to_array(qname, ' '))] = lower(d.last_name) then 2
           when qname <> '' and cardinality(string_to_array(qname, ' ')) = 1
                and (qname = lower(d.first_name) or qname = lower(d.last_name)) then 2
           else 0
         end as score
  into best
  from public.donors d
  where d.linked_user_id is null or d.linked_user_id = uid
  order by score desc, d.created_at asc
  limit 1;

  if best is null or best.score < 2 then
    return jsonb_build_object('ok', false, 'error', 'no donor match for this name', 'tried', qname);
  end if;

  update public.donors set linked_user_id = null where linked_user_id = uid;
  update public.donors set linked_user_id = uid where id = best.id;
  update public.profiles set linked_donor_id = best.id where id = uid;

  return jsonb_build_object('ok', true, 'linked_donor_id', best.id, 'donor_name', best.label);
end $$;

grant execute on function public.link_donor_by_name(uuid) to authenticated;

-- Backfill: link every currently-unlinked member to their donor record by name.
do $$
declare
  r record;
begin
  for r in select id from public.profiles where linked_donor_id is null loop
    perform public.link_donor_by_name(r.id);
  end loop;
end $$;
