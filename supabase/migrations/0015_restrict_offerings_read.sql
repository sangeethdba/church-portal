-- 0015: Restrict offerings + offering_checks to counters and admin-level roles.
-- Previously any signed-in member could SELECT the full weekly offering ledger
-- (dates, cash/check totals, counter names) and every donor's check detail via
-- `offering_checks`. Only counters, admins, treasurers, and super_admins should
-- see and manage the collection records.

-- Offerings: replace the permissive "any authenticated user can view" policy
drop policy if exists offerings_read on public.offerings;
create policy offerings_read on public.offerings
  for select to authenticated using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_counter = true or public.is_admin_or_treasurer())
    )
  );

-- Offering checks (per-donor check lines): restrict read to counters + admins
drop policy if exists offering_checks_read on public.offering_checks;
create policy offering_checks_read on public.offering_checks
  for select to authenticated using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_counter = true or public.is_admin_or_treasurer())
    )
  );

-- Offering checks insert: mirror the offerings insert policy
drop policy if exists offering_checks_insert on public.offering_checks;
create policy offering_checks_insert on public.offering_checks
  for insert to authenticated with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_counter = true or public.is_admin_or_treasurer())
    )
  );
