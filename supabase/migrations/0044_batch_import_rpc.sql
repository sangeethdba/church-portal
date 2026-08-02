-- ── batch_import_transactions ─────────────────────────────────────────────
-- Security-definer wrapper that accepts a JSON array of transactions and
-- bulk-inserts them as expenses (debits/outflows) or donations (credits/inflows).
-- Each element must have:
--   type:       'expense' | 'donation'
--   amount:     numeric (positive — the function derives sign from type)
--   description:text
--   date:       date (defaults to current_date)
--   category:   text (expense_category for expenses, donation_kind for donations)
--   payment_method: text (defaults to 'online' for both)
--   check_number:   text (optional)
--
-- Returns jsonb array of { id, type, idx } for each inserted row.
create or replace function public.batch_import_transactions(
  p_transactions jsonb   -- [{type, amount, description, date, category, payment_method, check_number}]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx      jsonb;
  v_results jsonb := '[]'::jsonb;
  v_id      uuid;
  v_idx     int := 0;
  v_date    date;
  v_cat     text;
  v_pm      text;
begin
  -- Must be admin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'treasurer', 'super_admin')
  ) then
    raise exception 'Only admins can batch-import transactions.';
  end if;

  for v_tx in select * from jsonb_array_elements(p_transactions)
  loop
    v_date := coalesce(
      (v_tx->>'date')::date,
      current_date
    );
    v_pm   := coalesce(v_tx->>'payment_method', 'online');
    v_cat  := v_tx->>'category';

    if v_tx->>'type' = 'expense' then
      -- Insert directly into expenses (church_direct source for bank imports)
      insert into public.expenses (
        source, title, amount, category, description,
        payment_method, check_number, status, submitted_at,
        user_id
      ) values (
        'church_direct',
        v_tx->>'description',
        (v_tx->>'amount')::numeric,
        coalesce(v_cat, 'other')::public.expense_category,
        v_tx->>'description',
        v_pm::public.payment_method,
        nullif(v_tx->>'check_number', ''),
        'auto_paid',
        v_date::timestamptz,
        auth.uid()
      )
      returning id into v_id;

      v_results := v_results || jsonb_build_object(
        'id', v_id, 'type', 'expense', 'idx', v_idx
      );

    elsif v_tx->>'type' = 'donation' then
      -- Insert directly into donations for online credits mapped to donors
      insert into public.donations (
        donor_name, amount, donation_type,
        payment_method, check_number,
        donation_date, notes, entered_by
      ) values (
        v_tx->>'description',
        (v_tx->>'amount')::numeric,
        coalesce(v_cat, 'offering')::public.donation_kind,
        v_pm::public.payment_method,
        nullif(v_tx->>'check_number', ''),
        v_date,
        'Imported from bank statement',
        auth.uid()
      )
      returning id into v_id;

      v_results := v_results || jsonb_build_object(
        'id', v_id, 'type', 'donation', 'idx', v_idx
      );

    else
      raise exception 'Unknown transaction type at index %: %', v_idx, v_tx->>'type';
    end if;

    v_idx := v_idx + 1;
  end loop;

  return v_results;
end $$;
