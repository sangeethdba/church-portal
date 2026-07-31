-- ============================================================================
-- GraceLedger — check-based expense tracking
-- Run in Supabase SQL editor after 0006_deposit_tracking.sql.
-- ============================================================================

-- 1. Add payment method and check number to expenses
alter table public.expenses
  add column if not exists payment_method text default 'online',
  add column if not exists check_number text;
