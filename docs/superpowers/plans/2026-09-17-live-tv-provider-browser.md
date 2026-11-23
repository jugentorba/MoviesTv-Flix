# Live TV Provider Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modern app's Live TV placeholder with provider/add-on based channel discovery, search/filtering, secure channel resolution, phone playback, and Android TV remote-friendly zapping.

**Architecture:** Extend the existing add-on descriptor so one installed provider can expose movie/series streaming, Live TV, or both. Put Stremio-style Live TV protocol parsing in `@moviestv/live-tv`, derive eligible Live TV runtimes from the existing installed add-on state, aggregate only metadata into a short-lived cache, and keep resolved stream URLs transient inside a dedicated Live TV playback controller. `LiveTvScreen` uses the same data/controller layer on phone and Android TV while navigation only supplies the platform layout and a path to provider settings.

**Tech Stack:** TypeScript 5.9, React 19, React Native TVOS 0.85, Expo SDK 56, `expo-video`, Jest 29, `ts-jest`, pnpm 11.25.

**Spec:** `docs/superpowers/specs/2026-09-17-live-tv-provider-browser-design.md`

## Global Constraints

- Do not bundle channel lists, channel stream URLs, M3U files, Xtream credentials, or provider credentials.
- Live TV content comes only from installed user-authorized compatible providers.
- Reuse the existing add-on registry, enable/disable state, priority, synchronized safe metadata, secure secret storage, bounded HTTP loader, and `normalizeStreamCandidates()` implementation.
- Live TV provider URLs must use HTTPS; embedded URL credentials are rejected. Existing explicit loopback development behavior remains governed by the shared add-on URL policy.
- Channel metadata caches may contain IDs, title, provider ID, country/category metadata, and poster/logo URLs only. Never cache resolved stream URLs, headers, cookies, or secrets.
- Preferred country presentation order is Albania (`AL`), Kosovo (`XK`), France (`FR`), then remaining countries alphabetically.
- Channel ordering within the visible filter is A-Z, locale-aware and case-insensitive.
- A provider failure must not block healthy providers from returning channels.
- Playback begins only after an explicit channel selection.
- Android TV controls must be focusable with visible focus states; previous/next zapping stops at list boundaries in this slice.
- Priority localization for new copy is English, Albanian, French, and German; all other supported app locales use the established English fallback.
- Existing movie and episode playback behavior must remain unchanged.
- EPG, favorites, favorites sync, recording, catch-up, direct M3U/Xtream input, cross-provider channel merging, and Apple TV-specific remote behavior are out of scope.

---

### Task 1: Modern Live TV protocol and channel metadata contracts

**Files:**
- Modify: `packages/live-tv/package.json`
- Create: `packages/live-tv/jest.config.js`
- Modify: `packages/live-tv/src/index.ts`
- Create: `packages/live-tv/src/stremio.ts`
- Create: `packages/live-tv/src/__tests__/stremio.test.ts`

**Interfaces:**
- Produces: `LiveTvResourceType = 'channel' | 'tv'`.
- Produces: `LiveTvCatalog`, `LiveTvProtocol`, `LiveTvProviderDescriptor`, `LiveTvChannel`.
- Produces: `parseLiveTvCapability(payload: unknown): LiveTvProtocol | null`.
- Produces: `parseLiveTvCatalog(payload, providerId, type): LiveTvChannel[]`.
- Produces: `liveTvCatalogRequestPath(catalog)` and `liveTvStreamRequestPath(type, remoteId)`.

- [ ] **Step 1: Add Jest support and write failing protocol tests**

Update `packages/live-tv/package.json` scripts to:

```json
{
  "scripts": {
    "test": "jest --config jest.config.js",
    "typecheck": "tsc --noEmit"
  }
}
```

Create `packages/live-tv/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@moviestv/(.*)$': '<rootDir>/../$1/src',
  },
};
```

Create tests proving:

