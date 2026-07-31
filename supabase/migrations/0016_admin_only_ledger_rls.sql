-- 0016: Ledger tables are admin-only. Counters verify cash and sign off with
-- their PIN (via the security-definer RPCs), but they are otherwise regular
-- members — they must NOT read or write the full offerings/donations ledgers.
-- Only admin, treasurer, and super_admin roles can.

-- Offerings: read + insert restricted to admin-level roles
drop policy if exists offerings_read on public.offerings;
create policy offerings_read on public.offerings
  for select to authenticated using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and public.is_admin_or_treasurer()
    )
  );

drop policy if exists offerings_insert on public.offerings;
create policy offerings_insert on public.offerings
  for insert to authenticated with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and public.is_admin_or_treasurer()
    )
  );

-- Offering checks: read + insert restricted to admin-level roles
drop policy if exists offering_checks_read on public.offering_checks;
create policy offering_checks_read on public.offering_checks
  for select to authenticated using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and public.is_admin_or_treasurer()
    )
  );

drop policy if exists offering_checks_insert on public.offering_checks;
create policy offering_checks_insert on public.offering_checks
  for insert to authenticated with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and public.is_admin_or_treasurer()
    )
  );

-- Donations: admin-level roles can manage all; members keep reading their own
-- linked records through donations_self_read (defined in 0001).
drop policy if exists donations_admin_all on public.donations;
create policy donations_admin_all on public.donations
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and public.is_admin_or_treasurer()
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and public.is_admin_or_treasurer()
    )
  );
