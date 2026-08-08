-- Migration 0058: two improvements to expense records.
--
-- 1) Bulk imports must carry the date printed on the bank statement (the posted
--    date), not the day the record was imported. `admin_insert_expense` gains an
--    optional p_submitted_at; when provided, the expense is dated — and, since
--    statement imports are auto-settled, marked approved/paid — on that date so
--    reports and member YTD figures land in the right month/year.
--
-- 2) Imported (and all) expenses must be editable: title, description, category,
--    amount, date, payment method, check #, card last-4, event, notes.
--    `admin_update_expense` is extended with those fields (supersedes 0037/0039).
--
-- Run once in Supabase → SQL Editor. Both functions are create-or-replace.

-- ── 1. admin_insert_expense with p_submitted_at ────────────────────────
-- (supersedes 0055 — member reimbursement + card_last4 behavior preserved)
create or replace function public.admin_insert_expense(
  p_title        text,
  p_amount       numeric,
  p_category     text,
  p_description  text default null,
  p_notes        text default null,
  p_event_name   text default null,
  p_payment_method text default null,
  p_check_number text default null,
  p_user_id      uuid default null,        -- member profile id → member reimbursement
  p_card_last4   text default null,        -- card used for this purchase (last 4)
  p_submitted_at timestamptz default null  -- bank-statement posted date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
  v_expense_id uuid;
  v_date timestamptz := coalesce(p_submitted_at, now());
begin
  -- Only admin / treasurer / super_admin
  select * into v_call from public.profiles where id = auth.uid();
  if not found or v_call.role::text not in ('admin','treasurer','super_admin') then
    raise exception 'Only admins can record expenses.';
  end if;

  if p_user_id is not null then
    -- Zelle payment made TO a member: record as their reimbursement, already settled.
    insert into public.expenses (
      source, title, amount, category, description, notes,
      event_name, payment_method, check_number, card_last4,
      user_id, status, submitted_at, approved_at, paid_at
    ) values (
      'member_submitted',
      p_title,
      p_amount,
      p_category::public.expense_category,
      p_description,
      p_notes,
      p_event_name,
      p_payment_method,
      p_check_number,
      p_card_last4,
      p_user_id,
      'auto_paid',
      v_date,
      v_date,
      v_date
    )
    returning id into v_expense_id;
  else
    insert into public.expenses (
      source, title, amount, category, description, notes,
      event_name, payment_method, check_number, card_last4,
      user_id, status, submitted_at, approved_at, paid_at
    ) values (
      'church_direct',
      p_title,
      p_amount,
      p_category::public.expense_category,
      p_description,
      p_notes,
      p_event_name,
      p_payment_method,
      p_check_number,
      p_card_last4,
      auth.uid(),
      'auto_paid',
      v_date,
      v_date,
      v_date
    )
    returning id into v_expense_id;
  end if;

  return v_expense_id;
end $$;

-- ── 2. admin_update_expense — full record editing ──────────────────────
-- (supersedes 0037 + 0039 — status/note/paid/receipt behavior preserved)
create or replace function public.admin_update_expense(
  p_expense_id      uuid,
  p_status          text default null,
  p_admin_note      text default null,
  p_paid_at         timestamptz default null,
  p_transfer_receipt_path text default null,
  p_title           text default null,
  p_description     text default null,
  p_category        text default null,
  p_amount          numeric default null,
  p_submitted_at    timestamptz default null,
  p_payment_method  text default null,
  p_check_number    text default null,
  p_card_last4      text default null,
  p_event_name      text default null,
  p_notes           text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call from public.profiles where id = auth.uid();
  if not found or v_call.role::text not in ('admin','treasurer','super_admin') then
    raise exception 'Only admins can update expenses.';
  end if;

  if p_amount is not null and p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_category is not null then
    perform p_category::public.expense_category;
  end if;

  update public.expenses
  set
    status     = coalesce(p_status::public.expense_status, status),
    admin_note = coalesce(p_admin_note, admin_note),
    admin_note_at = case when p_admin_note is not null then now() else admin_note_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    paid_at    = coalesce(p_paid_at, paid_at),
    paid_by    = case when p_status = 'paid' then auth.uid() else paid_by end,
    transfer_receipt_path = coalesce(p_transfer_receipt_path, transfer_receipt_path),
    title            = coalesce(p_title, title),
    description      = coalesce(p_description, description),
    category         = case when p_category is not null then p_category::public.expense_category else category end,
    amount           = coalesce(p_amount, amount),
    submitted_at     = coalesce(p_submitted_at, submitted_at),
    payment_method   = coalesce(p_payment_method, payment_method),
    check_number     = coalesce(p_check_number, check_number),
    card_last4       = coalesce(p_card_last4, card_last4),
    event_name       = coalesce(p_event_name, event_name),
    notes            = coalesce(p_notes, notes)
  where id = p_expense_id;
end $$;
