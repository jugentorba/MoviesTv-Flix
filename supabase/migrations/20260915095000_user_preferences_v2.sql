create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_locale text not null default 'system',
  app_locale_updated_at timestamptz not null default now(),
  preferred_audio_languages jsonb not null default '[]'::jsonb,
  preferred_audio_languages_updated_at timestamptz not null default now(),
  preferred_subtitle_languages jsonb not null default '[]'::jsonb,
  preferred_subtitle_languages_updated_at timestamptz not null default now(),
  subtitles_enabled boolean not null default true,
  subtitles_enabled_updated_at timestamptz not null default now(),
  autoplay boolean not null default true,
  autoplay_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users can read own preferences" on public.user_preferences;
create policy "Users can read own preferences"
on public.user_preferences for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own preferences" on public.user_preferences;
create policy "Users can insert own preferences"
on public.user_preferences for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own preferences" on public.user_preferences;
create policy "Users can update own preferences"
on public.user_preferences for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
