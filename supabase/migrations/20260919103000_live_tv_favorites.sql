alter table public.user_preferences
  add column if not exists favorite_channel_ids jsonb not null default '[]'::jsonb;

alter table public.user_preferences
  add column if not exists favorite_channel_ids_updated_at timestamptz not null default now();
