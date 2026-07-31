-- Run in Supabase SQL editor.
--
-- Fix legacy expenses whose `line_items` was stored as a JSON *string* instead
-- of a jsonb array. Older form code did JSON.stringify(bills) into the jsonb
-- column, so the column round-trips as a JS string and every reader that calls
-- .map/.some on it crashes (blank dashboard / receipt viewer).
--
-- `line_items #>> '{}'` unwraps a jsonb string to its inner text, then `::jsonb`
-- parses it back into a real array. Any row that can't be parsed is reset to
-- an empty array rather than erroring the migration.

do $$
declare
  r record;
begin
  for r in
    select id, line_items
    from public.expenses
    where jsonb_typeof(line_items) = 'string'
  loop
    begin
      update public.expenses
      set line_items = (r.line_items #>> '{}')::jsonb
      where id = r.id;
    exception when others then
      update public.expenses
      set line_items = '[]'::jsonb
      where id = r.id;
    end;
  end loop;
end $$;
