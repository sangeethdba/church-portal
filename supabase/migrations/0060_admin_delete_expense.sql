-- Migration 0060: admin-only delete for expense records.
--
-- Bulk imports can pull in rows that shouldn't be in the ledger (a test paste,
-- a duplicated line, a misread amount). Like donations, expenses now have a
-- Delete action — admin / treasurer / super_admin only. The linked
-- reimbursements row (if any) cascades automatically.
--
-- Run once in Supabase → SQL Editor.

create or replace function public.admin_delete_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.profiles;
begin
  select * into v_call from public.profiles where id = auth.uid();
  if not found or v_call.role::text not in ('admin','treasurer','super_admin') then
    raise exception 'Only admins can delete expenses.';
  end if;

  delete from public.expenses where id = p_expense_id;
end $$;
