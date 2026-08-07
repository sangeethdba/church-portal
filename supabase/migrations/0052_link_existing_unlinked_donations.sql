-- ============================================================================
-- GraceLedger — backfill: link unlinked donations to donor records
-- Run after 0051. For every donation that has a donor_name but no donor_id
-- (e.g. rows imported before donor linking was added), find an existing donor
-- by name or create one, then link the donation. Safe to re-run.
-- ============================================================================

do $$
declare
  v_don donations%rowtype;
  v_first text;
  v_last text;
  v_existing uuid;
  v_new uuid;
begin
  for v_don in
    select * from public.donations
    where donor_id is null
      and donor_name is not null
      and btrim(donor_name) <> ''
      and lower(donor_name) <> 'anonymous'
      and lower(donor_name) not in ('sunday service collection', 'sunday offering')
  loop
    -- Split donor_name into first/last (last word = last name, rest = first)
    v_last  := substring(btrim(v_don.donor_name) from '([^ ]+)$');
    v_first := btrim(regexp_replace(btrim(v_don.donor_name), '([^ ]+)$', ''));

    -- Find existing donor (case-insensitive on the full name match)
    select d.id into v_existing
    from public.donors d
    where lower(coalesce(d.first_name,'')) || ' ' || lower(coalesce(d.last_name,''))
          = lower(coalesce(v_first,'')) || ' ' || lower(coalesce(v_last,''))
    limit 1;

    if not found then
      insert into public.donors (first_name, last_name)
      values (v_first, v_last)
      returning id into v_new;
      v_existing := v_new;
    end if;

    update public.donations
    set donor_id = v_existing
    where id = v_don.id;
  end loop;
end $$;
