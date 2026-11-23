# Series Episode Playback Design

## Goal

Extend the existing MoviesTv-Flix movie playback flow so a real series can expose real seasons and episodes from TMDB and play an episode through the same installed-provider resolver, ranking, source chooser, and in-app video overlay already used for movies.

## Scope

This slice adds end-to-end episode playback for normal numbered seasons. It does not create a second provider pipeline and it does not invent episode metadata from aggregate counts.

A series details screen will:

- show real season summaries returned by TMDB,
- load the selected season's real episode metadata on demand,
- let the user choose an episode,
- resolve that episode through the existing playback runtime,
- rank and auto-select streams using the existing preferred-audio-language rules,
- allow source switching through the existing source chooser.

Season 0 / specials are intentionally excluded from this slice because the current `AddonMediaRequest` contract requires positive season numbers. Supporting specials can be added later as an explicit contract change instead of bypassing validation.

## Existing components that remain authoritative

- `packages/catalog`: catalog contracts, registry, service timeouts, caching, and provider ownership.
- `supabase/functions/catalog`: TMDB-backed catalog API and normalization.
- `packages/addons`: `AddonMediaRequest`, validation, provider registry/resolution, and Stremio request mapping.
- `apps/mobile-tv/src/addons/StremioAddonAdapter.ts`: Stremio provider transport.
- `packages/playback`: source ranking and `PlaybackSessionController`.
- `apps/mobile-tv/src/playback`: app-level playback provider, overlay, source chooser, and `expo-video` player.
- `apps/mobile-tv/src/preferences`: preferred audio language order.
- `apps/mobile-tv/src/i18n`: localized UI copy and English fallback.

The episode feature must reuse these systems rather than duplicate source resolution, ranking, retry, or player behavior.

## Catalog model

### Season summaries on series details

Extend `MediaDetails` with an optional `seasons` array for series only.

Add a `SeriesSeasonSummary` contract containing:

- `id`: stable TMDB-backed season identifier when available,
- `seasonNumber`: the real TMDB season number,
- `name`,
- `episodeCount`,
- `airDate`,
- `posterUrl`.

Only positive `seasonNumber` entries are exposed to the normal episode browser in this slice. The UI must use these summaries directly and must not generate `1..seasonCount` rows from aggregate counts.

### Episode model

Add a `SeriesEpisode` contract containing:

- `id`: stable app ID derived from the TMDB episode ID, for example `tmdb:episode:12345`,
- `seriesId`: parent catalog series ID,
- `seasonNumber`,
- `episodeNumber`,
- `title`,
- optional `overview`, `airDate`, `runtimeMinutes`, `stillUrl`, and `rating`.

The episode's own TMDB ID is an internal catalog identity. Provider playback identifiers come from the parent series because the existing Stremio protocol requires the series IMDb ID plus season and episode numbers.

### Season payload

Add `SeriesSeason` containing:

- `seriesId`,
- `seasonNumber`,
- optional season metadata,
- `episodes: SeriesEpisode[]`.

## Catalog gateway and service

Extend `CatalogGateway` with:

`getSeason(seriesId: string, seasonNumber: number): Promise<SeriesSeason | null>`

Extend `CatalogService` with `getSeason()` using the same provider ownership strategy as `getDetails()` and a dedicated cache key such as:

`season:<seriesId>:<seasonNumber>`

Use a long-but-refreshable cache TTL (24 hours, matching details) because published episode metadata changes much less often than browse/search results. A stale cached season may be returned only when all live provider attempts fail, matching the existing details behavior.

`DemoCatalogGateway` receives deterministic demo season data so offline/demo mode and tests remain functional.

## Remote catalog API

Extend the Supabase catalog request union with:

`{ action: 'season'; mediaId: string; seasonNumber: number }`

Validation requirements:

- `mediaId` must parse as a TMDB series catalog ID,
- `seasonNumber` must be a positive integer,
- movie IDs are rejected for the season action.

For series details, normalize TMDB's `seasons` array into `SeriesSeasonSummary[]`, excluding season 0 from the normal selector.

For a season request, call:

`/tv/{tmdbSeriesId}/season/{seasonNumber}`

Normalize only real episode records with valid TMDB episode IDs and positive episode numbers. The API must not fabricate missing episodes.

No per-episode external-ID fan-out is required. Fetching one extra TMDB endpoint per episode would be expensive and unnecessary for current playback because the parent series already carries the IMDb series ID from `external_ids`.

## Playback request construction

Extend `PlaybackApi` with:

