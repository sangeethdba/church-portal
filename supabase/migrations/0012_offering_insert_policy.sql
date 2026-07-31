-- ============================================================================
-- GraceLedger — offering/donation insert policy fix
-- 0005 limited inserts to `role = 'admin'` or counters; that silently locked
-- out treasurer/super_admin. Use the standard admin helper instead.
-- ============================================================================

-- Offerings: counters + all admin-level roles can record
drop policy if exists offerings_insert on public.offerings;
create policy offerings_insert on public.offerings
  for insert to authenticated with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_counter = true or public.is_admin_or_treasurer())
    )
  );

-- Donations: counters + all admin-level roles can insert
drop policy if exists donations_admin_all on public.donations;
create policy donations_admin_all on public.donations
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_counter = true or public.is_admin_or_treasurer())
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and (is_counter = true or public.is_admin_or_treasurer())
    )
  );