```ts
const manifest = {
  id: 'org.example.tv',
  name: 'Example TV',
  version: '1.0.0',
  types: ['channel'],
  catalogs: [{ type: 'channel', id: 'all', name: 'All Channels' }],
  resources: [
    { name: 'catalog', types: ['channel'] },
    { name: 'stream', types: ['channel'] },
  ],
};

expect(parseLiveTvCapability(manifest)).toEqual({
  catalogs: [{ type: 'channel', id: 'all', name: 'All Channels' }],
  streamTypes: ['channel'],
});
expect(parseLiveTvCapability({ ...manifest, resources: ['catalog'] })).toBeNull();
expect(liveTvCatalogRequestPath({ type: 'channel', id: 'sports world' }))
  .toBe('/catalog/channel/sports%20world.json');
expect(liveTvStreamRequestPath('channel', 'rtk 1')).toBe('/stream/channel/rtk%201.json');
```

Also prove `parseLiveTvCatalog()` drops malformed entries, dedupes duplicate remote IDs, uppercases valid two-character country codes, accepts only HTTPS poster URLs without credentials, and does not copy stream URLs from catalog metadata.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter @moviestv/live-tv test -- --runInBand
```

Expected: FAIL because the new protocol functions/types do not exist.

- [ ] **Step 3: Implement the protocol/model boundary**

Create contracts shaped as:

```ts
export type LiveTvResourceType = 'channel' | 'tv';

export interface LiveTvCatalog {
  type: LiveTvResourceType;
  id: string;
  name: string;
}

export interface LiveTvProtocol {
  catalogs: LiveTvCatalog[];
  streamTypes: LiveTvResourceType[];
}

export interface LiveTvProviderDescriptor {
  addonId: string;
  name: string;
  manifestUrl: string;
  priority: number;
  liveTv: LiveTvProtocol;
}

export interface LiveTvChannel {
  id: string;
  providerId: string;
  remoteId: string;
  resourceType: LiveTvResourceType;
  title: string;
  posterUrl?: string;
  countryCode?: string;
  genres?: string[];
}
```

`parseLiveTvCapability()` must intersect catalog types with stream types so only playable catalogs remain. `parseLiveTvCatalog()` must build stable IDs as `${providerId}:${type}:${remoteId}` and must never include a `streamUrl` field.

- [ ] **Step 4: Export the new contracts/functions**

Replace the old minimal `packages/live-tv/src/index.ts` implementation with exports from `./stremio` so the package has one authoritative Live TV protocol model.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @moviestv/live-tv test -- --runInBand
pnpm --filter @moviestv/live-tv typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/live-tv
git commit -m "feat: define modern Live TV protocol contracts"
```

---

### Task 2: Extend installed add-on manifests with Live TV capability

**Files:**
- Modify: `packages/addons/src/types.ts`
- Modify: `packages/addons/src/stremio-manifest.ts`
- Modify: `packages/addons/src/__tests__/stremio-manifest.test.ts`

**Interfaces:**
- Consumes: `LiveTvProtocol` and `parseLiveTvCapability()` from Task 1.
- Produces: `AddonCapability = 'stream' | 'catalog' | 'subtitle' | 'live-tv'`.
- Produces: `AddonDescriptor.liveTv?: LiveTvProtocol`.
- Preserves: `AddonDescriptor.stream?: AddonStreamProtocol` for movie/series playback.

- [ ] **Step 1: Write failing pure-TV and mixed-provider tests**

Add tests equivalent to:

```ts
const liveOnly = parseStremioManifest({
  id: 'org.example.tv',
  name: 'Example TV',
  version: '1.0.0',
  types: ['channel'],
  catalogs: [{ type: 'channel', id: 'all', name: 'All' }],
  resources: [
    { name: 'catalog', types: ['channel'] },
    { name: 'stream', types: ['channel'] },
  ],
}, 'https://example.com/manifest.json');
expect(liveOnly.capabilities).toContain('live-tv');
expect(liveOnly.capabilities).not.toContain('stream');
expect(liveOnly.supportedMediaKinds).toEqual([]);
expect(liveOnly.liveTv?.catalogs[0]?.type).toBe('channel');
```

