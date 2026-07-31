-- Run in Supabase SQL editor.
--
-- The old receipts storage policies required the *first path folder* to be the
-- uploader's auth.uid() — but the app stores expense receipts under
-- <expense_id>/..., line-items/<...>, check-images/<...>, and transfer
-- receipts under transfers/<expense_id>/... So EVERY expense-receipt upload was
-- silently denied and members could never read their own receipts back —
-- they only ever saw the amounts.
--
-- New rules (mirrors the app's buildReceiptPath layout):
--   • Members upload under their own profile-id folder: <uid>/check-images/...,
--     <uid>/line-items/..., <uid>/receipts/<expense_id>/...
--   • Admins/treasurers keep full read+write (incl. transfers/<expense_id>/...).
--   • Members can read any file under their own folder, plus receipts belonging
--     to expenses they own (covers admins' transfer receipts and any legacy
--     <expense_id>/... files).

drop policy if exists "receipts self read" on storage.objects;
create policy "receipts self read" on storage.objects
  for select to authenticated using (
    bucket_id = 'receipts'
    and (
      public.is_admin_or_treasurer()
      or (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.expenses e
        where e.user_id = auth.uid()
          and (
            e.id::text = (storage.foldername(name))[1]
            or (
              (storage.foldername(name))[1] = 'transfers'
              and e.id::text = (storage.foldername(name))[2]
            )
          )
      )
    )
  );

drop policy if exists "receipts self upload" on storage.objects;
create policy "receipts self upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'receipts'
    and (
      public.is_admin_or_treasurer()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );
