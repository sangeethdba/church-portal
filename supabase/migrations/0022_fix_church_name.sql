-- Fix the stale church name: existing profiles carry the old default
-- 'Grace Community Church' from migration 0001. Rebrand to
-- Atlanta Little Flock Church and set the new default for future rows.

alter table public.profiles
  alter column church_name set default 'Atlanta Little Flock Church';

update public.profiles
  set church_name = 'Atlanta Little Flock Church'
  where church_name is null
     or church_name = ''
     or church_name = 'Grace Community Church';