For a mixed manifest with movie/series stream resources plus `channel` catalog/stream resources, assert both `stream` and `live-tv` capabilities are present. Keep the existing movie-only test unchanged. Add a rejection test for a manifest exposing neither supported movie/series streaming nor usable Live TV.

- [ ] **Step 2: Run manifest tests and confirm RED**

```bash
pnpm --filter @moviestv/addons test -- --runInBand src/__tests__/stremio-manifest.test.ts
```

Expected: FAIL because pure Live TV manifests are currently rejected as non-stream manifests.

- [ ] **Step 3: Extend add-on types**

Import `LiveTvProtocol` from `@moviestv/live-tv`, add `'live-tv'` to `AddonCapability`, and add:

```ts
liveTv?: LiveTvProtocol;
```

to `AddonDescriptor`.

- [ ] **Step 4: Refactor manifest parsing without changing movie request behavior**

`parseStremioManifest()` must compute movie/series `stream` and Live TV `liveTv` independently:

```ts
const stream = resolveStreamProtocol(record);
const liveTv = parseLiveTvCapability(record);
if (!stream && !liveTv) {
  throw new Error('Stremio manifest does not provide a supported MoviesTv-Flix capability');
}
const capabilities: AddonCapability[] = [
  ...(stream ? ['stream' as const] : []),
  ...(liveTv ? ['live-tv' as const] : []),
];
```

`supportedMediaKinds` becomes `stream?.types ?? []`. Existing configuration parsing and secret detection remain unchanged.

- [ ] **Step 5: Run add-on tests and typecheck**

```bash
pnpm --filter @moviestv/addons test -- --runInBand
pnpm --filter @moviestv/addons typecheck
```

Expected: PASS, including current movie/episode request tests.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/addons/src/types.ts packages/addons/src/stremio-manifest.ts packages/addons/src/__tests__/stremio-manifest.test.ts
git commit -m "feat: discover Live TV addon capability"
```

---

### Task 3: Derive eligible Live TV providers and implement the Stremio adapter

**Files:**
- Create: `apps/mobile-tv/src/live-tv/live-tv-providers.ts`
- Create: `apps/mobile-tv/src/live-tv/StremioLiveTvAdapter.ts`
- Create: `apps/mobile-tv/src/live-tv/__tests__/live-tv-providers.test.ts`
- Create: `apps/mobile-tv/src/live-tv/__tests__/stremio-live-tv-adapter.test.ts`

**Interfaces:**
- Consumes: `AddonStateRecord[]`, `LiveTvProviderDescriptor`, `LiveTvChannel`, `normalizeStreamCandidates()`, `fetchBoundedJson()`.
- Produces: `createLiveTvProviders(records: readonly AddonStateRecord[]): LiveTvProviderDescriptor[]`.
- Produces: `StremioLiveTvAdapter.listChannels(provider): Promise<LiveTvChannel[]>`.
- Produces: `StremioLiveTvAdapter.resolveChannel(provider, channel): Promise<StreamSource[]>`.

- [ ] **Step 1: Write failing provider-derivation tests**

Build records covering enabled/disabled, `setupIncomplete`, missing hydrated descriptor, non-Live-TV capability, and priority ordering. Assert only enabled + complete + hydrated + manifest-backed Live TV descriptors are returned, ordered descending by installed priority.

- [ ] **Step 2: Write failing adapter request tests**

Using a fake fetcher, assert catalog requests are made to:

```text
https://provider.example/catalog/channel/all.json
```

and channel resolution to:

```text
https://provider.example/stream/channel/rtk%201.json
```

Assert the adapter rejects a channel whose `providerId` differs from the provider descriptor, reuses `fetchBoundedJson()`, and returns normalized `StreamSource[]`.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-providers.test.ts src/live-tv/__tests__/stremio-live-tv-adapter.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement provider derivation**

`createLiveTvProviders()` maps an eligible `AddonStateRecord` to:

```ts
{
  addonId: record.installed.addonId,
  name: record.descriptor.name,
  manifestUrl: record.installed.manifestUrl,
  priority: record.installed.priority,
  liveTv: record.descriptor.liveTv,
}
```

No separate provider installation storage is created.

- [ ] **Step 5: Implement `StremioLiveTvAdapter`**

Use the same safe base URL derivation as `StremioAddonAdapter`: strip query/hash from `manifest.json`, append encoded request paths from `@moviestv/live-tv`, and call the shared bounded JSON loader. `listChannels()` fetches every declared catalog concurrently, flattens results, dedupes by local channel ID inside that provider, and sorts by title. `resolveChannel()` validates provider/type membership before fetching streams.

- [ ] **Step 6: Run tests and mobile typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-providers.test.ts src/live-tv/__tests__/stremio-live-tv-adapter.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/mobile-tv/src/live-tv
git commit -m "feat: add installed Live TV provider runtime"
```

