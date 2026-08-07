-- ============================================================================
-- GraceLedger — add 'book_room' to the donation_kind enum
-- Run in Supabase SQL editor after 0050. Allows book room sales (calendars,
-- bibles, books, songs) to be recorded as a separate income type from member
-- giving (tithe/offering/building/missions).
-- ============================================================================

-- Add the new enum value (safe to run twice — fails silently if present)
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'donation_kind' and e.enumlabel = 'book_room'
  ) then
    alter type donation_kind add value 'book_room';
  end if;
end $$;
