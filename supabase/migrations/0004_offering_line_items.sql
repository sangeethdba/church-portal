-- ============================================================================
-- GraceLedger — offering line items: cash breakdown, deductions, per-check donors
-- Run in Supabase SQL editor after 0003_roles_and_receipts.sql.
-- ============================================================================

-- 1. Allow multiple entries per service (drop unique constraint)
alter table public.offerings drop constraint if exists offerings_service_date_service_name_key;

-- 2. Add cash detail columns
alter table public.offerings add column if not exists cash_breakdown jsonb not null default '{}'::jsonb;
alter table public.offerings add column if not exists cash_deductions jsonb not null default '[]'::jsonb;
alter table public.offerings add column if not exists cash_net numeric(12,2) not null default 0;

-- 3. Replace generated total_amount with a regular column
alter table public.offerings drop column if exists total_amount;
alter table public.offerings add column total_amount numeric(12,2) not null default 0;

-- 4. Individual checks linked to donors
create table if not exists public.offering_checks (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings(id) on delete cascade,
  donor_id uuid references public.donors(id) on delete set null,
  donor_name text not null,
  check_number text,
  amount numeric(12,2) not null check (amount > 0),
  donation_id uuid references public.donations(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists offering_checks_offering_idx on public.offering_checks (offering_id);

alter table public.offering_checks enable row level security;

drop policy if exists offering_checks_read on public.offering_checks;
create policy offering_checks_read on public.offering_checks
  for select to authenticated using (true);

drop policy if exists offering_checks_insert on public.offering_checks;
create policy offering_checks_insert on public.offering_checks
  for insert to authenticated with check (true);