---

### Task 4: Aggregate channel metadata, cache safely, and derive the visible channel list

**Files:**
- Create: `apps/mobile-tv/src/live-tv/LiveTvChannelService.ts`
- Create: `apps/mobile-tv/src/live-tv/live-tv-view-model.ts`
- Create: `apps/mobile-tv/src/live-tv/__tests__/live-tv-channel-service.test.ts`
- Create: `apps/mobile-tv/src/live-tv/__tests__/live-tv-view-model.test.ts`

**Interfaces:**
- Consumes: `LiveTvProviderDescriptor[]` and an adapter with `listChannels()`.
- Produces: `LiveTvChannelLoadResult` with `channels`, `failedProviderIds`, `providerCount`.
- Produces: `LiveTvChannelService.load(providers, { refresh?: boolean })`.
- Produces: `buildLiveTvView(channels, query, countryCode)` and `availableLiveTvCountries(channels)`.

- [ ] **Step 1: Write failing service tests for partial failure and cache isolation**

Use two providers where one succeeds and one rejects. Assert the result still returns healthy channels plus the failed provider ID. Call `load()` twice and assert the adapter is called once per provider because fresh metadata cache is reused. Call `load(..., { refresh: true })` and assert the adapter is called again.

Also assert cached channel objects contain no `url`, `headers`, `streamUrl`, `cookie`, or secret configuration property.

- [ ] **Step 2: Write failing search/country/order tests**

Use channels from AL/XK/FR/DE and mixed titles. Assert:

```ts
expect(availableLiveTvCountries(channels)).toEqual(['AL', 'XK', 'FR', 'DE']);
expect(buildLiveTvView(channels, '  rtk ', null).map((item) => item.title))
  .toEqual(['RTK 1', 'RTK 2']);
expect(buildLiveTvView(channels, '', 'FR').map((item) => item.title))
  .toEqual(['Arte', 'France 2']);
```

A-Z sorting uses `localeCompare(..., { sensitivity: 'base' })`.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-channel-service.test.ts src/live-tv/__tests__/live-tv-view-model.test.ts
```

Expected: FAIL because service/view-model modules do not exist.

- [ ] **Step 4: Implement 15-minute metadata cache**

Use an in-memory `Map<string, { expiresAt: number; channels: LiveTvChannel[] }>` keyed by provider/add-on ID. Cache TTL is `15 * 60 * 1000`. On normal load use unexpired entries; on `refresh: true` bypass them. Use `Promise.allSettled()` so failures are isolated.

- [ ] **Step 5: Implement local filtering/order functions**

Normalize search with trim + collapsed whitespace + lowercase. `countryCode === null` means all countries. Country options are generated only from returned channel metadata and ordered `AL`, `XK`, `FR`, then alphabetical remainder.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-channel-service.test.ts src/live-tv/__tests__/live-tv-view-model.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/mobile-tv/src/live-tv/LiveTvChannelService.ts apps/mobile-tv/src/live-tv/live-tv-view-model.ts apps/mobile-tv/src/live-tv/__tests__/live-tv-channel-service.test.ts apps/mobile-tv/src/live-tv/__tests__/live-tv-view-model.test.ts
git commit -m "feat: aggregate and filter Live TV channels"
```

