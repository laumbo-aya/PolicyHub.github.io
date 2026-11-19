-- PolicyHub Supabase setup. Run once in the Supabase SQL Editor.
-- Uses Supabase Auth, Postgres RLS, and a private Storage bucket.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_code text not null unique,
  email text not null unique,
  user_name text not null default '',
  department text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  owner text not null default '',
  version text not null default '1.0',
  due_date date,
  filename text not null,
  content_type text not null,
  storage_path text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.document_assignments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  read_started_at timestamptz,
  required_read_minutes integer check (required_read_minutes between 1 and 120),
  acknowledged_at timestamptz,
  unique(document_id, user_id)
);

create table if not exists public.reading_settings (
  id smallint primary key check (id = 1),
  reading_minutes integer not null default 1 check (reading_minutes between 1 and 120),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.reading_settings (id, reading_minutes)
values (1, 1)
on conflict (id) do nothing;

create or replace function public.is_policyhub_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and is_active
  );
$$;

create or replace function public.handle_new_policyhub_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, user_code, email, user_name, department, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'user_code', ''), 'PH-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'user_name', ''),
    coalesce(new.raw_user_meta_data->>'department', ''),
    'user'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_policyhub on auth.users;
create trigger on_auth_user_created_policyhub
  after insert on auth.users
  for each row execute procedure public.handle_new_policyhub_user();

insert into public.profiles (id, user_code, email, user_name, department, role)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'user_code', ''), 'PH-' || upper(substr(replace(u.id::text, '-', ''), 1, 8))),
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data->>'user_name', ''),
  coalesce(u.raw_user_meta_data->>'department', ''),
  'user'
from auth.users u
on conflict (id) do nothing;

create or replace function public.start_document_reading(p_assignment_id uuid)
returns table (read_started_at timestamptz, required_read_minutes integer, eligible_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz;
  v_minutes integer;
  v_current_minutes integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Active PolicyHub account required' using errcode = '42501';
  end if;

  select reading_minutes into v_current_minutes from public.reading_settings where id = 1;
  update public.document_assignments as a
    set read_started_at = coalesce(a.read_started_at, now()),
        required_read_minutes = coalesce(a.required_read_minutes, v_current_minutes)
    where a.id = p_assignment_id
      and a.user_id = auth.uid()
      and a.acknowledged_at is null
  returning a.read_started_at, a.required_read_minutes into v_started, v_minutes;

  if not found then
    raise exception 'Pending assignment not found' using errcode = '42501';
  end if;

  return query select v_started, v_minutes, v_started + make_interval(mins => v_minutes);
end;
$$;

create or replace function public.acknowledge_document(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acknowledged timestamptz;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active) then
    raise exception 'Active PolicyHub account required' using errcode = '42501';
  end if;

  update public.document_assignments as a
    set acknowledged_at = now()
    where a.id = p_assignment_id
      and a.user_id = auth.uid()
      and a.acknowledged_at is null
      and a.read_started_at is not null
      and a.required_read_minutes is not null
      and now() >= a.read_started_at + make_interval(mins => a.required_read_minutes)
  returning a.acknowledged_at into v_acknowledged;

  if v_acknowledged is null then
    select acknowledged_at into v_acknowledged
      from public.document_assignments
      where id = p_assignment_id and user_id = auth.uid();
  end if;

  if v_acknowledged is null then
    raise exception 'Reading time has not finished or assignment is unavailable' using errcode = '42501';
  end if;
  return v_acknowledged;
end;
$$;

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_assignments enable row level security;
alter table public.reading_settings enable row level security;

drop policy if exists "profile self or admin read" on public.profiles;
create policy "profile self or admin read" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_policyhub_admin());
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles
  for all to authenticated using (public.is_policyhub_admin()) with check (public.is_policyhub_admin());

drop policy if exists "assigned users or admins read documents" on public.documents;
create policy "assigned users or admins read documents" on public.documents
  for select to authenticated using (
    public.is_policyhub_admin() or (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active) and exists (
      select 1 from public.document_assignments a
      where a.document_id = documents.id and a.user_id = (select auth.uid())
    ))
  );
drop policy if exists "admins manage documents" on public.documents;
create policy "admins manage documents" on public.documents
  for all to authenticated using (public.is_policyhub_admin()) with check (public.is_policyhub_admin());

drop policy if exists "users read own assignments admins read all" on public.document_assignments;
create policy "users read own assignments admins read all" on public.document_assignments
  for select to authenticated using (
    public.is_policyhub_admin() or (
      user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active)
    )
  );
drop policy if exists "admins manage assignments" on public.document_assignments;
create policy "admins manage assignments" on public.document_assignments
  for all to authenticated using (public.is_policyhub_admin()) with check (public.is_policyhub_admin());

drop policy if exists "signed in users read timer" on public.reading_settings;
create policy "signed in users read timer" on public.reading_settings
  for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active));
drop policy if exists "admins manage timer" on public.reading_settings;
create policy "admins manage timer" on public.reading_settings
  for update to authenticated using (public.is_policyhub_admin()) with check (public.is_policyhub_admin());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_assignments to authenticated;
grant select, update on public.reading_settings to authenticated;
revoke all on function public.is_policyhub_admin() from public, anon;
revoke all on function public.start_document_reading(uuid) from public, anon;
revoke all on function public.acknowledge_document(uuid) from public, anon;
grant execute on function public.is_policyhub_admin() to authenticated;
grant execute on function public.start_document_reading(uuid) to authenticated;
grant execute on function public.acknowledge_document(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policyhub-documents',
  'policyhub-documents',
  false,
  4194304,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 4194304,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins upload PolicyHub files" on storage.objects;
create policy "admins upload PolicyHub files" on storage.objects
  for insert to authenticated with check (bucket_id = 'policyhub-documents' and public.is_policyhub_admin());
drop policy if exists "assigned users read PolicyHub files" on storage.objects;
create policy "assigned users read PolicyHub files" on storage.objects
  for select to authenticated using (
    bucket_id = 'policyhub-documents' and (
      public.is_policyhub_admin() or (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active) and exists (
        select 1 from public.documents d
        join public.document_assignments a on a.document_id = d.id
        where d.storage_path = storage.objects.name and a.user_id = (select auth.uid())
      ))
    )
  );
drop policy if exists "admins delete PolicyHub files" on storage.objects;
create policy "admins delete PolicyHub files" on storage.objects
  for delete to authenticated using (bucket_id = 'policyhub-documents' and public.is_policyhub_admin());

-- First administrator bootstrap: after creating the first Auth user in the Dashboard,
-- replace the email below and run this once to promote that profile.
-- update public.profiles set role = 'admin' where email = 'admin@example.com';
