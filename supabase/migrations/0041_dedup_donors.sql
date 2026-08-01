-- ============================================================================
-- 0041 — Deduplicate donors by case-insensitive name
-- ============================================================================
-- Strategy: for each normalized (lowercased) first_name + last_name:
--   1. Pick the KEEPER: the donor linked to a profile, or the earliest created_at
--   2. Reassign all donations / offering_checks / profiles from duplicates → keeper
--   3. Delete the duplicate donors
-- ============================================================================

do $$
declare
  rec record;
  keeper_id uuid;
  dup record;
begin
  -- Iterate over groups of duplicate names (case-insensitive)
  for rec in
    select lower(trim(first_name)) as fn, lower(trim(last_name)) as ln, count(*) as cnt
    from public.donors
    group by lower(trim(first_name)), lower(trim(last_name))
    having count(*) > 1
  loop
    -- Pick the keeper: prefer one linked to a profile, then earliest created_at
    select d.id into keeper_id
    from public.donors d
    where lower(trim(d.first_name)) = rec.fn
      and lower(trim(d.last_name)) = rec.ln
    order by
      case when exists (select 1 from public.profiles p where p.linked_donor_id = d.id) then 0 else 1 end,
      d.created_at asc
    limit 1;

    if keeper_id is null then
      continue;
    end if;

    -- For each duplicate donor, reassign everything to the keeper
    for dup in
      select d.id, d.first_name, d.last_name
      from public.donors d
      where lower(trim(d.first_name)) = rec.fn
        and lower(trim(d.last_name)) = rec.ln
        and d.id <> keeper_id
    loop
      -- 1. Reassign donations (by donor_id)
      update public.donations
      set donor_id = keeper_id
      where donor_id = dup.id;

      -- 2. Reassign donations (by donor_name — walk-ins matched to this donor's name)
      update public.donations
      set donor_name = (select trim(first_name || ' ' || last_name) from public.donors where id = keeper_id)
      where donor_id is null
        and lower(trim(donor_name)) = lower(trim(dup.first_name || ' ' || dup.last_name));

      -- 3. Reassign offering_checks
      update public.offering_checks
      set donor_id = keeper_id
      where donor_id = dup.id;

      -- 4. Reassign profiles.linked_donor_id
      update public.profiles
      set linked_donor_id = keeper_id
      where linked_donor_id = dup.id;

      -- 5. Delete the duplicate donor
      delete from public.donors where id = dup.id;

      raise notice 'Merged donor "% %" (id: %) into keeper (id: %)',
        dup.first_name, dup.last_name, dup.id, keeper_id;
    end loop;
  end loop;
end $$;

-- Verify: should show zero rows (no more duplicates)
select lower(first_name) || ' ' || lower(last_name) as name, count(*) as cnt
from public.donors
group by lower(first_name) || ' ' || lower(last_name)
having count(*) > 1;
