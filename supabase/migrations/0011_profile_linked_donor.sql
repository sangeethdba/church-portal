-- ============================================================================
-- GraceLedger — profile ↔ donor link column
-- The Manage members & access dialog reads profiles.linked_donor_id, but that
-- column was never created. Add it and backfill from donors.linked_user_id.
-- ============================================================================

alter table public.profiles
  add column if not exists linked_donor_id uuid references public.donors(id) on delete set null;

-- Backfill: any donor already linked to a portal user appears as the
-- profile's linked donor so the dropdown shows the existing link.
update public.profiles p
set linked_donor_id = d.id
from public.donors d
where d.linked_user_id = p.id
  and p.linked_donor_id is null;
