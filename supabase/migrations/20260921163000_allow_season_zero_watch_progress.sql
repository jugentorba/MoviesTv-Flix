alter table public.user_watch_progress
  drop constraint if exists user_watch_progress_episode_numbers_check;

alter table public.user_watch_progress
  add constraint user_watch_progress_episode_numbers_check
  check (
    (kind = 'movie' and season_number is null and episode_number is null)
    or
    (
      kind = 'episode'
      and (
        (season_number is null and episode_number is null)
        or
        (season_number >= 0 and episode_number > 0)
      )
    )
  );
