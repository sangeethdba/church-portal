-- ============================================================================
-- GraceLedger — deposit tracking
-- Run in Supabase SQL editor after 0005_counter_sign_off.sql.
-- ============================================================================

-- 1. Deposit status enum
do $$ begin
  create type deposit_status as enum ('pending_deposit', 'deposited');
exception when duplicate_object then null; end $$;

-- 2. Add deposit tracking columns to offerings
alter table public.offerings
  add column if not exists deposit_status deposit_status not null default 'pending_deposit',
  add column if not exists deposited_at timestamptz,
  add column if not exists deposit_receipt_path text;

-- 3. RPC: mark offering as deposited
create or replace function public.mark_deposited(
  p_offering_id uuid,
  p_receipt_path text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.offerings
     set deposit_status = 'deposited',
         deposited_at = now(),
         deposit_receipt_path = p_receipt_path
   where id = p_offering_id;
  return found;
end $$;
