-- ============================================================================
-- 0055_bank_reconciliation.sql
--
-- Minimal bank reconciliation for a small-church environment.
-- Admin starts a new recon for a period → system populates items from
-- deposited offerings (money in) and paid expenses (money out) → admin
-- checks off what cleared the bank → saves / closes the period.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  closed_at     timestamptz
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  entity_type       text NOT NULL CHECK (entity_type IN ('deposit', 'expense')),
  entity_id         uuid NOT NULL,
  is_cleared        boolean DEFAULT false,
  cleared_at        timestamptz,
  UNIQUE(reconciliation_id, entity_type, entity_id)
);

-- Index for fetching items by reconciliation
CREATE INDEX IF NOT EXISTS idx_recon_items_reconciliation
  ON reconciliation_items(reconciliation_id);

-- RLS: admin/treasurer only
ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_items ENABLE ROW LEVEL SECURITY;

-- Allow admin/treasurer to SELECT, INSERT, UPDATE
DO $$
BEGIN
  -- bank_reconciliations policies
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_select_bank_reconciliations' AND tablename = 'bank_reconciliations'
  ) THEN
    CREATE POLICY admins_select_bank_reconciliations ON bank_reconciliations
      FOR SELECT USING (public.is_admin_or_treasurer() OR public.is_oversight_read());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_insert_bank_reconciliations' AND tablename = 'bank_reconciliations'
  ) THEN
    CREATE POLICY admins_insert_bank_reconciliations ON bank_reconciliations
      FOR INSERT WITH CHECK (public.is_admin_or_treasurer());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_update_bank_reconciliations' AND tablename = 'bank_reconciliations'
  ) THEN
    CREATE POLICY admins_update_bank_reconciliations ON bank_reconciliations
      FOR UPDATE USING (public.is_admin_or_treasurer());
  END IF;

  -- reconciliation_items policies (inherit from parent via admin check)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_select_reconciliation_items' AND tablename = 'reconciliation_items'
  ) THEN
    CREATE POLICY admins_select_reconciliation_items ON reconciliation_items
      FOR SELECT USING (public.is_admin_or_treasurer() OR public.is_oversight_read());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_insert_reconciliation_items' AND tablename = 'reconciliation_items'
  ) THEN
    CREATE POLICY admins_insert_reconciliation_items ON reconciliation_items
      FOR INSERT WITH CHECK (public.is_admin_or_treasurer());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_update_reconciliation_items' AND tablename = 'reconciliation_items'
  ) THEN
    CREATE POLICY admins_update_reconciliation_items ON reconciliation_items
      FOR UPDATE USING (public.is_admin_or_treasurer());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admins_delete_reconciliation_items' AND tablename = 'reconciliation_items'
  ) THEN
    CREATE POLICY admins_delete_reconciliation_items ON reconciliation_items
      FOR DELETE USING (public.is_admin_or_treasurer());
  END IF;
END $$;