---

### Task 5: Live TV playback controller with stale-resolution protection and zapping

**Files:**
- Create: `apps/mobile-tv/src/live-tv/LiveTvPlaybackController.ts`
- Create: `apps/mobile-tv/src/live-tv/__tests__/live-tv-playback-controller.test.ts`

**Interfaces:**
- Consumes: provider descriptors, `LiveTvChannel`, and adapter `resolveChannel()`.
- Produces: `LiveTvPlaybackState` with `status`, `channel`, `sources`, `selectedSourceId`.
- Produces: `selectChannel(provider, channel)`, `retry()`, `close()`, `selectSource(sourceId)`, `previous(visibleChannels, providers)`, `next(visibleChannels, providers)`.

- [ ] **Step 1: Write failing resolution and stale-result tests**

Use deferred promises for channel A and B. Start A, then B, resolve B first and A last. Assert final state remains channel B and A cannot overwrite it.

Assert an empty source response yields `status: 'error'` with no raw provider message. Assert a valid response picks the first source ID.

- [ ] **Step 2: Write failing boundary-zapping tests**

With visible channels `[A, B, C]`, current `B` must allow previous -> `A` and next -> `C`. Current `A` previous does nothing; current `C` next does nothing. Do not wrap.

- [ ] **Step 3: Run the focused controller test and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-playback-controller.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 4: Implement controller state transitions**

Use a monotonically increasing request token inside `selectChannel()` and only apply a resolution when its token still matches the active request. Keep resolved `StreamSource[]` in memory only. `retry()` repeats only the current channel/provider request.

- [ ] **Step 5: Implement source selection and boundary zapping**

`selectSource()` accepts only IDs present in current `sources`. `previous()` / `next()` find the current channel ID in the passed visible list and call `selectChannel()` only when a neighbor exists. Provider lookup is by `channel.providerId`.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-playback-controller.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/mobile-tv/src/live-tv/LiveTvPlaybackController.ts apps/mobile-tv/src/live-tv/__tests__/live-tv-playback-controller.test.ts
git commit -m "feat: add Live TV playback controller"
```

---

### Task 6: Live TV screen, expo-video player, phone navigation, and Android TV navigation

**Files:**
- Create: `apps/mobile-tv/src/live-tv/LiveTvScreen.tsx`
- Create: `apps/mobile-tv/src/live-tv/LiveTvPlayer.tsx`
- Create: `apps/mobile-tv/src/live-tv/__tests__/live-tv-screen.test.tsx`
- Modify: `apps/mobile-tv/src/navigation/PhoneTabs.tsx`
- Modify: `apps/mobile-tv/src/navigation/TVRail.tsx`
- Modify: `apps/mobile-tv/src/__tests__/app-navigation.test.tsx` if this existing regression suite asserts placeholder routes; otherwise update the existing navigation-focused test that covers Live TV.

**Interfaces:**
- Consumes: `useAddons().installed`, `createLiveTvProviders()`, `LiveTvChannelService`, view-model helpers, `LiveTvPlaybackController`.
- Produces: `<LiveTvScreen mode="phone" | "tv" onOpenProviders={() => void} />`.
- Produces: `<LiveTvPlayer source={StreamSource} ... />` backed by `expo-video`.

- [ ] **Step 1: Write failing no-provider/loading/list/playback UI tests**

Mock `useAddons()` with no eligible providers and assert localized no-provider copy plus an `open-live-tv-providers` button calls `onOpenProviders`.

With one provider and deferred `load()`, assert loading state appears, then real channel rows render with stable IDs such as `live-tv-channel-provider-a-channel-rtk1`.

Press a channel and assert the playback controller receives the matching provider + channel. Assert the screen never auto-selects a channel merely because loading completed.

- [ ] **Step 2: Write failing phone/TV interaction tests**

Phone mode: search text and country filter update the visible list locally; refresh calls `load(..., { refresh: true })`.

TV mode: channel rows, country filters, refresh, previous-channel, and next-channel controls have `focusable={true}` and focused style. The player previous/next buttons call controller zapping with the currently visible filtered/sorted channel list.

- [ ] **Step 3: Run focused UI tests and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-screen.test.tsx
```

