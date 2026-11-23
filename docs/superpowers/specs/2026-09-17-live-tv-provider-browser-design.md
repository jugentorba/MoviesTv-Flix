# Live TV Provider Browser Design

## Goal

Replace the current Live TV placeholder in the modern MoviesTv-Flix app with a real provider/add-on based channel browser and player that works on phones and Android TV without bundling channel lists, copyrighted streams, or requiring the user to configure M3U/Xtream credentials.

The first Live TV slice must let a user install a compatible add-on/provider, discover real channel metadata exposed by that provider, search/filter those channels, select one, and play its returned stream inside the app. The TV experience must support remote focus and quick channel changes; the phone experience must remain touch-friendly.

## Current architecture and constraints

The modern app already has:

- one installed add-on registry with enable/disable state, priority, synchronized safe metadata, and secure local secret storage,
- Stremio-manifest inspection for movie/series stream providers,
- bounded HTTPS JSON fetching with timeout and response-size protection,
- normalized `StreamSource` objects,
- `expo-video` for in-app playback,
- separate phone and Android TV navigation shells,
- a Live TV tab/rail entry that currently renders only `PlaceholderScreen`,
- a small `@moviestv/live-tv` package that is not sufficient for the modern provider flow.

The old `feature/live-tv-*` branches are not merged directly because they diverge heavily from current `main`. Useful protocol ideas may be reimplemented against the modern contracts, but stale UI/storage architecture must not be imported wholesale.

## Scope of this slice

This slice adds:

- Live TV capability discovery from installed Stremio-compatible provider manifests,
- support for providers exposing `catalog` + `stream` resources for `channel` or `tv` types,
- pure Live TV providers as well as providers that also serve movies/series,
- channel discovery from installed enabled providers,
- metadata-only channel caching for the current session and a manual refresh path,
- country filtering,
- title search,
- A-Z channel ordering,
- preferred country ordering with Albania (`AL`), Kosovo (`XK`), and France (`FR`) surfaced first when present,
- channel playback through normalized `StreamSource` objects and `expo-video`,
- remote-friendly focus and channel zapping on Android TV,
- touch-friendly channel selection on phones,
- localized generic loading, empty, and error states,
- replacing the existing Live TV placeholder on phone and TV navigation.

This slice does **not** add EPG, favorites sync, watch history, recording, catch-up, direct M3U/Xtream support, or bundled channel URLs.

## Provider model

### Extend the existing add-on descriptor

The existing add-on registry remains the single source of truth for installed providers. Live TV does not get a second installation database.

Extend the add-on capability model so an installed descriptor may expose one or both of:

- movie/series streaming,
- Live TV.

Add a `live-tv` capability and an optional Live TV protocol descriptor containing:

- supported resource types: `channel` and/or `tv`,
- playable catalogs,
- manifest URL inherited from the installed add-on.

The movie/series `stream` contract remains unchanged.

A provider manifest is installable when it exposes at least one supported MoviesTv-Flix capability. Therefore a pure Live TV provider must no longer be rejected just because it lacks movie/series types.

### Live TV manifest rules

A compatible Stremio-style Live TV manifest must provide:

- a valid manifest identity (`id`, `name`, `version`),
- at least one `catalog` for type `channel` or `tv`,
- a `stream` resource able to resolve the same type,
- HTTPS provider URLs with no credentials embedded in the URL.

Only catalogs whose type is also playable by the manifest's stream resource are exposed.

Malformed or unsupported catalogs/resources are ignored when a usable capability remains. A manifest with no supported movie/series or Live TV capability is rejected.

## Live TV contracts

The `@moviestv/live-tv` package becomes the protocol/model boundary for this feature.

### LiveTvCatalog

Contains:

- `type: 'channel' | 'tv'`,
- stable catalog `id`,
- display `name`.

### LiveTvProviderDescriptor

Contains:

- provider/add-on ID,
- provider name,
- manifest URL,
- usable catalogs,
- playable stream types,
- installed priority.

### LiveTvChannel

A discovered channel contains metadata only:

- stable local ID scoped to provider, type, and remote channel ID,
- provider ID,
- remote channel ID,
- resource type,
- title,
- optional poster/logo URL,
- optional two-character country code,
- optional genres/category strings if provided safely by the catalog.

The channel object must never persist a resolved stream URL or request headers.

### LiveTvResolvedChannel

Playback resolution returns:

- the selected channel,
- normalized `StreamSource[]`,
- selected source ID when one is usable.

