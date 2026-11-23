alter table public.user_watch_progress
  drop constraint if exists user_watch_progress_kind_check;

alter table public.user_watch_progress
  add constraint user_watch_progress_kind_check
  check (kind in ('movie', 'episode'));
