-- ============================================================================
-- GraceLedger — weekly service offerings table
-- Run in Supabase SQL editor after 0001_init.sql.
-- ============================================================================

-- Weekly service offering record (cash + checks collected per service)
create table if not exists public.offerings (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_name text not null default 'Sunday Service',
  cash_amount numeric(12,2) not null default 0 check (cash_amount >= 0),
  check_amount numeric(12,2) not null default 0 check (check_amount >= 0),
  total_amount numeric(12,2) generated always as (cash_amount + check_amount) stored,
  check_count integer not null default 0,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, service_name)
);

create index if not exists offerings_date_idx on public.offerings (service_date desc);

alter table public.offerings enable row level security;

-- RLS: any authenticated user can record offerings (members, treasurer, admin)
drop policy if exists offerings_insert on public.offerings;
create policy offerings_insert on public.offerings
  for insert to authenticated with check (true);

-- RLS: admin/treasurer can update/delete
drop policy if exists offerings_admin_all on public.offerings;
create policy offerings_admin_all on public.offerings
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

-- RLS: any authenticated user can view all offerings
drop policy if exists offerings_read on public.offerings;
create policy offerings_read on public.offerings
  for select to authenticated using (true);
