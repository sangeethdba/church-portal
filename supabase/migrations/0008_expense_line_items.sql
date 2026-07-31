-- ============================================================================
-- GraceLedger — batch expense line items
-- Run in Supabase SQL editor after 0007_expense_payment_method.sql.
-- ============================================================================

-- Add line_items column for multi-bill batch submission
alter table public.expenses
  add column if not exists line_items jsonb default '[]'::jsonb;
