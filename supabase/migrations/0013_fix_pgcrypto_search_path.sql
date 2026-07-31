-- ============================================================================
-- GraceLedger — fix "function crypt(text, text) does not exist"
-- pgcrypto lives in the `extensions` schema on Supabase managed projects, but
-- hash_pin / sign_offering were created with search_path = public only, so
-- runtime calls to crypt()/gen_salt() failed when signing off an offering.
-- ============================================================================

-- Ensure the extension is installed (no-op if already present).
create extension if not exists pgcrypto;

-- Point both PIN functions at public AND extensions so crypt()/gen_salt()
-- resolve whether pgcrypto lives in public (local CLI) or extensions
-- (Supabase managed projects).
alter function public.hash_pin(text)
  set search_path = public, extensions;

alter function public.sign_offering(uuid, uuid, text, uuid, text)
  set search_path = public, extensions;
