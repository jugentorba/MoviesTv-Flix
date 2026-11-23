# Series Episode Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real TMDB-backed season/episode browsing and episode playback through the existing MoviesTv-Flix provider ranking and player pipeline.

**Architecture:** Extend the catalog contract with real season summaries and episode payloads, expose one cached `getSeason()` service path, and extend the Supabase TMDB catalog API with a validated `season` action. The mobile/TV UI loads episodes on demand and calls a new `playEpisode(series, episode)` API that reuses the current `PlaybackSessionController`, installed-provider resolver, ranking, source chooser, and `expo-video` overlay.

**Tech Stack:** TypeScript 5.9, React 19, React Native TVOS 0.85, Expo SDK 56, Jest 29, Supabase Edge Functions/Deno, TMDB API, pnpm 11.25.

**Spec:** `docs/superpowers/specs/2026-09-17-series-episode-playback-design.md`

## Global Constraints

- Use only real TMDB season and episode metadata; never generate episode rows from `seasonCount` or `episodeCount`.
- Exclude season 0 / specials from this slice.
- Episode provider requests must use the parent series external IDs plus real positive season/episode numbers.
- Reuse the existing add-on resolver, source ranking, retry, source chooser, and `expo-video` player unchanged unless a failing regression test proves a necessary compatibility fix.
- Do not persist stream URLs or headers in episode UI state.
- Do not expose raw backend/provider errors in user-facing episode states.
- Priority localization for new copy: English, Albanian, French, German; other locales use the existing English fallback.
- Keep the feature branch independent of the Android standalone-build fix PR.

---

### Task 1: Catalog season and episode contracts plus cached service lookup

**Files:**
- Modify: `packages/catalog/src/types.ts`
- Modify: `packages/catalog/src/service.ts`
- Modify: `packages/catalog/src/__tests__/service.test.ts`

**Interfaces:**
- Produces: `SeriesSeasonSummary`, `SeriesEpisode`, `SeriesSeason`.
- Produces: `CatalogGateway.getSeason(seriesId: string, seasonNumber: number): Promise<SeriesSeason | null>`.
- Produces: `CatalogService.getSeason(seriesId: string, seasonNumber: number): Promise<SeriesSeason | null>`.

- [ ] **Step 1: Write failing catalog service tests**

Add a season fixture and extend the test gateway with `getSeason()`. Cover owner-provider preference, the cache key `season:<seriesId>:<seasonNumber>`, and stale-cache fallback when live providers fail.

```ts
const season = {
  seriesId: 'tmdb:series:1399',
  seasonNumber: 1,
  name: 'Season 1',
  episodes: [{
    id: 'tmdb:episode:63056',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Winter Is Coming',
  }],
};

it('loads a season from the catalog owner and caches it', async () => {
  const calls: string[] = [];
  const owner = {
    ...gateway('tmdb'),
    async getSeason(seriesId: string, seasonNumber: number) {
      calls.push(`${seriesId}:${seasonNumber}`);
      return season;
    },
  };
  const cache = new (catalog as any).MemoryCatalogCache();
  const service = new (catalog as any).CatalogService(
    new (catalog as any).CatalogRegistry([{ gateway: owner, enabled: true, priority: 1 }]),
    cache,
  );

  await expect(service.getSeason('tmdb:series:1399', 1)).resolves.toEqual(season);
  await expect(service.getSeason('tmdb:series:1399', 1)).resolves.toEqual(season);
  expect(calls).toEqual(['tmdb:series:1399:1']);
});
```

- [ ] **Step 2: Run the focused catalog test and confirm red**

Run:

```bash
pnpm --filter @moviestv/catalog test -- --runInBand src/__tests__/service.test.ts
```

Expected: FAIL because `CatalogService.getSeason` and the gateway contract do not exist.

- [ ] **Step 3: Add the catalog data contracts**

Add to `packages/catalog/src/types.ts`:

```ts
export interface SeriesSeasonSummary {
  id: string;
  seasonNumber: number;
  name: string;
  episodeCount?: number;
  airDate?: string;
  posterUrl?: string;
}

export interface SeriesEpisode {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  airDate?: string;
  runtimeMinutes?: number;
  stillUrl?: string;
  rating?: number;
}

export interface SeriesSeason {
  seriesId: string;
  seasonNumber: number;
  name?: string;
  airDate?: string;
  posterUrl?: string;
  episodes: SeriesEpisode[];
}
```

