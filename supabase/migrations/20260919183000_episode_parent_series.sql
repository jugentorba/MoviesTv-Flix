alter table public.user_watch_progress
  add column if not exists series_id text;

alter table public.user_watch_progress
  drop constraint if exists user_watch_progress_series_id_check;

alter table public.user_watch_progress
  add constraint user_watch_progress_series_id_check
  check (
    (kind = 'movie' and series_id is null)
    or
    (kind = 'episode')
  );
