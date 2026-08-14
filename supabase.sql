-- Esegui tutto questo file nel "SQL Editor" di Supabase.
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_date date not null,
  event_code text not null,
  storage_path text not null unique,
  preview_storage_path text,
  download_count bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.photos
add column if not exists event_code text
default replace(gen_random_uuid()::text, '-', '');
alter table public.photos
add column if not exists download_count bigint not null default 0;
alter table public.photos
add column if not exists preview_storage_path text;

update public.photos
set event_code = replace(gen_random_uuid()::text, '-', '')
where event_code is null;

alter table public.photos alter column event_code set not null;
create index if not exists photos_event_code_idx on public.photos(event_code);

create table if not exists public.admin_settings (
  id smallint primary key default 1 check (id = 1),
  username text not null,
  email text not null,
  password_hash bytea not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings add column if not exists username text;
alter table public.admin_settings add column if not exists email text;
alter table public.admin_settings add column if not exists password_hash bytea;
alter table public.admin_settings add column if not exists display_name text not null default '';
alter table public.admin_settings enable row level security;
revoke all on table public.admin_settings from anon, authenticated;

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year')
);

alter table public.admin_sessions enable row level security;
revoke all on table public.admin_sessions from anon, authenticated;

create or replace function public.is_admin_request()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  request_headers jsonb;
  supplied_session text;