Extend `MediaDetails` with `seasons?: SeriesSeasonSummary[]` and `CatalogGateway` with `getSeason(...)`.

- [ ] **Step 4: Implement cached `CatalogService.getSeason()`**

Use a `SEASON_TTL_MS = 24 * 60 * 60 * 1000` constant and the same owner-first fallback pattern as `getDetails()`:

```ts
async getSeason(seriesId: string, seasonNumber: number): Promise<SeriesSeason | null> {
  const key = `season:${seriesId}:${seasonNumber}`;
  const cached = await this.cache?.get<SeriesSeason | null>(key);
  if (cached && !cached.stale) return cached.value;

  const providerId = seriesId.split(':', 1)[0];
  const owner = this.registry.find(providerId);
  const ordered = owner
    ? [owner, ...this.registry.enabled().filter((entry) => entry !== owner)]
    : this.registry.enabled();

  for (const entry of ordered) {
    try {
      const result = await withTimeout(entry.gateway.getSeason(seriesId, seasonNumber));
      if (result) {
        await this.cache?.set(key, result, SEASON_TTL_MS);
        return result;
      }
    } catch {
      continue;
    }
  }
  return cached?.value ?? null;
}
```

- [ ] **Step 5: Run catalog tests and typecheck**

```bash
pnpm --filter @moviestv/catalog test -- --runInBand
pnpm --filter @moviestv/catalog typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/catalog/src/types.ts packages/catalog/src/service.ts packages/catalog/src/__tests__/service.test.ts
git commit -m "feat: add catalog season and episode contracts"
```

---

### Task 2: TMDB catalog request parsing and season normalization

**Files:**
- Modify: `supabase/functions/catalog/request.ts`
- Modify: `supabase/functions/catalog/normalize.ts`
- Modify: `supabase/functions/catalog/index.ts`
- Create: `supabase/functions/catalog/request.test.ts`
- Create: `supabase/functions/catalog/normalize.test.ts`

**Interfaces:**
- Consumes: `SeriesSeasonSummary`, `SeriesEpisode`, `SeriesSeason` JSON shapes from Task 1.
- Produces: catalog request `{ action: 'season'; mediaId: string; seasonNumber: number }`.
- Produces: `normalizeTmdbSeason(payload, seriesId, seasonNumber)`.

- [ ] **Step 1: Write failing request parser tests**

Use Jest-compatible tests that import `parseCatalogRequest` and cover:

```ts
expect(parseCatalogRequest({ action: 'season', mediaId: 'tmdb:series:1399', seasonNumber: 1 }))
  .toEqual({ action: 'season', mediaId: 'tmdb:series:1399', seasonNumber: 1 });

expect(() => parseCatalogRequest({ action: 'season', mediaId: 'tmdb:movie:550', seasonNumber: 1 }))
  .toThrow('Season requests require a series ID');
expect(() => parseCatalogRequest({ action: 'season', mediaId: 'tmdb:series:1399', seasonNumber: 0 }))
  .toThrow('Invalid season number');
expect(() => parseCatalogRequest({ action: 'season', mediaId: 'tmdb:series:1399', seasonNumber: 1.5 }))
  .toThrow('Invalid season number');
```

- [ ] **Step 2: Write failing normalization tests**

For series details, prove season 0 is dropped and positive seasons are mapped from TMDB's real `seasons` array. For a season payload, prove only records with numeric TMDB IDs and positive `episode_number` values become episodes.

```ts
const details = normalizeTmdbDetails({
  id: 1399,
  name: 'Game of Thrones',
  seasons: [
    { id: 3627, season_number: 0, name: 'Specials', episode_count: 11 },
    { id: 3624, season_number: 1, name: 'Season 1', episode_count: 10, poster_path: '/s1.jpg' },
  ],
}, 'series');
expect(details?.seasons).toEqual([
  expect.objectContaining({ id: 'tmdb:season:3624', seasonNumber: 1, episodeCount: 10 }),
]);
```

- [ ] **Step 3: Run the new backend tests and confirm red**

Use the repository's Jest runner via root test tooling for these TypeScript modules:

```bash
pnpm exec jest --runInBand supabase/functions/catalog/request.test.ts supabase/functions/catalog/normalize.test.ts
```

Expected: FAIL because season parsing/normalization is absent.

- [ ] **Step 4: Implement strict season request parsing**

Extend `CatalogRequest` and parse the action only after `parseCatalogMediaId(mediaId)` proves `kind === 'series'`; require `Number.isInteger(seasonNumber) && seasonNumber > 0`.

