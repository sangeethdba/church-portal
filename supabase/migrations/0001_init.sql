-- ============================================================================
-- GraceLedger — initial schema
-- Run in Supabase SQL editor or `supabase db push` after linking.
-- ============================================================================

-- 0. Required extensions
create extension if not exists "pgcrypto";

-- 1. Enums -------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('member', 'treasurer', 'admin', 'super_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type donation_kind as enum ('tithe', 'offering', 'building', 'missions', 'other', 'book_room');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cash', 'check', 'online', 'card');
exception when duplicate_object then null; end $$;

do $$ begin
  create type expense_source as enum ('member_submitted', 'church_direct');
exception when duplicate_object then null; end $$;

do $$ begin
  create type expense_status as enum (
    'pending',     -- submitted by member, awaiting approval
    'approved',    -- treasurer approved, awaiting payment
    'rejected',    -- treasurer rejected
    'paid',        -- treasurer marked paid (manual)
    'auto_paid'    -- treasurer marked auto-paid (defaulted to paid via system flow)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type expense_category as enum (
    'utilities', 'maintenance', 'supplies', 'missions',
    'events', 'staff', 'benevolence', 'other'
  );
exception when duplicate_object then null; end $$;

-- 2. Profile (one row per auth.user) ----------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role app_role not null default 'member',
  church_name text default 'Grace Community Church',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 3. Donors -----------------------------------------------------------------
create table if not exists public.donors (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip_code text,
  is_family boolean not null default false,
  family_members jsonb not null default '[]'::jsonb,
  notes text,
  is_active boolean not null default true,
  total_donations numeric(12, 2) not null default 0,
  last_donation_date date,
  -- optional link to a portal user (so members can see their own giving)
  linked_user_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists donors_last_name_idx on public.donors (last_name);
create index if not exists donors_email_idx on public.donors (email);
alter table public.donors enable row level security;

-- 4. Donations --------------------------------------------------------------
create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid references public.donors(id) on delete set null,
  donor_name text not null,         -- denormalised so anonymous gifts still record a name
  donor_email text,
  amount numeric(12, 2) not null check (amount >= 0),
  donation_type donation_kind not null default 'tithe',
  payment_method payment_method not null,
  check_number text,
  donation_date date not null default current_date,
  entered_by uuid not null references public.profiles(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists donations_date_idx on public.donations (donation_date desc);
create index if not exists donations_donor_idx on public.donations (donor_id);
alter table public.donations enable row level security;

-- 5. Expenses (member-submitted OR church-direct) ---------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  source expense_source not null,
  title text,                                          -- church-direct entries get a title
  amount numeric(12, 2) not null check (amount > 0),
  category expense_category not null default 'other',
  description text,
  receipt_paths jsonb not null default '[]'::jsonb,     -- array of storage object paths
  user_id uuid references public.profiles(id) on delete set null,    -- who submitted (members)
  status expense_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists expenses_status_idx on public.expenses (status);
create index if not exists expenses_source_idx on public.expenses (source);
alter table public.expenses enable row level security;

-- 6. Reimbursements (ledger of paid-out expenses) ---------------------------
create table if not exists public.reimbursements (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null unique references public.expenses(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  settlement_method text not null default 'bank_transfer',  -- bookkeeping only, no money movement
  reimbursed_by uuid references public.profiles(id) on delete set null,
  reimbursed_at timestamptz not null default now(),
  notes text
);
alter table public.reimbursements enable row level security;

-- 7. Tax receipts (annual statements generated for donors) ------------------
create table if not exists public.tax_receipts (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.donors(id) on delete cascade,
  year smallint not null check (year between 1900 and 2100),
  total_amount numeric(12, 2) not null,
  donation_count integer not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null,
  storage_path text,                                   -- path inside tax-statements bucket
  unique (donor_id, year)
);
create index if not exists tax_receipts_year_idx on public.tax_receipts (year desc);
alter table public.tax_receipts enable row level security;

-- 8. Audit log ---------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);

-- 9. Helper: current role (security definer) --------------------------------
create or replace function public.current_role()
returns app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin_or_treasurer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('admin','treasurer','super_admin'), false);
$$;

-- 10. RLS policies -----------------------------------------------------------

-- profiles
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (auth.uid() = id or public.is_admin_or_treasurer());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id);

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

-- donors
drop policy if exists donors_admin_all on public.donors;
create policy donors_admin_all on public.donors
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

drop policy if exists donors_self_read on public.donors;
create policy donors_self_read on public.donors
  for select using (linked_user_id = auth.uid());

-- donations
drop policy if exists donations_admin_all on public.donations;
create policy donations_admin_all on public.donations
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

drop policy if exists donations_self_read on public.donations;
create policy donations_self_read on public.donations
  for select using (
    donor_id is not null and exists (
      select 1 from public.donors d
      where d.id = donations.donor_id and d.linked_user_id = auth.uid()
    )
  );

-- expenses: members can submit and view their own; admin/treasurer manage all
drop policy if exists expenses_member_insert on public.expenses;
create policy expenses_member_insert on public.expenses
  for insert with check (
    source = 'member_submitted'
    and user_id = auth.uid()
    and status = 'pending'
  );

drop policy if exists expenses_self_read on public.expenses;
create policy expenses_self_read on public.expenses
  for select using (user_id = auth.uid() or public.is_admin_or_treasurer());

drop policy if exists expenses_admin_update on public.expenses;
create policy expenses_admin_update on public.expenses
  for update using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

drop policy if exists expenses_admin_insert on public.expenses;
create policy expenses_admin_insert on public.expenses
  for insert with check (public.is_admin_or_treasurer() and source = 'church_direct');

-- reimbursements: admin/treasurer only
drop policy if exists reimbursements_admin_all on public.reimbursements;
create policy reimbursements_admin_all on public.reimbursements
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

-- tax_receipts: admin/treasurer full; donors read own
drop policy if exists tax_receipts_admin_all on public.tax_receipts;
create policy tax_receipts_admin_all on public.tax_receipts
  for all using (public.is_admin_or_treasurer()) with check (public.is_admin_or_treasurer());

drop policy if exists tax_receipts_donor_read on public.tax_receipts;
create policy tax_receipts_donor_read on public.tax_receipts
  for select using (
    exists (
      select 1 from public.donors d
      where d.id = tax_receipts.donor_id and d.linked_user_id = auth.uid()
    )
  );

-- 11. Auto-create profile on signup ----------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'member')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 12. Storage buckets ------------------------------------------------------
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('tax-statements', 'tax-statements', false)
  on conflict (id) do nothing;

