-- Esegui tutto questo file nel "SQL Editor" di Supabase.
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_date date not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.photos enable row level security;

create policy "Tutti possono vedere le foto"
on public.photos for select using (true);

create policy "Solo admin autenticato inserisce foto"
on public.photos for insert to authenticated with check (true);

create policy "Solo admin autenticato elimina foto"
on public.photos for delete to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

create policy "Tutti possono visualizzare i file"
on storage.objects for select using (bucket_id = 'photos');

create policy "Solo admin carica i file"
on storage.objects for insert to authenticated with check (bucket_id = 'photos');

create policy "Solo admin elimina i file"
on storage.objects for delete to authenticated using (bucket_id = 'photos');
