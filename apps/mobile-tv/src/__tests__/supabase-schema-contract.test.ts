import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationsDir = resolve(__dirname, '../../../../supabase/migrations');
const sql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(resolve(migrationsDir, name), 'utf8'))
  .join('\n')
  .toLowerCase();

const watchProgressDeleteSql = readFileSync(
  resolve(
    migrationsDir,
    '20260921070000_allow_user_watch_progress_delete.sql',
  ),
  'utf8',
)
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

function expectColumns(table: string, columns: readonly string[]) {
  expect(sql).toContain(`public.${table}`);
  for (const column of columns) {
    expect(sql).toContain(column.toLowerCase());
  }
}

test('Supabase migrations cover every synchronized preference field', () => {
  expectColumns('user_preferences', [
    'user_id',
    'app_locale',
    'app_locale_updated_at',
    'preferred_audio_languages',
    'preferred_audio_languages_updated_at',
    'preferred_subtitle_languages',
    'preferred_subtitle_languages_updated_at',
    'subtitles_enabled',
    'subtitles_enabled_updated_at',
    'autoplay',
    'autoplay_updated_at',
    'favorite_channel_ids',
    'favorite_channel_ids_updated_at',
    'my_list_items',
    'my_list_items_updated_at',
    'updated_at',
  ]);
});

test('Supabase migrations cover every synchronized add-on identity field', () => {
  expectColumns('user_addons', [
    'user_id',
    'addon_id',
    'manifest_url',
    'source_type',
    'enabled',
    'priority',
    'safe_config',
    'setup_incomplete',
    'updated_at',
    'provider_name',
    'capabilities',
    'media_kinds',
    'configurable',
  ]);
});

test('Supabase migrations cover movie and episode watch-progress fields', () => {
  expectColumns('user_watch_progress', [
    'user_id',
    'media_id',
    'kind',
    'title',
    'poster_url',
    'release_year',
    'imdb_id',
    'tmdb_id',
    'series_id',
    'season_number',
    'episode_number',
    'position_seconds',
    'duration_seconds',
    'completed',
    'reset_at',
    'updated_at',
  ]);
  expect(sql).toContain("kind in ('movie', 'episode')");
});

test('sync tables enable RLS and grant only authenticated client access', () => {
  for (const table of [
    'user_preferences',
    'user_addons',
    'user_watch_progress',
  ]) {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(`revoke all on table public.${table} from anon`);
  }

  expect(sql).toContain(
    'grant select, insert, update on table public.user_preferences to authenticated',
  );
  expect(sql).toContain(
    'grant select, insert, update, delete on table public.user_addons to authenticated',
  );
  expect(sql).toContain(
    'grant select, insert, update on table public.user_watch_progress to authenticated',
  );
  expect(sql).toContain(
    'grant delete on table public.user_watch_progress to authenticated',
  );
  expect(sql).toContain(
    'create policy "users can delete own watch progress"',
  );
  expect(sql).toContain(
    'on public.user_watch_progress for delete',
  );
  expect(sql).toContain(
    'using ((select auth.uid()) = user_id)',
  );
  expect(watchProgressDeleteSql).toContain(
    'grant delete on table public.user_watch_progress to authenticated; '
    + 'drop policy if exists "users can delete own watch progress" '
    + 'on public.user_watch_progress; '
    + 'create policy "users can delete own watch progress" '
    + 'on public.user_watch_progress for delete '
    + 'to authenticated '
    + 'using ((select auth.uid()) = user_id);',
  );
});

test('Supabase preserves newer per-field preferences during concurrent device upserts', () => {
  expect(sql).toContain('preserve_newer_user_preferences');
  for (const timestampColumn of [
    'app_locale_updated_at',
    'preferred_audio_languages_updated_at',
    'preferred_subtitle_languages_updated_at',
    'subtitles_enabled_updated_at',
    'autoplay_updated_at',
    'favorite_channel_ids_updated_at',
    'my_list_items_updated_at',
  ]) {
    expect(sql).toContain(
      `new.${timestampColumn} < old.${timestampColumn}`,
    );
  }
  expect(sql).toContain(
    'before update on public.user_preferences',
  );
});

test('Supabase guards stale provider and watch-progress upserts', () => {
  expect(sql).toContain('preserve_newer_user_addon');
  expect(sql).toContain('new.updated_at < old.updated_at');
  expect(sql).toContain('before update on public.user_addons');

  expect(sql).toContain('merge_user_watch_progress');
  expect(sql).toContain('new.reset_at > old.reset_at');
  expect(sql).toContain('new.reset_at < old.reset_at');
  expect(sql).toContain(
    'greatest(old.position_seconds, new.position_seconds)',
  );
  expect(sql).toContain(
    'new.completed := old_completed or new_completed',
  );
  expect(sql).toContain(
    'before update on public.user_watch_progress',
  );
});
