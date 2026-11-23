-- Preserve the newest per-field preference value when two devices update the
-- same user_preferences row concurrently. Client reconciliation already uses
-- each *_updated_at column; this trigger enforces the same safety boundary at
-- the database so a stale full-row upsert cannot erase a newer field.

create or replace function public.preserve_newer_user_preferences()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.app_locale_updated_at < old.app_locale_updated_at then
    new.app_locale := old.app_locale;
    new.app_locale_updated_at := old.app_locale_updated_at;
  end if;

  if new.preferred_audio_languages_updated_at < old.preferred_audio_languages_updated_at then
    new.preferred_audio_languages := old.preferred_audio_languages;
    new.preferred_audio_languages_updated_at := old.preferred_audio_languages_updated_at;
  end if;

  if new.preferred_subtitle_languages_updated_at < old.preferred_subtitle_languages_updated_at then
    new.preferred_subtitle_languages := old.preferred_subtitle_languages;
    new.preferred_subtitle_languages_updated_at := old.preferred_subtitle_languages_updated_at;
  end if;

  if new.subtitles_enabled_updated_at < old.subtitles_enabled_updated_at then
    new.subtitles_enabled := old.subtitles_enabled;
    new.subtitles_enabled_updated_at := old.subtitles_enabled_updated_at;
  end if;

  if new.autoplay_updated_at < old.autoplay_updated_at then
    new.autoplay := old.autoplay;
    new.autoplay_updated_at := old.autoplay_updated_at;
  end if;

  if new.favorite_channel_ids_updated_at < old.favorite_channel_ids_updated_at then
    new.favorite_channel_ids := old.favorite_channel_ids;
    new.favorite_channel_ids_updated_at := old.favorite_channel_ids_updated_at;
  end if;

  if new.my_list_items_updated_at < old.my_list_items_updated_at then
    new.my_list_items := old.my_list_items;
    new.my_list_items_updated_at := old.my_list_items_updated_at;
  end if;

  new.updated_at := greatest(old.updated_at, new.updated_at);
  return new;
end;
$$;

drop trigger if exists preserve_newer_user_preferences
  on public.user_preferences;

create trigger preserve_newer_user_preferences
before update on public.user_preferences
for each row
execute function public.preserve_newer_user_preferences();