This is runtime state only and is not persisted.

## Provider runtime

Add a dedicated `StremioLiveTvAdapter` in the mobile app that reuses the existing bounded HTTP loader and security rules.

It has two responsibilities:

1. `listChannels(provider)`
   - fetch each declared Live TV catalog,
   - normalize only valid channel metadata,
   - dedupe duplicate remote IDs within that provider,
   - return metadata sorted case-insensitively by title.

2. `resolveChannel(provider, channel)`
   - verify the channel belongs to the provider,
   - request `/stream/<type>/<remoteId>.json`,
   - normalize returned stream candidates through the existing stream normalizer,
   - return runtime sources without storing them.

The adapter does not install providers and does not own UI state.

## Installed-provider selection

A `createLiveTvProviders(installedAddons)` helper derives eligible Live TV providers from `useAddons()` state.

A provider is eligible only when:

- it is enabled,
- setup is complete,
- its descriptor is hydrated,
- it declares Live TV capability,
- its manifest URL is present.

Providers are ordered by the same user-controlled installed priority already used by playback providers.

This keeps one consistent provider-management experience across movies, series, and TV.

## Channel aggregation

Create a `LiveTvChannelService` that owns provider fan-out and metadata caching.

### Listing

For each eligible provider, request channel catalogs concurrently with the existing timeout/size limits. A failing provider must not block healthy providers.

Results are combined without guessing that similarly named channels from different providers are identical. In this first slice, cross-provider duplicates remain separate records because there is no reliable canonical channel ID shared across arbitrary add-ons.

### Cache

Cache channel metadata per provider for a short period (for example 15 minutes) in memory/session state.

The cache may contain:

- channel IDs,
- title,
- provider ID,
- country/category metadata,
- poster/logo URLs.

The cache must never contain resolved stream URLs, authorization headers, cookies, or provider secrets.

A manual refresh bypasses the metadata cache and reloads provider catalogs.

## Filtering and ordering

The browser derives a view model from the aggregated metadata.

### Search

- case-insensitive title search,
- whitespace-normalized,
- local against already loaded channel metadata,
- no network request for each keystroke.

### Country filter

Available country filters are generated only from channel metadata actually returned by installed providers.

Preferred country presentation order:

1. Albania (`AL`)
2. Kosovo (`XK`)
3. France (`FR`)
4. remaining countries alphabetically by code/name

This is only a UI preference. No channel list or stream is hard-coded for those countries.

### Channel order

Within the selected filter, channels are ordered A-Z by title using locale-aware case-insensitive comparison.

Provider priority is used for provider ordering and diagnostics, not to silently merge unrelated same-name channels.

## Playback architecture

Live TV playback gets its own small controller because channel zapping is a different interaction from movie/episode playback.

### State

`LiveTvPlaybackController` exposes:

- `idle`,
- `resolving`,
- `ready`,
- `error`,
- current channel,
- available normalized sources,
- selected source.

### Selecting a channel

When a channel is selected:

1. clear any prior transient error,
2. mark the channel as resolving,
3. ask only that channel's provider adapter for stream candidates,
4. discard stale results if the user selects another channel before resolution finishes,
5. select the first usable normalized source,
6. render it through `expo-video`.

No autoplay occurs merely because channels loaded. Playback starts only from an explicit user channel selection.

### Source handling

If a channel returns multiple valid sources, the first source is selected automatically for this slice. The controller retains the list so a manual source chooser can be added later without changing the provider protocol.

### Zapping

The screen owns the currently visible filtered/sorted channel list.

On Android TV, channel up/down actions select the previous/next item in that current list and immediately resolve it. Zapping wraps only if explicitly implemented and tested; the default design stops at list boundaries to avoid surprising jumps.

On phone, selecting another channel from the list performs the same controller transition.

## User interface

### Phone

Replace the Live TV placeholder with `LiveTvScreen` containing:

- page title,
- search field,
- country filter chips/selector,
- refresh action,
- channel list with logo/title/country when available,
- embedded player area after channel selection,
- clear resolving/error/empty states.

The user can continue browsing the channel list while a channel is playing.

### Android TV

Use the same data/controller layer with a TV-oriented layout:

- channel list on the left,
- player/content panel on the right,
- focused row border/highlight,
- all interactive controls `focusable`,
- predictable render-order navigation,
- remote OK selects a channel,
- remote up/down while the channel list is active changes focus normally,
- dedicated previous/next channel actions in the player area support quick zapping.

