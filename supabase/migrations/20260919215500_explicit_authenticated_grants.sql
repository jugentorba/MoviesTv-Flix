-- Make authenticated client permissions explicit instead of relying on
-- project-level default grants. Row Level Security still restricts every row
-- to auth.uid() = user_id.

revoke all on table public.user_preferences from anon;
grant select, insert, update on table public.user_preferences to authenticated;

revoke all on table public.user_addons from anon;
grant select, insert, update, delete on table public.user_addons to authenticated;
