-- 0045: Unique donors — prevent duplicate first_name + last_name
-- Adds a unique partial index so no two active donors can share the same
-- case-insensitive first + last name combination.

-- 1. Add unique partial index on (lower(first_name), lower(last_name)) for active donors
-- This prevents inserting a donor with the same normalized name as an existing active donor.
create unique index if not exists donors_active_unique_name_idx
  on public.donors (lower(first_name), lower(last_name))
  where is_active = true;

-- 2. Add a helper function to check for duplicates before insert
create or replace function public.check_duplicate_donor(
  p_first text,
  p_last  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first  text;
  v_last   text;
  v_existing record;
begin
  v_first := trim(p_first);
  v_last  := trim(p_last);

  if v_first = '' or v_last = '' then
    return jsonb_build_object('ok', false, 'error', 'First and last name are required');
  end if;

  select id, first_name, last_name into v_existing
  from public.donors
  where lower(first_name) = lower(v_first)
    and lower(last_name)  = lower(v_last)
    and is_active = true
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error', format('A donor named "%s %s" already exists', v_existing.first_name, v_existing.last_name),
      'existing_id', v_existing.id,
      'existing_name', v_existing.first_name || ' ' || v_existing.last_name
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