The TV rail remains responsible only for app-section navigation.

### No-provider state

If there are no eligible Live TV providers, show a localized explanation and a direct action/path to the existing Add-ons screen/settings rather than an empty list.

The app itself still ships with no channels.

## Add-on management UI impact

Installed provider rows should be able to display a Live TV capability badge alongside movie/series capabilities.

The existing install/configure/enable/priority/remove flows remain authoritative. This slice does not add a separate Live TV credentials page.

If a pure Live TV manifest is installed, it appears in the same add-on management list and participates only in Live TV runtime creation.

## Error handling

User-facing states are generic and localized:

- no Live TV providers installed,
- loading channels,
- no channels returned,
- some providers failed while others loaded,
- all providers failed,
- channel stream unavailable,
- channel playback failed,
- retry / refresh.

Raw provider URLs, secret configuration, HTTP response bodies, and exception details are never rendered to the user.

Partial provider failure is non-fatal when at least one provider returns channels.

## Security and privacy

- Live TV provider URLs must use HTTPS.
- Embedded URL credentials are rejected.
- Existing response-size and timeout limits are reused for manifest/catalog/stream requests.
- Existing secure secret storage remains authoritative for provider secrets.
- Stream URLs and headers are transient playback data only.
- The app ships no copyrighted channel URLs, account credentials, M3U files, or Xtream credentials.
- Provider metadata is user-installed or user-authorized.

## Localization

Add first-party EN/SQ/FR/DE strings for the new Live TV UI. Other supported locales use the established English fallback.

Required meanings include:

- Live TV,
- Search channels,
- All countries,
- Refresh,
- Loading channels,
- No Live TV provider,
- No channels,
- Some providers could not load,
- Channel unavailable,
- Retry,
- Previous channel,
- Next channel.

## Testing strategy

Use TDD for every behavior change.

1. `@moviestv/live-tv` parser tests prove valid `channel`/`tv` catalogs and stream resources are recognized, unsafe URLs/invalid records are rejected, and channel metadata is normalized without stream persistence.
2. Add-on manifest tests prove movie-only, Live-TV-only, and mixed providers install correctly while manifests with no supported capability are rejected.
3. Provider-runtime tests prove only enabled/configured/hydrated Live TV add-ons become adapters and installed priority is preserved.
4. Adapter tests prove catalog and stream request paths are encoded safely, bounded HTTP loading is reused, malformed channels are dropped, and stream candidates use the existing normalizer.
5. Channel-service tests prove provider failures are isolated, metadata caching works, refresh bypasses cache, and no stream URL is cached.
6. View-model tests prove search, preferred country order (`AL`, `XK`, `FR`), country filtering, and A-Z channel sorting.
7. Playback-controller tests prove stale stream resolutions cannot replace a newer channel, invalid/empty source responses produce generic error state, and next/previous selection uses the visible list.
8. Phone UI tests prove the placeholder is replaced, search/filter/refresh work, and selecting a channel enters playback.
9. Android TV UI tests prove focusability, visible focused state, remote-friendly selection, and previous/next zapping controls.
10. Regression tests prove movie and episode playback behavior remains unchanged.
11. Full workspace lint, typecheck, tests, and Android phone/TV build verification remain release gates once a runner/build service is available.

## Non-goals for this slice

- EPG/XMLTV guide,
- favorites,
- favorites sync,
- cross-device last-channel sync,
- watch history/progress for Live TV,
- recording/DVR,
- catch-up/replay,
- direct M3U ingestion,
- Xtream Codes login,
- hard-coded channel packages,
- cross-provider same-channel merging,
- automatic provider fallback for the same channel,
- background audio/PiP behavior,
- Apple TV-specific remote behavior.

These can be layered on after the provider/channel/playback identity is stable.

## Success criteria

- Installing a compatible pure or mixed Live TV add-on is possible through the existing provider management flow.
- The Live TV tab no longer shows a placeholder when an eligible provider exists.
- Real channel metadata is loaded only from installed enabled providers.
- Search, country filters, preferred country ordering, and A-Z channel ordering work locally.
- Selecting a channel resolves and plays a provider stream through `expo-video`.
- Android TV controls are focusable and quick previous/next channel changes work.
- One failing provider does not prevent channels from healthy providers from loading.
- No channel stream URL or secret is persisted by the Live TV metadata cache.
- No M3U/Xtream configuration is required for the first provider-based Live TV experience.
- Existing movie and series playback architecture remains unchanged.