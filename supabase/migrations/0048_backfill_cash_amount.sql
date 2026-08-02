-- ============================================================================
-- 0048 — Backfill cash_amount for offerings recorded before the RPC wrote it.
-- The record_offering RPC (0042) previously stored cash only in cash_net,
-- leaving the legacy cash_amount column at its default 0. The weekly trend
-- chart and offering totals read cash_amount, so those rows showed $0 cash.
-- ============================================================================

update public.offerings
set cash_amount = cash_net
where cash_amount = 0 and cash_net > 0;

-- Verify
select service_date, service_name,
       cash_amount, cash_net, check_amount, total_amount
from public.offerings
order by service_date desc
limit 20;
