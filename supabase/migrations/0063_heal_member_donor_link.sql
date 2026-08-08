-- ============================================================================
-- Heal one-sided member <-> donor links.
--
-- Found in production: John Seeli's profile had linked_donor_id set, but his
-- donor record's linked_user_id was NULL. The donations_self_read RLS policy
-- only checks donors.linked_user_id = auth.uid(), so the member was blocked
-- from reading their own 55 gifts -> $0.00 on "My giving & bills".
--
-- Fixes:
--   1. donations_self_read / donors_self_read accept EITHER direction of the
--      link (donors.linked_user_id OR the caller's profiles.linked_donor_id),
--      so a one-sided link can never silently zero a member's giving again.
--   2. link_donor_by_name now REPAIRS a one-sided link (sets the donor side)
--      instead of early-returning when the profile side is already set.
--   3. Backfill: set donors.linked_user_id from profiles.linked_donor_id for
--      every one-sided link, then run the matcher for still-unlinked profiles.
-- ============================================================================

-- 1. Members may read their own donations via either side of the link
drop policy if exists donations_self_read on public.donations;
create policy donations_self_read on public.donations
  for select using (
    donor_id is not null and (
      exists (
        select 1 from public.donors d
        where d.id = donations.donor_id and d.linked_user_id = auth.uid()
      )
      or exists (
        select 1 from public.donors d
        join public.profiles p on p.id = auth.uid() and p.linked_donor_id = d.id
        where d.id = donations.donor_id
      )
    )
  );

-- 2. Members may read their own donor record via either direction too
drop policy if exists donors_self_read on public.donors;
create policy donors_self_read on public.donors
  for select using (
    linked_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.linked_donor_id = id
    )
  );

-- 3. Harden link_donor_by_name: repair a one-sided link instead of skipping
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
  -- (and the backfill DO blocks, where auth.uid() is null) may pass ids.
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
    -- A profile-side link already exists. If the donor side is missing it
    -- still blocks the member's own-donation read via RLS, so repair it.
    update public.donors d
    set linked_user_id = uid
    where d.id = v_profile.linked_donor_id
      and (d.linked_user_id is null or d.linked_user_id <> uid);
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

-- 4. Backfill / repair
do $$
declare
  r record;
begin
  -- Fix every one-sided link: profile side set but donor side missing.
  update public.donors d
  set linked_user_id = p.id
  from public.profiles p
  where p.linked_donor_id = d.id
    and d.linked_user_id is null;

  -- Then run the matcher for every profile still without a donor link.
  for r in select id from public.profiles where linked_donor_id is null loop
    perform public.link_donor_by_name(r.id);
  end loop;
end $$;
