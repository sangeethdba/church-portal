-- ============================================================================
-- GraceLedger — link offering-created donations to their offering
-- Church-wide totals must not double count: an offering's checks appear both in
-- the offerings total and as individual donation rows. The offering_id column
-- lets reports count each dollar once (offerings total + standalone donations).
-- ============================================================================

alter table public.donations
  add column if not exists offering_id uuid references public.offerings(id) on delete set null;

-- Backfill from existing offering check rows
update public.donations d
set offering_id = oc.offering_id
from public.offering_checks oc
where oc.donation_id = d.id
  and d.offering_id is null;

create index if not exists donations_offering_idx on public.donations (offering_id);