- [ ] **Step 5: Implement TMDB season normalization**

Add helpers that create:

```ts
{
  id: `tmdb:season:${tmdbSeasonId}`,
  seasonNumber,
  name,
  episodeCount,
  airDate,
  posterUrl,
}
```

and:

```ts
{
  id: `tmdb:episode:${tmdbEpisodeId}`,
  seriesId,
  seasonNumber,
  episodeNumber,
  title,
  overview,
  airDate,
  runtimeMinutes,
  stillUrl,
  rating,
}
```

Filter season numbers and episode numbers to positive integers; do not fabricate missing IDs or episode numbers.

- [ ] **Step 6: Route the backend season action**

In `index.ts`, before the details branch:

```ts
if (parsed.action === 'season') {
  const { tmdbId } = parseCatalogMediaId(parsed.mediaId);
  const payload = await fetchTmdbJson(
    `/tv/${tmdbId}/season/${parsed.seasonNumber}`,
    token,
    { language: 'en-US' },
  );
  return json(normalizeTmdbSeason(payload, parsed.mediaId, parsed.seasonNumber));
}
```

- [ ] **Step 7: Run backend tests**

```bash
pnpm exec jest --runInBand supabase/functions/catalog/request.test.ts supabase/functions/catalog/normalize.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add supabase/functions/catalog/request.ts supabase/functions/catalog/normalize.ts supabase/functions/catalog/index.ts supabase/functions/catalog/request.test.ts supabase/functions/catalog/normalize.test.ts
git commit -m "feat: expose TMDB series seasons and episodes"
```

---

### Task 3: Remote and demo catalog gateways support season loading

**Files:**
- Modify: `apps/mobile-tv/src/catalog/RemoteCatalogGateway.ts`
- Modify: `apps/mobile-tv/src/catalog/DemoCatalogGateway.ts`
- Modify: `apps/mobile-tv/src/catalog/demo-data.ts`
- Modify: `apps/mobile-tv/src/catalog/__tests__/catalog-gateways.test.ts`

**Interfaces:**
- Consumes: `CatalogGateway.getSeason()` from Task 1.
- Produces: remote POST `{ action: 'season', mediaId, seasonNumber }`.
- Produces: deterministic demo `SeriesSeason` data for demo-mode series.

- [ ] **Step 1: Add failing remote gateway test**

Add a fetch spy and assert the JSON body exactly:

```ts
expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
  action: 'season',
  mediaId: 'tmdb:series:1399',
  seasonNumber: 2,
});
```

- [ ] **Step 2: Add failing demo gateway test**

Assert a known demo series returns deterministic season 1 episodes and unsupported IDs return `null`.

- [ ] **Step 3: Run focused mobile catalog gateway tests**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/catalog/__tests__/catalog-gateways.test.ts
```

Expected: FAIL because `getSeason()` is absent.

- [ ] **Step 4: Implement `RemoteCatalogGateway.getSeason()`**

```ts
getSeason(mediaId: string, seasonNumber: number): Promise<SeriesSeason | null> {
  return this.post<SeriesSeason | null>({ action: 'season', mediaId, seasonNumber });
}
```

- [ ] **Step 5: Add deterministic demo season fixtures and `DemoCatalogGateway.getSeason()`**

Use actual fixed episode objects with stable IDs such as `demo:episode:series-1:1:1`; never generate the list from `episodeCount` at runtime.

- [ ] **Step 6: Run gateway tests and mobile typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/catalog/__tests__/catalog-gateways.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/mobile-tv/src/catalog/RemoteCatalogGateway.ts apps/mobile-tv/src/catalog/DemoCatalogGateway.ts apps/mobile-tv/src/catalog/demo-data.ts apps/mobile-tv/src/catalog/__tests__/catalog-gateways.test.ts
git commit -m "feat: load catalog seasons on demand"
```

---

### Task 4: Episode request construction in the playback provider

**Files:**
- Modify: `apps/mobile-tv/src/playback/usePlayback.ts`
- Modify: `apps/mobile-tv/src/playback/PlaybackProvider.tsx`
- Modify: `apps/mobile-tv/src/playback/__tests__/playback-provider.test.tsx`

**Interfaces:**
- Consumes: `SeriesEpisode` from Task 1.
- Produces: `PlaybackApi.playEpisode(series: MediaDetails, episode: SeriesEpisode): Promise<void>`.

- [ ] **Step 1: Write the failing provider test**

Render the provider with a capturing resolver, then call:

