-- Esegui tutto questo file nel "SQL Editor" di Supabase.
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_date date not null,
  event_code text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.photos
add column if not exists event_code text
default replace(gen_random_uuid()::text, '-', '');

update public.photos
set event_code = replace(gen_random_uuid()::text, '-', '')
where event_code is null;

alter table public.photos alter column event_code set not null;
create index if not exists photos_event_code_idx on public.photos(event_code);

create table if not exists public.admin_settings (
  id smallint primary key default 1 check (id = 1),
  secret_hash bytea not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings enable row level security;
revoke all on table public.admin_settings from anon, authenticated;

create or replace function public.is_admin_request()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  request_headers jsonb;
  supplied_key text;
begin
  request_headers := coalesce(
    nullif(current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;
  supplied_key := coalesce(request_headers ->> 'x-polaroid-admin-key', '');

  return exists (
    select 1
    from public.admin_settings
    where id = 1
      and secret_hash = extensions.digest(supplied_key, 'sha256')
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.is_admin_request() from public;
grant execute on function public.is_admin_request() to anon, authenticated;

alter table public.photos enable row level security;

drop policy if exists "Tutti possono vedere le foto" on public.photos;
create policy "Tutti possono vedere le foto"
on public.photos for select using (true);

drop policy if exists "Solo admin autenticato inserisce foto" on public.photos;
create policy "Solo admin autenticato inserisce foto"
on public.photos for insert
with check (public.is_admin_request());

drop policy if exists "Solo admin autenticato elimina foto" on public.photos;
create policy "Solo admin autenticato elimina foto"
on public.photos for delete
using (public.is_admin_request());

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Tutti possono visualizzare i file" on storage.objects;
create policy "Tutti possono visualizzare i file"
on storage.objects for select using (bucket_id = 'photos');

drop policy if exists "Solo admin carica i file" on storage.objects;
create policy "Solo admin carica i file"
on storage.objects for insert
with check (
  bucket_id = 'photos'
  and public.is_admin_request()
);

drop policy if exists "Solo admin elimina i file" on storage.objects;
create policy "Solo admin elimina i file"
on storage.objects for delete
using (
  bucket_id = 'photos'
  and public.is_admin_request()
);

-- La chiave amministratore non va salvata in questo file pubblico.
-- Inserisci soltanto il suo hash SHA-256 nella tabella admin_settings.
