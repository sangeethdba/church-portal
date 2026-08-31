-- ============================================================================
-- Church Portal — add 'annual_conference' to the donation_kind enum
-- Run in Supabase SQL editor after 0069. Lets the church track special
-- offerings/donations earmarked for the Annual Conference as their own income
-- type (named and unnamed cash gifts given in the weeks around the conference
-- Sunday, alongside Missions/Building/Book room). The running total shows on
-- the Dashboard and is filterable on the Donations page.
-- ============================================================================

-- Add the new enum value (safe to run twice — fails silently if present)
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'donation_kind' and e.enumlabel = 'annual_conference'
  ) then
    alter type donation_kind add value 'annual_conference';
  end if;
end $$;