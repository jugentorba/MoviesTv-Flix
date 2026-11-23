-- Prevent stale devices from overwriting newer synchronized provider and
-- watch-progress state. Client reconciliation already applies these rules;
-- these triggers enforce the same invariants when concurrent upserts race.

create or replace function public.preserve_newer_user_addon()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists preserve_newer_user_addon
  on public.user_addons;

create trigger preserve_newer_user_addon
before update on public.user_addons
for each row
execute function public.preserve_newer_user_addon();


create or replace function public.merge_user_watch_progress()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_completed boolean;
  new_completed boolean;
  merged_position double precision;
begin
  old_completed := old.completed
    or (
      old.duration_seconds > 0
      and old.position_seconds / old.duration_seconds >= 0.9
    );
  new_completed := new.completed
    or (
      new.duration_seconds > 0
      and new.position_seconds / new.duration_seconds >= 0.9
    );

  -- An explicit reset epoch always outranks a record without one. When both
  -- sides have reset epochs, the newest reset wins even if its play position
  -- is lower; that is the intentional "start over" signal.
  if old.reset_at is not null or new.reset_at is not null then
    if old.reset_at is null then
      new.completed := new_completed;
      return new;
    end if;

    if new.reset_at is null then
      new := old;
      new.completed := old_completed;
      return new;
    end if;

    if new.reset_at > old.reset_at then
      new.completed := new_completed;
      return new;
    end if;

    if new.reset_at < old.reset_at then
      new := old;
      new.completed := old_completed;
      return new;
    end if;
  end if;

  -- Within the same reset epoch (including no reset), metadata comes from the
  -- newest edit, while playback position and completion are sticky.
  merged_position := greatest(old.position_seconds, new.position_seconds);

  if new.updated_at < old.updated_at then
    new.kind := old.kind;
    new.title := old.title;
    new.poster_url := old.poster_url;
    new.release_year := old.release_year;
    new.imdb_id := old.imdb_id;
    new.tmdb_id := old.tmdb_id;
    new.series_id := old.series_id;
    new.season_number := old.season_number;
    new.episode_number := old.episode_number;
    new.duration_seconds := old.duration_seconds;
    new.updated_at := old.updated_at;
  end if;

  new.position_seconds := merged_position;
  new.completed := old_completed or new_completed;
  return new;
end;
$$;

drop trigger if exists merge_user_watch_progress
  on public.user_watch_progress;

create trigger merge_user_watch_progress
before update on public.user_watch_progress
for each row
execute function public.merge_user_watch_progress();
