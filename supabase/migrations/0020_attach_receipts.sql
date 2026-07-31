-- Run in Supabase SQL editor.
--
-- Lets the member who owns a pending expense (or an admin) attach a missing
-- bill image to an existing expense — e.g. receipts that failed to upload
-- before the storage-policy fix, or a bill the treasurer asked about via the
-- clarification flow. Members cannot UPDATE expenses directly (RLS allows only
-- admins), so this security-definer function writes just the one line item's
-- receipt_path. It also self-heals legacy rows whose line_items is a JSON
-- string instead of an array.

create or replace function public.attach_receipt_to_expense(
  p_expense_id uuid,
  p_line_index int,
  p_path text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_line_items jsonb;
begin
  select user_id, line_items into v_user_id, v_line_items
  from public.expenses
  where id = p_expense_id;

  if v_user_id is null then
    raise exception 'expense_not_found';
  end if;

  if not (public.is_admin_or_treasurer() or v_user_id = auth.uid()) then
    raise exception 'not_allowed';
  end if;

  -- Legacy rows may hold a JSON *string* instead of a jsonb array; normalize.
  if jsonb_typeof(v_line_items) = 'string' then
    v_line_items := (v_line_items #>> '{}')::jsonb;
  end if;
  if v_line_items is null or jsonb_typeof(v_line_items) <> 'array' then
    v_line_items := '[]'::jsonb;
  end if;

  -- Ensure the target bill index exists (pad defensively if out of range).
  while jsonb_array_length(v_line_items) <= p_line_index loop
    v_line_items := v_line_items || '{"description":"Bill","amount":0}'::jsonb;
  end loop;

  v_line_items := jsonb_set(
    v_line_items,
    array[p_line_index::text, 'receipt_path'],
    to_jsonb(p_path)
  );

  update public.expenses
  set line_items = v_line_items
  where id = p_expense_id;
end $$;

revoke all on function public.attach_receipt_to_expense(uuid, int, text) from public;
grant execute on function public.attach_receipt_to_expense(uuid, int, text) to authenticated;
