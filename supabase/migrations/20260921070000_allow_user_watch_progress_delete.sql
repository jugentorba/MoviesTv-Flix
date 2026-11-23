grant delete on table public.user_watch_progress to authenticated;

drop policy if exists "Users can delete own watch progress"
on public.user_watch_progress;

create policy "Users can delete own watch progress"
on public.user_watch_progress for delete
to authenticated
using ((select auth.uid()) = user_id);
