create table if not exists public.user_addons (
  user_id uuid not null references auth.users(id) on delete cascade,
  addon_id text not null,
  manifest_url text,
  source_type text not null check (source_type in ('native', 'stremio-manifest')),
  enabled boolean not null default false,
  priority integer not null default 0,
  safe_config jsonb not null default '{}'::jsonb,
  setup_incomplete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, addon_id)
);

alter table public.user_addons enable row level security;

create policy "Users can read own add-ons"
on public.user_addons for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own add-ons"
on public.user_addons for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own add-ons"
on public.user_addons for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own add-ons"
on public.user_addons for delete
to authenticated
using (auth.uid() = user_id);