-- Storage policies: receipts
--   members: read/write their own folder `user_id/...`
--   admin/treasurer: read all
drop policy if exists "receipts self read" on storage.objects;
create policy "receipts self read" on storage.objects
  for select to authenticated using (
    bucket_id = 'receipts'
    and (public.is_admin_or_treasurer() or (storage.foldername(name))[1]::uuid = auth.uid())
  );
drop policy if exists "receipts self upload" on storage.objects;
create policy "receipts self upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'receipts' and (storage.foldername(name))[1]::uuid = auth.uid()
  );

-- Storage policies: tax-statements
--   donors read their own statements via profile.linked_user_id
--   admin/treasurer read all
drop policy if exists "tax admin all" on storage.objects;
create policy "tax admin all" on storage.objects
  for all to authenticated using (
    bucket_id = 'tax-statements' and public.is_admin_or_treasurer()
  ) with check (
    bucket_id = 'tax-statements' and public.is_admin_or_treasurer()
  );
drop policy if exists "tax donor read" on storage.objects;
create policy "tax donor read" on storage.objects
  for select to authenticated using (
    bucket_id = 'tax-statements' and exists (
      select 1 from public.donors d
      join public.tax_receipts r on r.donor_id = d.id
      where r.storage_path = storage.objects.name and d.linked_user_id = auth.uid()
    )
  );

-- 13. Bootstrap first super_admin via service_role --------------------------
-- After running this migration, manually promote your user:
--   update public.profiles set role='super_admin' where email='you@example.com';
