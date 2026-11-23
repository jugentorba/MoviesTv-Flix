create table if not exists public.user_watch_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id text not null,
  kind text not null check (kind = 'movie'),
  title text not null check (length(trim(title)) > 0),
  poster_url text,
  release_year integer check (release_year between 1888 and 3000),
  position_seconds double precision not null default 0 check (position_seconds >= 0),
  duration_seconds double precision not null default 0 check (duration_seconds >= 0),
  completed boolean not null default false,
  reset_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, media_id)
);

create index if not exists user_watch_progress_user_id_idx
  on public.user_watch_progress (user_id);

alter table public.user_watch_progress enable row level security;

revoke all on table public.user_watch_progress from anon;
revoke delete on table public.user_watch_progress from authenticated;
grant select, insert, update on table public.user_watch_progress to authenticated;

drop policy if exists "Users can read own watch progress" on public.user_watch_progress;
create policy "Users can read own watch progress"
on public.user_watch_progress for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own watch progress" on public.user_watch_progress;
create policy "Users can insert own watch progress"
on public.user_watch_progress for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own watch progress" on public.user_watch_progress;
create policy "Users can update own watch progress"
on public.user_watch_progress for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