```ts
await api.playEpisode(seriesDetails, {
  id: 'tmdb:episode:63056',
  seriesId: seriesDetails.id,
  seasonNumber: 1,
  episodeNumber: 1,
  title: 'Winter Is Coming',
});
```

Assert the resolver receives exactly:

```ts
{
  mediaId: 'tmdb:episode:63056',
  kind: 'episode',
  externalIds: seriesDetails.externalIds,
  seasonNumber: 1,
  episodeNumber: 1,
}
```

Also assert mismatched `seriesId`, movie parents, and non-positive season/episode numbers do not call the resolver.

- [ ] **Step 2: Run focused playback provider test and confirm red**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/playback/__tests__/playback-provider.test.tsx
```

Expected: FAIL because `playEpisode` does not exist.

- [ ] **Step 3: Extend `PlaybackApi` and implement `playEpisode()`**

```ts
playEpisode(series: MediaDetails, episode: SeriesEpisode): Promise<void>;
```

Validation must be synchronous before `controller.resolve()`:

```ts
if (series.kind !== 'series') return;
if (!series.externalIds.imdb && !series.externalIds.tmdb) return;
if (episode.seriesId !== series.id) return;
if (!Number.isInteger(episode.seasonNumber) || episode.seasonNumber <= 0) return;
if (!Number.isInteger(episode.episodeNumber) || episode.episodeNumber <= 0) return;
```

Then resolve the existing episode-shaped request.

- [ ] **Step 4: Run provider tests**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/playback/__tests__/playback-provider.test.tsx
```

Expected: PASS, including existing movie/retry/source-selection tests.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/mobile-tv/src/playback/usePlayback.ts apps/mobile-tv/src/playback/PlaybackProvider.tsx apps/mobile-tv/src/playback/__tests__/playback-provider.test.tsx
git commit -m "feat: resolve series episode playback"
```

---

### Task 5: Series season selector and episode browser UI

**Files:**
- Create: `apps/mobile-tv/src/catalog/SeriesEpisodeBrowser.tsx`
- Create: `apps/mobile-tv/src/catalog/__tests__/series-episode-browser.test.tsx`
- Modify: `apps/mobile-tv/src/catalog/MediaDetailsScreen.tsx`
- Modify: `apps/mobile-tv/src/catalog/__tests__/media-details-playback.test.tsx`

**Interfaces:**
- Consumes: `MediaDetails.seasons`, `CatalogService.getSeason()`, and `PlaybackApi.playEpisode()`.
- Produces: focusable season controls and explicit episode-play actions.

- [ ] **Step 1: Write failing browser tests for initial season load**

Mock a series with two real season summaries. Assert the first positive season is requested once, loading copy appears while pending, and returned episode rows show episode number/title.

- [ ] **Step 2: Write failing tests for season switching, stale-result protection, retry, and playback**

Cover:

```ts
fireEvent.press(getByTestId('season-2'));
expect(service.getSeason).toHaveBeenLastCalledWith(series.id, 2);

fireEvent.press(getByTestId('episode-2-3'));
expect(playEpisode).toHaveBeenCalledWith(series, expect.objectContaining({ seasonNumber: 2, episodeNumber: 3 }));
```

Use deferred promises to prove a late season-1 response cannot overwrite already-selected season 2.

- [ ] **Step 3: Run focused browser tests and confirm red**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/catalog/__tests__/series-episode-browser.test.tsx src/catalog/__tests__/media-details-playback.test.tsx
```

Expected: FAIL because the browser does not exist and series remains unavailable.

- [ ] **Step 4: Implement `SeriesEpisodeBrowser`**

Keep season/episode state local to the component. Use a monotonically increasing request token/ref or effect cleanup flag so stale promises cannot replace the active season. Render only `details.seasons` entries with positive integer `seasonNumber`.

Required test IDs:

```text
season-<number>
episode-<season>-<episode>
retry-season
```

Each `Pressable` uses `focusable` and the same focused/pressed style pattern already used in `MediaDetailsScreen`.

- [ ] **Step 5: Integrate browser into series details**

Keep movie Play unchanged. For series with at least one usable season summary and a parent TMDB/IMDb ID, render `<SeriesEpisodeBrowser series={details} />` instead of the disabled playback pill. If real season metadata is absent, keep `details.playUnavailable`.

