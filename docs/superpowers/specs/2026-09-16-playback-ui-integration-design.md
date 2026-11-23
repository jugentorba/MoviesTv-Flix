# Playback UI Integration Design

## Goal

Connect the current MoviesTv-Flix add-on and playback domain layers to a real movie playback flow on phone and Android TV without replacing the newer localization, provider-security, preference-sync, or playback-session work already on `main`.

## Scope

This slice delivers end-to-end movie playback only. A movie details screen can resolve streams from enabled, fully configured installed Stremio add-ons, rank them using the existing playback package and the user's preferred audio languages, start the selected stream in an in-app player, and let the user change source.

Series playback is intentionally the next slice. The current catalog `MediaDetails` exposes aggregate season/episode counts but no per-season episode metadata or stable episode identifiers, so inventing episode rows here would couple the player to guessed data. The movie path establishes the reusable playback runtime first.

## Existing components that remain authoritative

- `packages/addons`: request contracts, installed add-on state, registry ordering, concurrent source resolution, URL normalization, deduplication, and Stremio request mapping.
- `apps/mobile-tv/src/addons`: installed add-on state, secure configuration, manifest hydration, and `StremioAddonAdapter`.
- `packages/playback`: source ranking and `PlaybackSessionController`.
- `apps/mobile-tv/src/preferences`: preferred audio languages and autoplay setting.
- `apps/mobile-tv/src/i18n`: all existing localization behavior and English fallback.

The UI layer must consume these systems instead of duplicating provider resolution or ranking.

## Architecture

### App-level playback resolver

Create `apps/mobile-tv/src/playback/createPlaybackResolver.ts`.

It accepts the current `AddonStateRecord[]` from `useAddons()` and builds `RegisteredAddon[]` only for records that:

- have a hydrated descriptor,
- use `sourceType: 'stremio-manifest'`, and
- have a descriptor manifest URL.

Each eligible record is paired with a `StremioAddonAdapter`. The entries are passed to `AddonRegistry`, then `AddonSourceResolver`. Enabled/setup-complete filtering and priority ordering remain inside `AddonRegistry`, while provider timeout and dedupe behavior remain inside `AddonSourceResolver`.

Records with missing descriptors, unsupported source types, or incomplete synchronized metadata are skipped safely; they stay visible/configurable in the add-on UI but are not used for playback until valid.

### Playback provider

Create `apps/mobile-tv/src/playback/PlaybackProvider.tsx` and `usePlayback.ts`.

`PlaybackProvider` reads:

- installed add-ons from `useAddons()`, and
- `preferredAudioLanguages` / `autoplay` from `usePreferences()`.

It owns a `PlaybackSessionController` constructed from the app-level resolver. It exposes current session state plus:

- `playMovie(details)` — builds an `AddonMediaRequest` from the catalog details and resolves it;
- `retry()` — re-resolves the current controller request without rebuilding catalog metadata;
- `selectSource(sourceId)` — delegates to the controller;
- `openSourceChooser()` / `closeSourceChooser()`;
- `closePlayback()` — resets the session and dismisses UI;
- the currently selected `StreamSource` derived from the controller state.

The provider subscribes to controller state and ignores stale controller results through the existing generation logic in `PlaybackSessionController`.

### Player and source chooser

Create `PlaybackOverlay.tsx` and `SourceChooser.tsx`.

When the session is:

- `resolving`: show a blocking loading surface with cancel.
- `no-sources`: show a clear no-source state with retry/close.
- `error`: show a generic playback failure surface without exposing provider internals.
- `ready`: start the selected source in `expo-video` and show player controls.

The player uses the selected source URL and HTTP headers. Native video controls remain enabled. App-level buttons provide Back/Close and Change source so both touch and TV remotes have explicit focusable controls.

Changing source replaces the video source without starting another provider resolution. The source chooser displays ranked results in controller order with provider/name, quality, and detected audio languages when present.

### Details-screen behavior

The current disabled playback pill becomes an enabled Play button for movies that have a TMDB or IMDb external ID. Pressing it calls `playMovie(details)`.

For series in this slice, the existing unavailable state remains; no fake episode numbers are created.

### Localization

Playback controls use `t()` keys. English playback copy is added as fallback for all locales, so no existing locale becomes incomplete. Albanian, French, and German playback copy should be included in this slice because they are the project's priority languages; other locales fall back to English until their playback strings are translated.

### Dependency

Add `expo-video` using the Expo SDK 56 compatible version. Update `pnpm-lock.yaml` through pnpm rather than hand-editing the lockfile.

## Error handling and security

- No secure add-on value is copied into React state or logs.
- Provider resolution continues to use bounded HTTP requests and URL safety checks already implemented by the add-on layer.
- Individual provider failures/timeouts resolve to no results for that provider, preserving results from healthy providers.
- Raw provider exception text is not displayed in the playback overlay.
- Only normalized HTTP/HTTPS `StreamSource` values emitted by the existing add-on layer reach the player.

## Testing

Use TDD for every behavior change.

1. Resolver adapter tests prove eligible installed add-ons become resolver entries, priority is preserved, and invalid/unhydrated records are ignored.
2. Playback provider tests prove movie request construction, preferred-language ranking, no-source state, retry, source switching, and reset behavior.
3. Details-screen tests prove movie Play is enabled and series playback remains unavailable in this slice.
4. Overlay tests prove resolving/no-source/error/ready states and source chooser selection.
5. Full workspace verification runs lint, TypeScript, and all tests.
6. GitHub Android preview workflow must build both phone and Android TV APKs after the feature is complete.

## Success criteria

- A movie with valid external IDs can go from Details -> provider resolution -> ranked selected source -> in-app video playback.
- Change source works without re-querying providers.
- Installed add-on enable/setup state and priority determine which providers participate.
- Existing localization, add-on configuration/security, catalog, auth, sync, and navigation tests remain green.
- Phone and Android TV preview APK jobs both succeed.
