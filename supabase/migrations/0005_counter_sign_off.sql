-- ============================================================================
-- GraceLedger — counter sign-off system
-- Run in Supabase SQL editor after 0004_offering_line_items.sql.
-- ============================================================================

-- 1. Enable pgcrypto for PIN hashing
create extension if not exists pgcrypto;

-- 2. Add counter fields to profiles
alter table public.profiles add column if not exists is_counter boolean not null default false;
alter table public.profiles add column if not exists pin_hash text;

-- 3. Add counter sign-off fields to offerings
alter table public.offerings add column if not exists counter_1_id uuid references public.profiles(id);
alter table public.offerings add column if not exists counter_1_signed_at timestamptz;
alter table public.offerings add column if not exists counter_2_id uuid references public.profiles(id);
alter table public.offerings add column if not exists counter_2_signed_at timestamptz;

-- 4. Helper: hash a PIN (admin use only)
create or replace function public.hash_pin(pin text)
returns text language sql immutable strict as $$
  select crypt(pin, gen_salt('bf'));
$$;

-- 5. RLS: Only counters+admins can insert/update offerings
drop policy if exists offerings_insert on public.offerings;
create policy offerings_insert on public.offerings
  for insert to authenticated with check (
    exists (select 1 from public.profiles where id = auth.uid() and (is_counter = true or role = 'admin'))
  );

drop policy if exists offerings_admin_all on public.offerings;
create policy offerings_admin_all on public.offerings
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- 6. RPC: Verify dual PINs and sign an offering
create or replace function public.sign_offering(
  p_offering_id uuid,
  p_counter_1_id uuid,
  p_pin_1 text,
  p_counter_2_id uuid,
  p_pin_2 text
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  valid_1 boolean;
  valid_2 boolean;
begin
  -- Both counters must be different people
  if p_counter_1_id = p_counter_2_id then
    raise exception 'Counters must be two different people';
  end if;

  -- Verify PIN 1
  select (pin_hash = crypt(p_pin_1, pin_hash))
    into valid_1 from public.profiles
   where id = p_counter_1_id and is_counter = true;

  -- Verify PIN 2
  select (pin_hash = crypt(p_pin_2, pin_hash))
    into valid_2 from public.profiles
   where id = p_counter_2_id and is_counter = true;

  if valid_1 and valid_2 then
    update public.offerings
       set counter_1_id = p_counter_1_id,
           counter_1_signed_at = now(),
           counter_2_id = p_counter_2_id,
           counter_2_signed_at = now()
     where id = p_offering_id;
    return true;
  end if;

  raise exception 'Invalid PIN or unauthorized counter';
end $$;

-- 7. RLS for donations: counters+admins can insert
drop policy if exists donations_admin_all on public.donations;
create policy donations_admin_all on public.donations
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and (is_counter = true or role = 'admin'))
  ) with check (
    exists (select 1 from public.profiles where id = auth.uid() and (is_counter = true or role = 'admin'))
  );