`playEpisode(series: MediaDetails, episode: SeriesEpisode): Promise<void>`

`playEpisode` validates that:

- `series.kind === 'series'`,
- the parent series has a usable TMDB or IMDb external ID,
- `episode.seriesId === series.id`,
- season and episode numbers are positive integers.

It then calls the existing `PlaybackSessionController.resolve()` with:

- `mediaId: episode.id`,
- `kind: 'episode'`,
- `externalIds: series.externalIds`,
- `seasonNumber: episode.seasonNumber`,
- `episodeNumber: episode.episodeNumber`.

This deliberately supplies the parent series external IDs. The existing `toStremioStreamRequest()` already converts an episode request into a Stremio series stream ID shaped as:

`{seriesImdbId}:{season}:{episode}`

No change to source ranking, provider timeout behavior, retry, source switching, stream normalization, or the player is needed.

## Series details UI

For `details.kind === 'series'`, replace the current unavailable playback state with an episode browser when playable metadata exists.

### Season selector

- Default to the first real positive-numbered season returned by the catalog.
- Show only actual season summaries from `details.seasons`.
- Phone: horizontally scrollable/touch-friendly season chips or compact selector.
- Android TV: focusable season controls with visible focus state and predictable left/right navigation.
- Changing season starts an on-demand `CatalogService.getSeason()` load.

### Episode list

Each episode row/card shows:

- episode number,
- title,
- still image when available,
- runtime when available,
- air date when available,
- short overview when space allows.

Pressing an episode calls `playEpisode(details, episode)`.

The first episode list must not auto-play merely because a season loads. Playback remains an explicit user action.

### Loading and error states

The episode browser has local states independent of playback state:

- loading season metadata,
- loaded episodes,
- no episode metadata,
- failed season load with retry.

Raw backend/provider errors are not displayed. Use localized generic catalog copy.

Changing series or season invalidates stale in-flight UI results so an older request cannot replace a newer selection.

## Localization

Add localized keys for:

- Season
- Episode
- Episodes
- Loading episodes
- No episodes available
- Couldn't load episodes
- Retry

Priority languages receive first-party strings in English, Albanian, French, and German. Other existing locales may use the established English fallback behavior.

## Security and privacy

- Episode metadata contains no provider secrets.
- Parent series external IDs are already non-secret catalog metadata.
- Secure add-on configuration remains inside the existing add-on runtime.
- Stream URLs and headers continue to flow only through normalized `StreamSource` objects and are not persisted by the new episode UI.
- Raw provider or backend exception messages are not surfaced in user-facing episode states.

## Testing strategy

Use TDD for every behavior change.

1. Catalog type/service tests define season summary and episode contracts, provider ownership, caching, timeout/fallback, and invalid-season behavior.
2. Supabase request tests define `season` parsing and reject movies, zero/negative/non-integer season numbers, and malformed IDs.
3. TMDB normalization tests prove real season summaries and episode rows are normalized without fabricating data and season 0 is excluded from the normal selector.
4. Remote gateway tests prove `getSeason()` sends the correct request body.
5. Playback provider tests prove `playEpisode()` sends `kind: 'episode'`, the parent series external IDs, and the real season/episode numbers; retry and source switching continue to reuse the current controller request.
6. Series details tests prove real seasons render, season changes load the right data, episode press starts playback, loading/error/retry states behave correctly, and movies keep their existing Play behavior.
7. TV-focused tests verify season and episode controls are focusable and source playback remains reachable by remote.
8. Full workspace verification runs lint, TypeScript, and all tests.
9. Android phone/TV APK verification remains a release gate, but this feature branch stays independent of the separate Android standalone-build fix PR.

## Non-goals

This slice does not add:

- season 0 / specials playback,
- automatic next-episode playback,
- episode progress/resume tracking,
- watched-state synchronization,
- binge autoplay,
- per-episode IMDb external-ID fan-out,
- subtitle-provider changes,
- live TV behavior changes.

Those can be layered on after the core episode identity and playback path are stable.

## Success criteria

- A TMDB-backed series displays real positive-numbered seasons rather than generated season numbers.
- Selecting a season loads its real TMDB episodes on demand.
- Selecting an episode builds one valid existing `AddonMediaRequest` with the parent series IDs plus real season/episode numbers.
- Existing installed-provider filtering, source ranking, preferred-language behavior, retry, source chooser, and `expo-video` playback are reused unchanged.
- Movie playback remains unchanged.
- No fake episode metadata or IDs are created.
- Existing auth, sync, catalog, localization, provider-security, and navigation behavior remains green.