begin
  request_headers := coalesce(
    nullif(current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;
  supplied_session := coalesce(request_headers ->> 'x-polaroid-session', '');

  return exists (
    select 1
    from public.admin_sessions
    where token_hash = extensions.digest(supplied_session, 'sha256')
      and expires_at > now()
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.is_admin_request() from public;
grant execute on function public.is_admin_request() to anon, authenticated;

create or replace function public.register_admin_account(
  supplied_username text,
  supplied_email text,
  supplied_password text
)
returns table (ok boolean, message text, session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_username text := trim(coalesce(supplied_username, ''));
  clean_email text := lower(trim(coalesce(supplied_email, '')));
  new_token text;
begin
  if length(clean_username) < 2 then
    return query select false, 'Inserisci un nome utente valido.', null::text;
    return;
  end if;
  if position('@' in clean_email) < 2 then
    return query select false, 'Inserisci un indirizzo e-mail valido.', null::text;
    return;
  end if;
  if length(coalesce(supplied_password, '')) < 4 then
    return query select false, 'La password deve contenere almeno 4 caratteri.', null::text;
    return;
  end if;

  lock table public.admin_settings in exclusive mode;
  if exists (select 1 from public.admin_settings) then
    return query select false, 'L’account amministratore esiste già. Torna ad Accedi.', null::text;
    return;
  end if;

  insert into public.admin_settings (id, username, email, password_hash, display_name)
  values (1, clean_username, clean_email, extensions.digest(supplied_password, 'sha256'), clean_username);

  new_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.admin_sessions (token_hash)
  values (extensions.digest(new_token, 'sha256'));
  return query select true, 'Account creato.', new_token;
end;
$$;

create or replace function public.login_admin_account(
  supplied_email text,
  supplied_password text
)
returns table (ok boolean, message text, session_token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_identifier text := lower(trim(coalesce(supplied_email, '')));
  new_token text;
begin
  if not exists (
    select 1 from public.admin_settings
    where clean_identifier in (lower(email), lower(username))
      and password_hash = extensions.digest(coalesce(supplied_password, ''), 'sha256')
  ) then
    return query select false, 'E-mail o password non corretti.', null::text;
    return;
  end if;

  delete from public.admin_sessions where expires_at <= now();
  new_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.admin_sessions (token_hash)
  values (extensions.digest(new_token, 'sha256'));
  return query select true, 'Accesso effettuato.', new_token;
end;
$$;

create or replace function public.get_admin_profile()
returns table (username text, email text, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_request() then return; end if;
  return query select a.username, a.email, a.display_name from public.admin_settings a where a.id = 1;
end;
$$;

create or replace function public.update_admin_profile(
  new_username text,
  new_email text,
  new_display_name text,
  new_password text default null
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_username text := trim(coalesce(new_username, ''));
  clean_email text := lower(trim(coalesce(new_email, '')));
begin
  if not public.is_admin_request() then
    return query select false, 'Sessione scaduta. Accedi di nuovo.';
    return;
  end if;
  if length(clean_username) < 2 or position('@' in clean_email) < 2 then
    return query select false, 'Controlla nome utente ed e-mail.';
    return;
  end if;
  if new_password is not null and length(new_password) between 1 and 3 then
    return query select false, 'La nuova password deve avere almeno 4 caratteri.';
    return;
  end if;

  update public.admin_settings
  set username = clean_username,
      email = clean_email,
      display_name = left(trim(coalesce(new_display_name, '')), 60),
      password_hash = case when coalesce(new_password, '') = '' then password_hash else extensions.digest(new_password, 'sha256') end,
      updated_at = now()
  where id = 1;
  return query select true, 'Profilo aggiornato.';
end;
$$;

create or replace function public.logout_admin_session()
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  request_headers jsonb;
  supplied_session text;
begin
  request_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  supplied_session := coalesce(request_headers ->> 'x-polaroid-session', '');
  delete from public.admin_sessions where token_hash = extensions.digest(supplied_session, 'sha256');
  return true;
end;
$$;

revoke all on function public.register_admin_account(text, text, text) from public;
revoke all on function public.login_admin_account(text, text) from public;
revoke all on function public.get_admin_profile() from public;
revoke all on function public.update_admin_profile(text, text, text, text) from public;
revoke all on function public.logout_admin_session() from public;
grant execute on function public.register_admin_account(text, text, text) to anon, authenticated;
grant execute on function public.login_admin_account(text, text) to anon, authenticated;
grant execute on function public.get_admin_profile() to anon, authenticated;
grant execute on function public.update_admin_profile(text, text, text, text) to anon, authenticated;
grant execute on function public.logout_admin_session() to anon, authenticated;

create or replace function public.increment_photo_download(
  target_photo_id uuid,
  target_event_code text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  update public.photos
  set download_count = download_count + 1
  where id = target_photo_id
    and event_code = target_event_code
  returning download_count into new_count;

  return new_count;
end;
$$;

revoke all on function public.increment_photo_download(uuid, text) from public;
grant execute on function public.increment_photo_download(uuid, text) to anon, authenticated;

create table if not exists public.event_visits (
  id bigint generated by default as identity primary key,
  event_code text not null,
  visitor_key uuid not null,
  first_seen_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.event_visits'::regclass
      and conname = 'event_visits_pkey'
      and pg_get_constraintdef(oid) like '%event_code%visitor_key%'
  ) then
    alter table public.event_visits drop constraint event_visits_pkey;
  end if;
end;
$$;

alter table public.event_visits
add column if not exists id bigint generated by default as identity;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.event_visits'::regclass
      and contype = 'p'
  ) then
    alter table public.event_visits add primary key (id);
  end if;
end;
$$;

alter table public.event_visits enable row level security;
revoke all on table public.event_visits from anon, authenticated;

create or replace function public.record_gallery_visit(
  target_event_code text,
  target_visitor_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.photos where event_code = target_event_code
  ) then
    return false;
  end if;

  insert into public.event_visits (event_code, visitor_key)
  values (target_event_code, target_visitor_key);

  return true;
end;
$$;

revoke all on function public.record_gallery_visit(text, uuid) from public;
grant execute on function public.record_gallery_visit(text, uuid) to anon, authenticated;

create or replace function public.get_admin_gallery_stats()
returns table (total_visitors bigint, total_downloads bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_request() then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  return query
  select
    (select count(*)::bigint from public.event_visits),
    (select coalesce(sum(download_count), 0)::bigint from public.photos);
end;
$$;

revoke all on function public.get_admin_gallery_stats() from public;
grant execute on function public.get_admin_gallery_stats() to anon, authenticated;

create table if not exists public.gallery_sessions (
  id uuid primary key,
  event_code text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.gallery_sessions enable row level security;
revoke all on table public.gallery_sessions from anon, authenticated;

create or replace function public.record_gallery_session(
  target_event_code text,
  target_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.photos where event_code = target_event_code
  ) then
    return false;
  end if;

  insert into public.gallery_sessions (id, event_code)
  values (target_session_id, target_event_code)
  on conflict (id) do update
  set last_seen_at = now();

  return true;
end;
$$;

revoke all on function public.record_gallery_session(text, uuid) from public;
grant execute on function public.record_gallery_session(text, uuid) to anon, authenticated;

create or replace function public.get_admin_engagement_stats()
returns table (
  total_visitors bigint,
  total_downloads bigint,
  average_session_seconds numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_request() then
    return query select 0::bigint, 0::bigint, 0::numeric;
    return;
  end if;

  return query
  select
    (select count(*)::bigint from public.event_visits),
    (select coalesce(sum(download_count), 0)::bigint from public.photos),
    (
      select coalesce(avg(extract(epoch from (last_seen_at - started_at))), 0)::numeric
      from public.gallery_sessions
    );
end;
$$;

revoke all on function public.get_admin_engagement_stats() from public;
grant execute on function public.get_admin_engagement_stats() to anon, authenticated;

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

-- Al primo avvio apri il sito e premi Registrati.
-- La password non viene mai inserita nel codice pubblico di GitHub.
