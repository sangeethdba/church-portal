-- ============================================================================
-- 0050_add_get_caller_info.sql
--
-- Migration 0049 (pastor_oversight_role) defines get_dashboard_kpis,
-- get_all_profiles, and get_reports_data — all of which call
--
--   select * into c from public._get_caller_info();
--
-- but the helper was never created. Every call to those RPCs fails
-- with "function _get_caller_info() does not exist", which the front-end
-- catches and silently falls back to demo data. This migration adds the
-- missing helper so all three RPCs start returning real data.
--
-- Idempotent: safe to re-run (drops first, then recreates).
-- ============================================================================

drop function if exists public._get_caller_info();

create or replace function public._get_caller_info()
returns table (
    uid          uuid,
    is_admin     boolean,
    profile_row  public.profiles
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    uid := auth.uid();

    if uid is null then
        raise exception 'Not authenticated';
    end if;

    select * into profile_row
    from public.profiles p
    where p.id = uid;

    if not found then
        raise exception 'No profile record for this user. Sign out and back in.';
    end if;

    is_admin := profile_row.role::text in ('admin', 'treasurer', 'super_admin');

    return next;
end;
$$;

-- Let authenticated users call it (no write side-effects).
grant execute on function public._get_caller_info() to authenticated;
grant execute on function public._get_caller_info() to service_role;

comment on function public._get_caller_info() is
  'Returns (uid uuid, is_admin boolean, profile_row profiles). '
  'Used by get_dashboard_kpis, get_all_profiles, and get_reports_data '
  'to avoid recursive RLS chains.';