Expected: FAIL because the screen/player do not exist.

- [ ] **Step 4: Implement `LiveTvPlayer`**

Reuse the same `expo-video` pattern as `PlaybackOverlay`:

```ts
const player = useVideoPlayer({ uri: source.url, headers: source.headers }, (instance) => {
  instance.play();
});
```

Render `VideoView` with `nativeControls`, `contentFit="contain"`, and fullscreen enabled. Keep stream source runtime-only.

- [ ] **Step 5: Implement `LiveTvScreen`**

State owned by the screen: search query, selected country, channel-load status/result. Playback state comes from one controller instance. Render:

- title,
- local search field,
- generated country chips including an all-countries option,
- refresh action,
- generic partial/all-provider failure states,
- channel list with poster/title/country when available,
- player/resolving/channel-unavailable state after explicit selection,
- previous/next controls in TV player area.

Phone layout keeps player and list in the same scrollable page. TV layout uses list left / player right and visible focus styles.

- [ ] **Step 6: Replace both Live TV placeholders**

In `PhoneTabs.tsx`, render `LiveTvScreen mode="phone"` for the Live TV tab. Its `onOpenProviders` callback navigates/selects the Settings tab so the existing Providers entry is reachable.

In `TVRail.tsx`, replace the Live TV placeholder with `LiveTvScreen mode="tv"`; `onOpenProviders` switches the selected rail route to Settings and clears media details.

- [ ] **Step 7: Run UI/navigation tests and typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv/__tests__/live-tv-screen.test.tsx
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/mobile-tv/src/live-tv apps/mobile-tv/src/navigation apps/mobile-tv/src/__tests__
git commit -m "feat: replace Live TV placeholder with channel browser"
```

---

### Task 7: Provider capability badges and EN/SQ/FR/DE Live TV localization

**Files:**
- Modify: `apps/mobile-tv/src/addons/ProvidersScreen.tsx`
- Modify: `apps/mobile-tv/src/i18n/types.ts`
- Modify: `apps/mobile-tv/src/i18n/resources/index.ts`
- Create: `apps/mobile-tv/src/i18n/resources/live-tv.ts`
- Modify: `apps/mobile-tv/src/i18n/__tests__/resources.test.ts`
- Modify: `apps/mobile-tv/src/addons/__tests__/providers-screen.test.tsx` if present; otherwise add the badge assertion to the nearest existing provider UI test.
- Modify: `apps/mobile-tv/src/live-tv/__tests__/live-tv-screen.test.tsx`

**Interfaces:**
- Produces translation keys under `liveTv.*`.
- Displays a Live TV badge when `record.descriptor?.capabilities.includes('live-tv')`.

- [ ] **Step 1: Write failing translation-resource tests**

Assert EN/SQ/FR/DE values for:

```text
Live TV
Search channels
All countries
Refresh
Loading channels…
No Live TV provider is installed
No channels available
Some providers could not load
Channel unavailable
Retry
Previous channel
Next channel
```

Assert an existing non-priority locale (for example `it`) receives the English Live TV values through the established fallback pack.

- [ ] **Step 2: Write failing provider badge test**

Render one installed record with `capabilities: ['live-tv']` and assert a localized Live TV capability badge appears. A movie-only provider must not show that badge.

- [ ] **Step 3: Run focused localization/provider tests and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/i18n/__tests__/resources.test.ts src/live-tv/__tests__/live-tv-screen.test.tsx
```

