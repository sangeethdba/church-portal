-- Migration 0039: Fix submit_donation param ordering + storage admin upload policy
-- + add transfer_receipt_path to admin_update_expense
--
-- 1. submit_donation: p_donor_id had a default but was the FIRST parameter,
--    which invalidates all subsequent non-default params (PostgreSQL 42P13).
--    Fix: move p_donor_id to be the LAST parameter.
--
-- 2. admin_update_expense: add p_transfer_receipt_path so the bank transfer
--    receipt uploaded during "Clear reimbursement" is persisted to the DB.
--
-- 3. Storage: add admin upload/modify/delete policies so the treasurer can
--    upload transfer receipts, deposit slips, etc. to any folder in the
--    receipts bucket — not just their own UUID-named folder.

-- ── 1. Fix submit_donation param ordering ───────────────────────────────
create or replace function public.submit_donation(
  p_donor_name     text,
  p_amount         numeric,
  p_donation_type  text,
  p_payment_method text,
  p_check_number   text default null,
  p_donation_date  date default null,
  p_notes          text default null,
  p_donor_id       uuid default null          -- moved last — must come after all others
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_donation_id uuid;
begin
  insert into public.donations (
    donor_id, donor_name, amount, donation_type,
    payment_method, check_number, donation_date,
    notes, entered_by
  ) values (
    p_donor_id,
    p_donor_name,
    p_amount,
    p_donation_type::public.donation_kind,
    p_payment_method::public.payment_method,
    p_check_number,
    coalesce(p_donation_date, current_date),
    p_notes,
    auth.uid()
  )
  returning id into v_donation_id;

  return v_donation_id;
end $$;

-- ── 2. Fix admin_update_expense — add transfer_receipt_path ────────────
create or replace function public.admin_update_expense(
  p_expense_id uuid,
  p_status     text default null,
  p_admin_note text default null,
  p_paid_at    timestamptz default null,
  p_transfer_receipt_path text default null
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

  update public.expenses
  set
    status     = coalesce(p_status::public.expense_status, status),
    admin_note = coalesce(p_admin_note, admin_note),
    admin_note_at = case when p_admin_note is not null then now() else admin_note_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    paid_at    = coalesce(p_paid_at, paid_at),
    paid_by    = case when p_status = 'paid' then auth.uid() else paid_by end,
    transfer_receipt_path = coalesce(p_transfer_receipt_path, transfer_receipt_path)
  where id = p_expense_id;
end $$;

-- ── 3. Admin / treasurer storage upload policy ─────────────────────────
-- The existing "receipts self upload" policy requires the first folder
-- segment to be the uploader's own UUID.  This blocked admin actions like
-- uploading a transfer receipt to transfers/<expenseId>/... where the
-- first segment isn't a UUID at all.
--
-- This new policy lets admins and treasurers upload to any path inside the
-- receipts bucket — deposit slips, transfer receipts, etc.
drop policy if exists "receipts admin upload" on storage.objects;
create policy "receipts admin upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'receipts' and public.is_admin_or_treasurer()
  );

-- Also ensure admins can delete/update their own uploads if needed
drop policy if exists "receipts admin modify" on storage.objects;
create policy "receipts admin modify" on storage.objects
  for update to authenticated using (
    bucket_id = 'receipts' and public.is_admin_or_treasurer()
  ) with check (
    bucket_id = 'receipts' and public.is_admin_or_treasurer()
  );

drop policy if exists "receipts admin delete" on storage.objects;
create policy "receipts admin delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'receipts' and public.is_admin_or_treasurer()
  );
