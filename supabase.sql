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

alter table public.photos enable row level security;

drop policy if exists "Tutti possono vedere le foto" on public.photos;
create policy "Tutti possono vedere le foto"
on public.photos for select using (true);

drop policy if exists "Solo admin autenticato inserisce foto" on public.photos;
create policy "Solo admin autenticato inserisce foto"
on public.photos for insert to authenticated with check (true);

drop policy if exists "Solo admin autenticato elimina foto" on public.photos;
create policy "Solo admin autenticato elimina foto"
on public.photos for delete to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Tutti possono visualizzare i file" on storage.objects;
create policy "Tutti possono visualizzare i file"
on storage.objects for select using (bucket_id = 'photos');

drop policy if exists "Solo admin carica i file" on storage.objects;
create policy "Solo admin carica i file"
on storage.objects for insert to authenticated with check (bucket_id = 'photos');

drop policy if exists "Solo admin elimina i file" on storage.objects;
create policy "Solo admin elimina i file"
on storage.objects for delete to authenticated using (bucket_id = 'photos');