Run the existing provider UI test path discovered in the repository as part of the same focused test command.

Expected: FAIL on missing Live TV resource keys/badge copy.

- [ ] **Step 4: Add the Live TV resource pack**

Follow the episode-pack pattern: create ordered `LIVE_TV_RESOURCE_KEYS`, define complete `en`, `sq`, `fr`, `de` arrays, and use `LIVE_TV_PACKS[locale] ?? LIVE_TV_PACKS.en` in the resource builder. Extend `AppTranslationResource` with typed `liveTv` keys.

- [ ] **Step 5: Add capability badge rendering**

Provider rows use existing descriptor metadata only. Do not create another provider type or settings page.

- [ ] **Step 6: Run localization/provider/UI tests and typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/i18n/__tests__/resources.test.ts src/live-tv/__tests__/live-tv-screen.test.tsx
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add apps/mobile-tv/src/addons/ProvidersScreen.tsx apps/mobile-tv/src/i18n apps/mobile-tv/src/live-tv/__tests__/live-tv-screen.test.tsx
git commit -m "feat: localize Live TV provider experience"
```

---

### Task 8: Full regression verification and review preparation

**Files:**
- Modify only files proven necessary by failing tests or review findings.
- Do not touch `.github/workflows/android-preview.yml`; standalone Android packaging remains isolated in draft PR #27.
- Do not merge stale `feature/live-tv-*`, `feature/pwa-web-support`, or `feature/ios-native-preview` branches.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a reviewable stacked Live TV feature branch whose diff against `codex/series-episode-playback-20260917` contains only the Live TV spec/plan and Live TV implementation changes.

- [ ] **Step 1: Run the complete Live TV and add-on focused suite**

```bash
pnpm --filter @moviestv/live-tv test -- --runInBand
pnpm --filter @moviestv/addons test -- --runInBand
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/live-tv
```

Expected: PASS with zero failing tests.

- [ ] **Step 2: Run the entire workspace tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run workspace typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: PASS with no errors and no warnings.

- [ ] **Step 4: Re-run movie/episode playback regressions**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/playback/__tests__/playback-provider.test.tsx src/catalog/__tests__/series-episode-browser.test.tsx src/catalog/__tests__/media-details-playback.test.tsx
```

Expected: PASS; Live TV changes must not alter movie/episode resolution.

- [ ] **Step 5: Compare the stacked branch against its series base**

```bash
git diff --stat codex/series-episode-playback-20260917...HEAD
git diff --name-only codex/series-episode-playback-20260917...HEAD
```

Confirm the diff contains only `packages/live-tv`, required `packages/addons` capability changes, `apps/mobile-tv/src/live-tv`, provider badge/localization/navigation files, and the Live TV spec/plan. No generated native folders, Android workflow fixes, signing files, secrets, or unrelated sync refactors may appear.

- [ ] **Step 6: Request code review**

Review the complete stacked diff from `codex/series-episode-playback-20260917` to the Live TV branch. Fix every Critical/Important finding with focused tests before marking the PR ready.

- [ ] **Step 7: Verify hosted CI status without wasting quota**

If GitHub Actions still creates zero-step/no-log failures, record that as the known account/runner gate and do not treat it as code failure. Do not repeatedly rerun hosted jobs while the quota gate persists.

- [ ] **Step 8: Open a draft stacked PR**

Base the Live TV PR on `codex/series-episode-playback-20260917`, not `main`, until PR #28 is merged. The PR summary must state that it is stacked, excludes EPG/favorites/M3U/Xtream, and relies on installed user-authorized providers.
