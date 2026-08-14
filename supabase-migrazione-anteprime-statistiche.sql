-- Esegui questo file una sola volta nel SQL Editor di Supabase.
-- Aggiunge anteprime leggere e tempo medio, senza cancellare foto o dati esistenti.

alter table public.photos
add column if not exists preview_storage_path text;

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