- [ ] **Step 6: Run focused UI tests**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/catalog/__tests__/series-episode-browser.test.tsx src/catalog/__tests__/media-details-playback.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/mobile-tv/src/catalog/SeriesEpisodeBrowser.tsx apps/mobile-tv/src/catalog/MediaDetailsScreen.tsx apps/mobile-tv/src/catalog/__tests__/series-episode-browser.test.tsx apps/mobile-tv/src/catalog/__tests__/media-details-playback.test.tsx
git commit -m "feat: browse and play real series episodes"
```

---

### Task 6: Episode localization and TV-friendly presentation

**Files:**
- Modify: `apps/mobile-tv/src/i18n/resources/index.ts`
- Modify: the appropriate existing resource module under `apps/mobile-tv/src/i18n/resources/`
- Modify: `apps/mobile-tv/src/catalog/SeriesEpisodeBrowser.tsx`
- Modify: `apps/mobile-tv/src/catalog/__tests__/catalog-localization.test.tsx`
- Modify: `apps/mobile-tv/src/catalog/__tests__/series-episode-browser.test.tsx`

**Interfaces:**
- Produces keys: `details.season`, `details.episode`, `details.episodes`, `details.loadingEpisodes`, `details.noEpisodes`, `details.episodeLoadFailed`, and a retry label using existing `common.retry` if present; otherwise add `details.retryEpisodes`.

- [ ] **Step 1: Write failing localization tests**

Assert English/Albanian/French/German render meaningful first-party strings and another existing locale falls back to English.

Required meanings:

```text
EN: Season / Episode / Episodes / Loading episodes… / No episodes available / Couldn't load episodes
SQ: Sezoni / Episodi / Episodet / Duke ngarkuar episodet… / Nuk ka episode të disponueshme / Episodet nuk mund të ngarkoheshin
FR: Saison / Épisode / Épisodes / Chargement des épisodes… / Aucun épisode disponible / Impossible de charger les épisodes
DE: Staffel / Folge / Folgen / Folgen werden geladen… / Keine Folgen verfügbar / Folgen konnten nicht geladen werden
```

- [ ] **Step 2: Run localization/browser tests and confirm red**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/catalog/__tests__/catalog-localization.test.tsx src/catalog/__tests__/series-episode-browser.test.tsx
```

Expected: FAIL on missing keys/copy.

- [ ] **Step 3: Add localized resource keys and English fallback**

Follow the existing resource-merging pattern; do not bypass `t()` with hard-coded episode UI copy.

- [ ] **Step 4: Verify TV focusability and visible focus state in tests**

Assert season and episode `Pressable` controls have `focusable={true}` and changing focus uses the browser's focused border style. Keep navigation order equal to render order: seasons left-to-right, episodes top-to-bottom.

- [ ] **Step 5: Run localization/browser tests**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/catalog/__tests__/catalog-localization.test.tsx src/catalog/__tests__/series-episode-browser.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/mobile-tv/src/i18n/resources apps/mobile-tv/src/catalog/SeriesEpisodeBrowser.tsx apps/mobile-tv/src/catalog/__tests__/catalog-localization.test.tsx apps/mobile-tv/src/catalog/__tests__/series-episode-browser.test.tsx
git commit -m "feat: localize series episode browser"
```

---

### Task 7: Full regression verification and review preparation

**Files:**
- Modify only files required by failures proven in this task.
- Do not touch `.github/workflows/android-preview.yml`; the standalone APK build fix remains isolated in PR #27.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a reviewable feature branch with movie playback unchanged and end-to-end episode request flow covered by tests.

- [ ] **Step 1: Run the entire workspace test suite**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run workspace typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: PASS with zero warnings.

- [ ] **Step 4: Re-run the critical episode tests after any regression fixes**

```bash
pnpm --filter @moviestv/catalog test -- --runInBand src/__tests__/service.test.ts
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/playback/__tests__/playback-provider.test.tsx src/catalog/__tests__/series-episode-browser.test.tsx src/catalog/__tests__/media-details-playback.test.tsx
pnpm exec jest --runInBand supabase/functions/catalog/request.test.ts supabase/functions/catalog/normalize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Compare branch against `main` and inspect every changed file**

Confirm there are no Android build-fix files, CI probes, generated native folders, secrets, or unrelated refactors.

- [ ] **Step 6: Request code review before merge**

Use the requesting-code-review workflow against `main` -> current feature HEAD. Fix every Critical/Important issue before opening a ready-for-review PR.

- [ ] **Step 7: Commit any verified regression fixes**

```bash
git add <only-files-proven-required-by-tests-or-review>
git commit -m "fix: harden series episode playback"
```
