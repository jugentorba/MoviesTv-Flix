alter table public.user_preferences
  add column if not exists my_list_items jsonb not null default '[]'::jsonb;

alter table public.user_preferences
  add column if not exists my_list_items_updated_at timestamptz not null default now();
