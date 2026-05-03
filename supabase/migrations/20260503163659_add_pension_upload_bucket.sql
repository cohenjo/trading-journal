-- Migration: 20260503163659_add_pension_upload_bucket
-- Purpose: Create private pension PDF upload bucket and household-scoped Storage policies for TJ-020.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pension-uploads', 'pension-uploads', false, 10485760, array['application/pdf'])
on conflict (id) do update
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf'];

drop policy if exists pension_uploads_member_insert on storage.objects;
create policy pension_uploads_member_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pension-uploads'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.is_household_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists pension_uploads_member_select on storage.objects;
create policy pension_uploads_member_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'pension-uploads'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.is_household_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists pension_uploads_member_delete on storage.objects;
create policy pension_uploads_member_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'pension-uploads'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then public.is_household_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
