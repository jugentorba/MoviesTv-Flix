alter table public.user_addons
  add column if not exists provider_name text;

alter table public.user_addons
  add column if not exists capabilities text[] not null default '{}';

alter table public.user_addons
  add column if not exists media_kinds text[] not null default '{}';

alter table public.user_addons
  add column if not exists configurable boolean not null default false;
