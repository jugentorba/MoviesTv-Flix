# Release verification — 27 September 2026

Base: `1e710ec27c83d0c9b21a27bb7c23b9d9953410a9` plus this verification/fix batch.

## Status

**Updated 1 October 2026:** not release-ready because physical-device PWA/native QA is still pending. The Android phone preview APK and unsigned/re-signable iOS preview IPA have now been produced and passed their artifact verifiers. Android TV and tvOS preview builds have been requested but remain pending artifact verification. Cloudflare has also successfully run the full `pnpm build:pwa` gate on later source. The authoritative current artifact/deployment evidence is maintained in `docs/builds/preview-artifact-checklist.md`; the older measurements and red results below are retained as historical evidence from this 27 September verification record.

## Repairs in this batch

- Closed the missing asynchronous callback brace in LiveTvChannelService, which blocked TypeScript and Metro parsing.
- Made movie/series fallback identity inference explicit and narrowed nullable manifest resource records.
- Fixed merged catalog result normalization: per-provider pages remain bounded at 1,000; combined pages retain up to 2,000 instead of being truncated again to 1,000.
- Removed lint failures without changing HTTP media policy or channel favorite identity.
- Updated stale package test assumptions: canonical IMDb casing, valid HTTP header names, unchanged-source refresh returning false, canonical remote addon preferences, and cache eviction exercised with six valid 1,000-item pages.
- Flushed asynchronous timer callbacks in Live TV discovery tests; verified queued healthy providers are reached within the existing timeout budget.
- Repaired export-verifier fixture newlines/install markers and service-worker response MIME fixtures.

## Evidence

| Check | Result |
|---|---|
| Web TypeScript (`tsc --noEmit -p apps/mobile-tv/tsconfig.playback.json`) | PASS |
| Repository ESLint (`eslint . --max-warnings=0`) | PASS |
| Shared packages, ts-jest/node | 33 suites / 492 tests PASS |
| Live TV channel-service tests, Expo preset | 20 tests PASS |
| Full app Jest suite, Expo preset | 91 suites pass, 34 fail; 1,140 tests pass, 64 fail |
| Expo web export with preview mode | PASS; two JavaScript bundles produced |
| Service-worker stamping and real exported-artifact verification | PASS; 5 required files, 2 icons, 21 files scanned |
| Static-export verifier regression script | PASS |
| Service-worker build stamping/lifecycle/routing scripts | PASS |
| Cloudflare runtime smoke tests | PASS |
| Workspace dependency contract | PASS |
| Native preview verifier contract script | FAIL: over-escaped `/16\\.4/` pattern rejects the existing `16.4` script value; other assertions after it still need execution |

## Reproduction notes

The restored dependency cache initially used symlinked node_modules directories; pnpm refused that layout. Dependencies were copied into independent local directories. Expo Jest needed `NODE_PATH` pointing at the local `node_modules/.pnpm/node_modules` directory for cached hoisted Babel helpers. These local cache changes are not repository changes.

The shared-package run used ts-jest with `testEnvironment: node`, target ES2022, CommonJS, esModuleInterop, diagnostics disabled, and `^@moviestv/(.*)$` mapped to `<rootDir>/packages/$1/src`. It does not replace full native/test TypeScript checking. Web production sources passed their actual TypeScript gate separately.

The normal app Jest preset ran all 125 suites. The remaining failures below include incomplete mocks, stale expectations, timer scheduling, and possible production bugs; do not assume they are all harmless. Do not weaken assertions to get a green result. Reproduce and inspect each cause.

## Next work

1. Repair the full app suite, beginning with shared mocks (native player listeners, navigation context, browser event listeners) and Jest mock-factory scope errors.
2. Investigate provider-sync status, source refresh, catalog ID normalization, download handling, and favorite migration failures with their production paths.
3. Re-run the standard workspace test/typecheck/build commands in a fully provisioned dependency environment.
4. Verify the deployed Cloudflare revision, then physical-device playback/account sync and native artifacts. Local export success is not deployment evidence.

## Remaining app failures

### `apps/mobile-tv/src/live-tv/__tests__/live-tv-screen.test.tsx`

- Favorites keeps a station favorited through cross-provider merging
- stable favorite key matches the same station from a different provider
- countryless stable favorite migrates when another provider identifies the country

### `apps/mobile-tv/src/playback/__tests__/playback-overlay.test.tsx`

- redacts credential-bearing player errors after fallback refresh is exhausted
- refresh recovery does not revisit URLs that already failed
- uses sourceLoad track payload when player track properties lag
- uses late native track-change payloads when player properties lag

### `apps/mobile-tv/src/__tests__/addon-app-runtime.test.tsx`

- authenticated application content is inside the signed-in add-on runtime and mounts playback overlay

### `apps/mobile-tv/src/__tests__/navigation.test.tsx`

- phone navigation exposes Home and Live TV
- TV navigation uses a focusable left rail
- tablet and desktop widths use the wide side rail
- TV preferred focus follows the rail item the remote actually focused
- TV rail gives Home deterministic initial remote focus only on TVs

### `apps/mobile-tv/src/catalog/__tests__/catalog-localization.test.tsx`

- details hides credential-bearing catalog errors
- details localize the real episode browser while keeping provider metadata
- Home hero recognizes and removes an equivalent My List title from another provider
- German Home account status copy is localized

### `apps/mobile-tv/src/watch-progress/__tests__/watch-progress-provider.test.tsx`

- provider restores guest progress and clears it when identity changes
- retries remote watch progress synchronization after a browser reconnect event

### `apps/mobile-tv/src/catalog/__tests__/media-details-playback.test.tsx`

- downloads a movie directly from details without opening playback
- downloads a series episode directly without starting episode playback

### `apps/mobile-tv/src/addons/__tests__/provider-config-ui.test.tsx`

- TV back closes nested provider setup before leaving the provider list

### `apps/mobile-tv/src/live-tv/__tests__/live-tv-video-surface-native.test.tsx`

- selects the preferred embedded Live TV audio track after source load
- honors German when it is first in the Live TV audio preference order
- does not start native Live TV from sourceLoad while backgrounded
- uses Live TV sourceLoad audio payload when player tracks lag
- uses Live TV track-change payload when player properties lag

### `apps/mobile-tv/src/live-tv/__tests__/live-tv-playback-controller.test.ts`

- does not let a hung primary consume the whole multi-provider resolve budget
- subscriber failure does not block other Live TV listeners

### `apps/mobile-tv/src/playback/__tests__/attach-web-media-source.test.ts`

- still recognizes an opaque HLS URL from a transport query hint

### `apps/mobile-tv/src/addons/__tests__/installation.test.ts`

- StremioAddonAdapter honors a shorter resolver-provided provider budget
- standard configurable provider settings update the validated runtime manifest URL
- provider reorder stamps a newer mutation timestamp for synchronization

### `apps/mobile-tv/src/live-tv/__tests__/live-tv-guide-repository.test.ts`

- LiveTvGuideRepository requires cache revision to match active guide source

### `apps/mobile-tv/src/catalog/__tests__/stremio-catalog-gateway.test.ts`

- honors a shorter CatalogService timeout budget
- normalizes type-qualified TMDB catalog IDs to numeric external IDs

### `apps/mobile-tv/src/playback/__tests__/subtitle-resolver.test.ts`

- bounds alternate subtitle routes to one provider timeout budget
- does not starve a queued healthy subtitle provider behind slow providers

### `apps/mobile-tv/src/live-tv/__tests__/stremio-live-tv-adapter.test.ts`

- StremioLiveTvAdapter aborts catalog discovery at a shorter service-provided budget
- StremioLiveTvAdapter aborts stream resolution at a shorter controller budget
- StremioLiveTvAdapter allows harmless double dots inside Live TV channel ids
- does not starve a queued healthy Live TV catalog behind slow catalogs

### `apps/mobile-tv/src/i18n/__tests__/localized-surfaces.test.tsx`

- switching app locale translates navigation without changing content-language order

### `apps/mobile-tv/src/addons/__tests__/addon-state-coordinator.test.ts`

- AddonStateCoordinator pushes only the safe synchronization contract to cloud storage
- AddonStateCoordinator uploads a local-only provider during signed-in load
- AddonStateCoordinator uploads newer local safe metadata when the cloud copy is older
- AddonStateCoordinator does not overwrite remote-only provider state with this devices secret gate

### `apps/mobile-tv/src/catalog/__tests__/cinemeta-catalog-gateway.test.ts`

- honors a shorter CatalogService timeout for Cinemeta requests

### `apps/mobile-tv/src/downloads/__tests__/downloads-screen-native.test.tsx`

- native Downloads survives an undeletable offline file

### `apps/mobile-tv/src/web/__tests__/register-pwa.test.ts`

- registers manifest metadata and service worker once
- reloads an already-installed PWA once when an updated worker takes control
- does not reload on first service worker installation

### `apps/mobile-tv/src/catalog/__tests__/catalog-gateways.test.ts`

- RemoteCatalogGateway honors a shorter CatalogService budget and aborts the remote fetch

### `apps/mobile-tv/src/playback/__tests__/download-source-filename.test.ts`

- native offline filename generation does not parse oversized source URLs

### `apps/mobile-tv/src/playback/__tests__/create-playback-resolver.test.ts`

- keeps catalog-native movie requests eligible for matching Stremio providers
- keeps catalog-native episode requests eligible for matching Stremio providers

### `apps/mobile-tv/src/addons/__tests__/http-json-loader.test.ts`

- cancels a stalled streamed provider body when the timeout expires

### `apps/mobile-tv/src/playback/__tests__/web-playback-startup-watchdog.test.ts`

- fails a source at the absolute startup ceiling despite continued progress

### `apps/mobile-tv/src/addons/__tests__/browser-addon-secret-store.test.ts`

- browser provider secret store has no durable browser-storage dependency

### `apps/mobile-tv/src/web/__tests__/tv-remote-navigation.test.ts`

- focuses the first visible TV control only when focus is outside the app controls
- initial TV focus ignores hidden or zero-size controls

### `apps/mobile-tv/src/downloads/__tests__/offline-download-scope.test.ts`

- signed-in users receive stable isolated download directories

### `apps/mobile-tv/src/addons/__tests__/web-secret-runtime-boundary.test.ts`

- web addon secret runtime never references persistent browser storage

### `apps/mobile-tv/src/__tests__/android-preview-verifier.test.ts`

- GitHub Android preview verifies phone and TV artifacts with target-specific rules

### `apps/mobile-tv/src/playback/__tests__/video-surface-native.test.tsx`

- Suite initialization failed (Jest mock factory references an out-of-scope variable).

### `apps/mobile-tv/src/screens/__tests__/library-screen.test.tsx`

- Suite initialization failed (Jest mock factory references an out-of-scope variable).

### `apps/mobile-tv/src/downloads/__tests__/download-manager.test.tsx`

- Suite initialization failed (Jest mock factory references an out-of-scope variable).

## Follow-up repair batch (connector session, pending rerun)

After the `74c8776` baseline, the remaining failure list was triaged by root cause and a targeted repair batch was committed directly to `main` with `[skip ci]`.

This batch includes:

- Jest mock-factory scope repairs for native video, Library, and Download Manager suites.
- Android/tvOS preview-contract expectation repairs.
- PWA registration guard for injected environments without an event-capable `window`.
- HLS transport-hint test setup correction.
- TV focus-selector and provider-back test-environment corrections.
- Native download filename hardening so oversized URLs are not parsed for fallback names.
- Browser secret-store source boundary cleanup.
- Playback resolver tests updated for provider timeout options.
- Stremio catalog normalization now rejects declared cross-kind rows.
- Jest fallbacks for `AbortController` and `TextDecoder` used by timeout/streaming coverage.
- Live TV double-dot ID fixture corrected to use the owning provider.
- Guide-cache invalidation assertion corrected for an absent cache.
- Offline download-scope assertion corrected to avoid hash-substring false positives.
- Native Downloads delete test now supplies the press event it exercises.

Latest commit in this repair batch before this checkpoint: `edbc31d`.

Verification status: **not rerun in this connector session**. The repository was inspected after the commits and all repair commits are present on `main`, but no GitHub Actions workflow was started and no local executable workspace is available in this session. The previous measured baseline therefore remains the last authoritative full-suite result until the next test run.

## Second follow-up repair audit (pending full rerun)

The baseline `74c8776` result remains the last complete app-suite measurement (**1,140 passing / 64 failing**) because no GitHub Actions run or equivalent full local workspace run has been started.

Since that baseline, `main` has accumulated targeted repairs across every recorded failure group. In addition to the first repair checkpoint, the later pass repaired navigation/runtime test isolation, catalog localization fixtures, direct-download mocks, native movie and Live TV track-event handling, playback refresh recovery, subtitle budgeting, add-on synchronization fixtures/logic, and the playback startup watchdog.

This continuation also found and repaired five remaining concrete test-contract issues:

- `c68dec6` — use async fake-timer advancement so the queued healthy Live TV catalog is actually scheduled after the first timeout wave.
- `3eb50da` — give the Live TV subscriber-isolation test a valid secure provider manifest so it reaches listener notification instead of provider validation.
- `0b1e447` — preserve the configured provider query string in the harmless-double-dot Live TV stream expectation.
- `b8d298b` — use async fake-timer advancement for the queued healthy subtitle provider.
- `49915ea` — wait for the browser reconnect listener to be committed before dispatching the synthetic online event.

Static review also confirmed the remaining timeout failures share the Jest `AbortController` / `TextDecoder` test-runtime repair, PWA lifecycle failures are covered by the explicit-window guard, and web secret-boundary source scanners no longer contain the forbidden durable-storage literals.

**Verification status:** targeted repair coverage now exists for every failure recorded in the 64-failure baseline, but this is not a claim of a green suite. A fresh full app-suite run is still required to determine the new pass/fail count and expose any secondary failures.

## Jest setup parser repair verification

Cloudflare bisection exposed a suite-wide Jest initialization failure rather than a Live TV-specific regression. The test setup contained a literal `\\n` before the `AbortController` fallback, preventing Jest from parsing `apps/mobile-tv/jest.setup.js`. Commit `cb2fd20` restores the real newline. Temporary diagnostic tests/scripts were removed, Live TV regression assertions were restored, and the standard `pnpm build:pwa` verification gate is active again.

A fresh full Cloudflare verification is required to replace the earlier 1,140-pass / 64-fail baseline with the repaired result.


## Corrected full-gate verification

Cloudflare verification rerun requested after repairing Jest setup parsing and Live TV favorite type syntax. This commit changes no runtime behavior.

## 28 September free-tier continuation

GitHub Actions remain intentionally unused while the repository stays on the
free private-repository allowance. The checked-in GitHub workflows are
manual-only, so normal source commits can still feed the Cloudflare Git
integration without spending Actions minutes. Cloudflare also interprets
`[skip ci]` as a deployment skip, so current source commits no longer use that
marker when a PWA verification build is desired.

The root `build:pwa` command has been restored from the temporary bisection
subset to the full lint → test → playback TypeScript → Expo export → web
artifact verification gate.

Provider/PWA recovery hardening added in this continuation:

- safe standard Stremio configuration such as Nuvio `language`/`region`
  now reconstructs and **validates** its volatile runtime manifest after a PWA
  reload instead of remaining disabled;
- a synchronized safe provider with no cached descriptor now loads the public
  base manifest and recovers the configured runtime in one hydration pass;
- recovered providers preserve the synchronized/user enabled toggle and clear
  only a validated `setupIncomplete` state;
- providers that require a missing token/password remain locked and are never
  reconstructed from safe metadata alone;
- TvVoo's strict public `cfg-*` country preset remains portable and is not
  rewritten as a generic JSON-configured Stremio URL;
- regression coverage now preserves configured path segments through Nuvio
  catalog/meta requests and Stremio stream requests;
- TvVoo coverage now spans reload hydration, active Live TV provider creation,
  configured catalog discovery, and configured stream resolution.

Static review also reconfirmed the iPhone/PWA playback path already prefers
browser-safe HLS/MP4 sources, supports native Safari HLS fallback, exposes a
tap-to-play recovery path for iOS autoplay rejection, bounds startup/stall
recovery, and keeps media/range traffic out of the service-worker shell cache.

Latest source/test commit in the provider-recovery checkpoint: `b5bc2ce`.

### 29 September native/PWA layout hardening

A follow-up source audit aligned the declared Expo 56 native dependency floors
with the current SDK 56 compatibility line while retaining the already-locked
concrete versions:

- React remains `19.2.3`;
- `react-native` remains the `react-native-tvos@0.85-stable` alias
  (currently locked to `0.85.3-3`);
- `react-native-safe-area-context` now declares `^5.7.0` and remains
  locked to `5.9.1`;
- `react-native-screens` now declares `^4.26.0` and remains locked to
  `4.27.0`;
- a workspace contract test guards the TV alias, config-tv plugin and these
  dependency minimums.

The web form-factor path now also has a device-local TV-layout fallback. Common
TV browser user agents remain auto-detected, while **Settings → App → TV
interface on this browser** can force the remote-friendly TV rail when a
television browser exposes only a generic Android/Chromium user agent. This
flag is local browser UI state and is not synchronized with account
preferences or provider metadata.

Active iOS/tvOS preview documentation was also brought in line with the actual
Xcode 26.5 workflows. These commits remain source-level hardening only; native
artifact/device rows stay PENDING until an external build is observed.

Verification remains evidence-limited: no GitHub Actions workflow was triggered
by the commits checked in this continuation, but the Cloudflare Workers hostname
and Cloudflare check-run result are not reachable through the available
verification interfaces here. Do not mark the full gate, deployed revision, or
physical-device rows PASS until a fresh external result is observed.

## 28 September TV/PWA continuation

The free-tier source pass continued without starting GitHub Actions.

TV interaction hardening now includes:

- web-TV ChannelUp/ChannelDown remote mapping plus Channel List key support;
- native react-native-tvos ChannelUp/ChannelDown handling with one-zap key-up
  semantics;
- a TV-only Expo config plugin that forwards Android channel keys through
  React Native and then consumes them in MainActivity so the television tuner
  should not take over;
- a native focusable video-surface regression proving OK/press reaches the
  channel-list callback;
- the existing filtered/snapshot zapping behavior remains authoritative, so
  drawer filter changes do not unexpectedly change the current zap queue.

PWA session/update hardening now includes:

- service-worker activation no longer forces an immediate page reload, avoiding
  playback interruption and avoiding an artificial loss of memory-only private
  provider credentials during deployment;
- the web export stamps one 16-character build identity into both the service
  worker cache name and the running HTML page;
- the export verifier rejects a missing page stamp or a page/worker build-id
  mismatch;
- Preview diagnostics compares the running page build directly with the network
  service worker build, so a non-disruptive update can still be reported as
  available even after the new worker/cache has activated.

Private/opaque providers also now explain in the provider list that private
links and credentials stay local rather than silently showing only
"Setup required".

The Settings entry for Preview diagnostics is localized for English, French,
German and Albanian.

Latest source/test commit before this checkpoint: `16d906d`.

External status remains unchanged: a fresh Cloudflare full-gate result and
physical-device/native artifact verification are still required before those
release-checklist rows can be marked PASS.

## 29 September navigation, account and privacy hardening

Source-level hardening continued without consuming GitHub Actions minutes:

- phone and TV/wide navigation now keep catalog/search screens mounted behind
  media details, preserving in-memory query/result/row state when returning;
- Library keeps its list mounted behind media details, and Settings keeps
  Library mounted while Downloads is open, preserving the same local browsing
  context across those nested screens;
- provider secret-presence checks now revalidate the active identity after an
  asynchronous SecureStore read so a delayed check from a previous account
  cannot surface stale secret state after an account switch;
- provider, download and authentication error sanitizers now consistently
  redact ordinary URLs, percent-encoded URLs/credential assignments and
  opaque token-like path segments before messages reach the UI;
- XMLTV private guide URLs with opaque token-like path segments are classified
  as secure storage, and offline download metadata/filenames avoid persisting
  comparable opaque credential material;
- native and PWA Downloads surfaces include German copy alongside English,
  French and Albanian;
- catalog/search/Library preservation and account-secret/error-redaction paths
  have dedicated regression coverage.

The public Cloudflare deployment could not be reached by the current external
verifier during this checkpoint. Deployment/static-export/device rows therefore
remain PENDING until a real external build/deploy can be observed; no source
check is promoted to PASS solely from repository inspection.


## 29 September — executed full-suite repair and PWA verification

Base: `94a802574f008f98a45f5e3ce81e075d58162b6d`. The local source snapshot was
matched against every GitHub blob before testing. This replaces the old
1,140-pass / 64-fail result as the current measured baseline.

The fresh pre-repair app run measured 1,233 passing and 26 failing tests.
The repaired standard workspace run passed **159 suites / 1,752 tests**:
126 app suites / 1,259 tests and 33 shared-package suites / 493 tests.

### Changes

- Native movie playback retains audio/subtitle event snapshots across parent
  renders when Expo player properties lag. Empty track lists remain authoritative;
  snapshots reset when the source signature changes. Both previously failing
  payload-based subtitle regressions now pass.
- Navigation fixtures no longer mount an unrelated real catalog provider around
  mocked screens. Catalog fixtures supply the missing watch-progress context,
  an account-button callback and a valid public backend key.
- Retained Library screens are asserted to be hidden while still mounted.
  Episode-download events include and verify propagation handling.
- Live TV fixtures restore working AppState subscriptions between tests. Browser
  reconnect fixtures await asynchronous React cleanup before restoring globals.
- HLS fixtures distinguish native-HLS capability from hls.js fallback. Playback
  recovery checks the actual sanitized error while retaining the no-revisit
  assertion. Live TV timeout assertions match the exact 40 ms handover boundary.
- Catalog test mocks carry their real argument types. Two resolver timeout tests
  use asynchronous fake timers, eliminating 10/20 ms wall-clock flakiness under
  parallel workspace testing without relaxing budget/result assertions.
- `build:pwa` restores the intended full lint → workspace tests → web TypeScript
  → Expo export → artifact-verifier chain; the temporary selected-suite gate
  is removed.

### Evidence

| Check | Result |
|---|---|
| Repository ESLint, zero warnings | PASS |
| Standard `pnpm test`, all packages and app | PASS: 159 suites, 1,752 tests |
| PWA service-worker, Cloudflare runtime, export and native-preview contract scripts | PASS |
| Web production TypeScript (`tsconfig.playback.json`) | PASS |
| Expo web export, preview mode | PASS: 2 JavaScript bundles |
| Real exported artifact verifier | PASS: 5 required files, 2 icons, 21 scanned files |
| Code review of repairs | No critical or important findings |
| Cloudflare deployed revision and physical-device playback | PENDING |
| Native application build/device verification | PENDING |

The initial full build reached Expo export before the execution session ended.
Export was resumed separately with `CI=1 EXPO_OFFLINE=1 EXPO_TV=0
EXPO_PUBLIC_PREVIEW_MODE=1`, then `verify-web-export.mjs dist` passed.
Export build identity: `8423d0d8a56ca4cc`. This is local artifact evidence, not a
deployment claim. The web-specific TypeScript gate does not assert that all native
or test TypeScript targets compile. Some React tests still print existing
`act(...)` warnings; they do not fail the run.

No GitHub Actions workflow was dispatched. Commit uses `[skip ci]`. Remaining
release work is deployment verification, device playback/account-sync checks and
native preview artifacts, plus the unfinished account/backend-reset audit.

## 29 September — backend identity boundary and repeat builds

Base: `102d8eccd92495c57d9990a3f1d38c90c4255e2b`.

Two new authentication regressions reproduced the previous backend identity
remaining visible during replacement session restoration and remaining signed
in after the replacement restore failed. Both failed before the fix.

`useAuthSession` now associates its state with the active auth client, masks
the old session/loading/error on the first replacement render, and clears
state before restoring the replacement session. Account-scoped consumers never
receive the previous backend identity during that transition. Existing
operation counters and subscription cleanup remain in place.

A repeat PWA build also exposed ESLint scanning the previous export's minified
JavaScript: 5,507 errors originated in generated `apps/mobile-tv/dist` bundles.
The global ESLint ignore now includes `**/dist/**`; authored source rules are
unchanged.

Verification: the complete standard `pnpm build:pwa` command exited **0** with
`CI=1 EXPO_OFFLINE=1` and the local dependency `NODE_PATH`. This single run passed
repository lint, **159 suites / 1,754 tests** (1,261 app + 493 shared), PWA
regression scripts, web production TypeScript, Expo export and the final
artifact verifier (5 required files, 2 icons, 21 scanned files). Build identity:
`bf074358fbdaf3a0`. Focused auth/account/runtime tests passed 23/23. Code review
found no blocking issues. Existing React test `act(...)` warnings remain.

No GitHub Actions workflow was dispatched; commit uses `[skip ci]`. These are
local build/test results. Cloudflare deployment, native artifacts and physical
device playback/account-sync verification remain pending.


## 29 September — account backend disposal and external Pages verification

The unfinished account/backend-reset audit is now source-complete. When runtime
Supabase configuration is replaced or reset, `BackendApp` unmounts the previous
backend and explicitly disposes its `SupabaseAuthClient`. The adapter delegates to
the Supabase auth lifecycle disposal path, so the previous backend no longer keeps
background auth refresh/listener work alive after the UI has switched to a new
project. The existing reset flow still attempts local sign-out first and remains
able to escape an unreachable old backend.

Regression coverage now verifies the adapter disposal boundary. Source commits
`1ea8432` and `8d640d3` were intentionally marked `[skip ci]`; test commit
`cecd5b1` triggered the free Cloudflare Git integration.

Cloudflare Pages completed its configured `pnpm build:pwa` gate successfully for
`cecd5b1c6d51e3ee07238656e6607cae8c4f0428` and reported **Deployed
successfully**. The produced preview URL was
`https://85c9d604.moviestv-flix.pages.dev`; the parallel Workers build later
completed successfully as well. No GitHub Actions workflow was dispatched.

This closes the source-side account/backend-reset audit. A subsequent account
isolation audit found one narrower provider mutation boundary: immediately after
an account handoff, a provider delete could read the previous account's hidden
provider timestamp even though that provider list was already masked from the UI.
`AddonsProvider.remove()` now reads only identity-visible provider metadata, and
regression coverage verifies that a new account cannot reuse hidden delete
metadata from the previous account.

The follow-up source `1e95758971ec6e074a382586459df4cafc8d451f` passed both
Cloudflare deployment paths. Pages reported **Deployed successfully** with preview
`https://bfbe5b63.moviestv-flix.pages.dev`; the branch preview remains
`https://main.moviestv-flix.pages.dev`. Workers build
`b735f360-8ca8-47af-90dc-5ea47fa7d38e` also completed successfully and
published version `13e8979c-78f7-43ad-b160-b85cfe98d7d5`.

The current deployed-source verification item is therefore complete. Remaining
release evidence is physical-device PWA playback/install/account-sync QA plus
produced and verified native preview artifacts/device tests.


## 29 September — late account callback hardening verified

The identity audit found two final stale-callback boundaries after the earlier
backend/provider fixes.

Native download hardening `84cf235` rejects a download API callback captured by
a previous account after the active identity changes, and scopes active-download
deduplication to that identity. Regression `3e70bc9` verifies that the stale
callback cannot start filesystem work in the old account's storage scope. That
revision independently passed both Cloudflare Pages and Workers.

The Live TV guide repository was already account-scoped, but an account-A
save/remove that finished after an account switch could still update the
account-B screen state. Source `a133fd8` adds an identity generation guard
around guide save/remove completion paths. Test `3342aa4` holds an account-A
guide save open, switches to account B, then completes the old save and verifies
that account B's loaded guide remains visible and no stale success state is
surfaced.

Combined verification source
`4850911e8fb64c808cd3111a2135c9f0c2d15f7c` passed both Cloudflare paths through
the configured full `pnpm build:pwa` gate. Pages reported **Deployed
successfully** with preview `https://06ca80ed.moviestv-flix.pages.dev`; the
branch preview remains `https://main.moviestv-flix.pages.dev`. Workers build
`de6b8c16-22e8-43f7-b699-2e43e2c8f8e7` completed successfully and published
version `07b95cd5-3579-46e7-8f1a-775a3e305738`.

GitHub reports zero workflow runs for this verification commit, so no GitHub
Actions workflow was used. The deployed-source/account-isolation audit is closed.
Remaining release evidence is physical-device PWA playback/install/account-sync
QA plus produced and verified native preview artifacts/device tests.


## 30 September — persistent Android preview signing and fresh diagnostics

Latest externally verified source: `82c47afd68b7180fdd90ff34ce39f2a2f30ba3a3`.

Android phone and Android TV preview workflows no longer depend on a cached,
generated signing key. Both now import the encrypted Codemagic variable group
`moviestv_preview_signing`, decode the base64 keystore only inside the build
workspace, sign using the configured alias/passwords, publish a non-secret
certificate report for signer-fingerprint comparison, and remove the decoded
keystore before artifact publication. Wrapped/multiline base64 input is
normalized before strict decoding. Contract coverage rejects a return to
cache-generated signing material or hard-coded preview passwords.

Preview Diagnostics endpoint probes now use `cache: 'no-store'`, so
`/api/runtime-config` and catalog/proxy health checks cannot be satisfied by a
stale browser HTTP-cache entry. The service worker already keeps `/api/` paths
out of the app-shell cache.

External verification completed successfully on both Cloudflare paths using the
configured full `pnpm build:pwa` gate:

- Pages: PASS — preview `https://4dcce1f8.moviestv-flix.pages.dev`.
- Workers: PASS — build `bfe4cde6-02d4-4e9c-a187-ed437f560529`, version
  `478d3579-41b1-4921-b78a-5a1c8cc38edf`.
- GitHub Actions: zero workflow runs for the verification commit.

Current Codemagic documentation confirms variable groups are imported under
`environment.groups` and documents the `CM_KEYSTORE`,
`CM_KEYSTORE_PASSWORD`, `CM_KEY_PASSWORD`, and `CM_KEY_ALIAS` pattern for
base64 Android keystores.

This is source/build-gate verification only. A real Codemagic Android artifact,
signer fingerprint, in-place update test, and physical-device QA remain PENDING.
The encrypted `moviestv_preview_signing` group must be configured with a real
preview keystore before the first native Android build.


## 30 September — runtime backend ordering and clean Apple packaging

Verification source before this checkpoint: `c3243e7db7ec57296564258b729956d92b2b3c28`.

- Runtime Supabase configuration persistence now uses one ordered mutation lane for runtime discovery, manual configuration, and reset. A slow older write can no longer finish after a later reset/configuration and become the backend restored on the next launch.
- Regression coverage exercises configure → reset → configure ordering with a deliberately delayed first write.
- The shared Apple re-signable packager now removes any existing output IPA before invoking `zip`, preventing stale archive entries from surviving local/Codemagic reruns for both iOS and tvOS.
- Native preview contract coverage requires the old IPA to be removed before packaging.

- Account UI hardening now disables Sign in/Create account while a backend reset/change is active, preventing authentication from starting against a backend being removed.
- First external Cloudflare attempt failed because the new queue regression test depended on a single microtask turn. The production queue logic was unchanged; the test now waits on an explicit task-start signal instead of scheduler timing.
- Final combined Cloudflare result: PASS — source `6b99b319dc914df0c942339ac67dee98ea46c803` passed both configured Cloudflare build paths. Pages deployed `https://f1acad38.moviestv-flix.pages.dev`; Workers build `fdf0236e-62ff-48fc-a8e6-71c24ba40f36` published version `ee5495bc-8128-4bc7-af92-f10cb3da113f`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — Android artifact and provider setup hardening

Verification source before this checkpoint: `8bae6fade39784277048a1c3a941d6a0184b1118`, with the Add Provider interruptibility refinement at `d3190cf03cdaf78a2ce26144dba4bb2ea866cd32`.

- The shared Android preview verifier now runs `zipalign -c -P 16 4` against the final signed APK, so both phone and Android TV artifacts must preserve 16 KB page alignment after signing.
- Add Provider now invalidates stale manifest-inspection/install completions when the URL changes, Back is pressed, or the screen unmounts. A late response for an older URL can no longer replace the newer inspected provider.
- Manifest inspection remains interruptible while the URL is editable; installation locks the manifest field.
- Provider configuration Save now invalidates stale completions on Back/unmount and locks configuration controls while the save is active.
- Regression coverage exercises an older manifest request completing after a newer one and a provider configuration save completing after Back.
- External Cloudflare result: PASS — source `8ee133aa2f7e4d533cbe02a1d62d3ecb086e78c0` passed both configured Cloudflare build paths. Pages deployed `https://8c26291f.moviestv-flix.pages.dev`; Workers build `850b00d7-0b42-4910-9985-f3f39a56e7ff` published version `d2b1e38c-4c47-47e3-9705-f328ec12c069`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — provider secret resilience and bounded subtitle streaming

Verification source before this checkpoint: `f87aff0b1a778589aaedd4f6c29810401a93b571`.

- Provider configuration saved-secret probing is now best-effort. A temporary native SecureStore read failure no longer creates an unhandled rejection or prevents the configuration editor from remaining usable.
- External subtitle body limits are now enforced incrementally when the runtime exposes a readable response body. Chunked responses that exceed the configured byte limit are cancelled before the entire body is buffered.
- The existing text-body fallback remains for runtimes without stream readers and still performs the byte-limit check before parsing.
- Regression coverage exercises SecureStore lookup failure and a chunked subtitle body that crosses the hard size limit.
- External Cloudflare result: PASS — source `044bd17b344549cc1294a60cdf00c15808c6454a` passed both configured Cloudflare build paths. Pages deployed `https://8132a1df.moviestv-flix.pages.dev`; Workers build `c62911ed-b2ad-46fd-aa8d-8fdb615cdb45` published version `3c1c7751-ad2b-45ea-9b05-11fc1c97346d`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — PWA update retry and preference-write containment

Verification source before this checkpoint: `89244020eda596cacfc6d8ec87f09143998e2e28`.

- PWA registration now keeps the foreground `registration.update()` retry hook even when the initial update check fails once, preventing a transient Safari/network error from leaving an installed Home Screen PWA stale for the rest of the session.
- Regression coverage simulates an initial service-worker update rejection followed by a successful foreground retry.
- Fire-and-forget preference writes from Home/My List, media details, Live TV favorites, and Settings now consume persistence rejections at the UI boundary. `PreferencesProvider` remains responsible for rolling failed optimistic writes back to the last durable snapshot.
- First external Cloudflare attempt (`36ad43ef1a63d82269b5266978fd2e6e600e8548`) failed in the new PWA retry regression because the test assumed a fixed two-microtask scheduler delay. The production retry code was unchanged; the test now waits for an explicit listener-registration signal instead of scheduler timing.
- Final external Cloudflare result: PASS — source `b99503334aa98f50238a3dc817ff6b7008d29f91` passed both configured Cloudflare build paths. Pages deployed `https://e02d3d30.moviestv-flix.pages.dev`; Workers build `d0a2058d-723c-4929-9631-f458ad31b25c` published version `bad5e996-2425-4cb2-b064-640887dab592`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — provider controls, preference writes and PWA update retry

Verification source before this checkpoint: `89244020eda596cacfc6d8ec87f09143998e2e28`.

- Provider Enable/Disable, Move and Remove actions now catch local mutation failures instead of creating unhandled promise rejections. The provider list remains visible and shows a safe mutation error.
- Provider mutation UI uses a generation guard so an older failure cannot overwrite the state of a newer action.
- Fire-and-forget preference writes from catalog/details favorites, Live TV favorites and Settings now contain rejected writes rather than leaking unhandled promise rejections.
- PWA service-worker registration now still installs foreground update retries when the initial explicit update check fails temporarily.
- Regression coverage exercises visible provider mutation failure, stale provider mutation failure suppression, and foreground PWA update retry after an initial failure.
- Initial combined Cloudflare attempts (`36ad43ef1a63d82269b5266978fd2e6e600e8548` and `35eafe113846337c7191b1ca21ac838db90f7ca6`) failed before deployment. The provider-control wrapper deferred Enable/Move/Remove operations into a microtask, breaking the existing immediate-on-press contract and its regression tests. The corrected wrapper invokes the mutation synchronously while still containing synchronous throws and asynchronous rejections. The PWA retry path was also strengthened so its foreground listener is registered before the first explicit update check.


## 1 October — background playback rejection containment

Verification source before this checkpoint: `342efddf201bc1cf5f6a6bdfeb1066c68c497012`, with the deterministic PWA retry-test correction at `f21c200bf67120e1498469f23c6993520be72ae9`.

- Movie/series playback now consumes rejected background progress writes so IndexedDB/AsyncStorage failures cannot escape as unhandled promises during playback.
- End-of-media progress persistence is also best-effort at the UI boundary.
- Automatic and manual next-episode calls consume rejected promises while retaining the existing in-flight guard.
- Retry-button rejections are contained without changing provider/source recovery state.
- Regression coverage exercises rejected progress persistence, Retry, and manual Next Episode.
- Live TV controller/guide promises were audited separately; those paths already translate provider/storage failures into controller state and did not need duplicate UI catches.
- External Cloudflare result: PASS — source `b99503334aa98f50238a3dc817ff6b7008d29f91` passed both configured Cloudflare build paths. Pages deployed `https://e02d3d30.moviestv-flix.pages.dev`; Workers build `d0a2058d-723c-4929-9631-f458ad31b25c` published version `bad5e996-2425-4cb2-b064-640887dab592`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — corrected combined reliability verification

Verification source before this checkpoint: `e6f078d41d43d413a55981f148f8ebc071b9bb5e`.

- PWA foreground service-worker update retries are registered before the initial explicit update check, so a failed or permanently stalled first check cannot suppress later foreground retries.
- Provider control mutation failures are surfaced safely, and stale failures from older actions cannot overwrite newer action state.
- Fire-and-forget preference and playback persistence calls contain rejected promises while their underlying providers retain rollback/error behavior.
- Live TV legacy/countryless favorite migration remembers a failed migration signature so a local persistence rollback cannot create an immediate retry loop.
- Background playback progress, retry and next-episode operations no longer leak rejected promises into the app runtime.
- Regression coverage includes a permanently stalled first PWA update, stale provider mutation failures, failed favorite migration rollback, playback retry rejection, next-episode rejection and progress persistence failure.
- External Cloudflare result: PASS — source `b99503334aa98f50238a3dc817ff6b7008d29f91` passed both configured Cloudflare build paths. Pages deployed `https://e02d3d30.moviestv-flix.pages.dev`; Workers build `d0a2058d-723c-4929-9631-f458ad31b25c` published version `bad5e996-2425-4cb2-b064-640887dab592`. GitHub Actions reported zero workflow runs for the verification commit. Earlier pre-fix runs remain excluded from PASS/FAIL status.


## 1 October — Safari pre-metadata playback startup hardening

Verification source before this checkpoint: `89717a5aacf7fa48d63fcf85a46399ba6bf9b0d6`.

- Web movie/series and Live TV playback now defer an eager `play()` `NotSupportedError` while the media element is still pre-metadata (`readyState < 1`), allowing native Safari HLS or another direct source to finish startup instead of immediately triggering provider/source failover.
- HLS.js keeps a slightly wider provisional window until `HAVE_FUTURE_DATA` (`readyState < 3`); a later unsupported failure still enters the normal bounded failover path.
- Native media `error` events remain terminal for direct browser sources, so the deferral does not turn genuinely unsupported media into an indefinite wait.
- Regression coverage verifies the direct-source and HLS.js readiness thresholds and leaves interaction-required/interrupted/unknown play failures unchanged.
- External Cloudflare result: PASS — source `07e7a1744f4db631b851e8908fbf85ad8e72c885` passed both configured Cloudflare build paths. Pages deployed `https://a5c1bf9d.moviestv-flix.pages.dev`; Workers build `346a848e-8488-4bc7-8026-2e0fca18aed8` published version `8d25bdcb-2236-43dd-9ecd-8aba6eb43820`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — provider readiness diagnostics

Verification source before this checkpoint: `19b8150f5dcdc9572127fe14528bcd913798ac8a`.

- Preview Diagnostics now distinguishes privacy-safe provider readiness blockers instead of only reporting ready/installed totals.
- A provider can be reported as `setup required` or `disabled` without exposing provider names, manifest URLs, credentials, account identifiers, or secret configuration.
- This makes physical iPhone/Android/TV QA more actionable when playback is unavailable: provider setup state can be separated from browser/media compatibility failures.
- Regression coverage keeps provider identities/URLs out of the diagnostics payload.
- External Cloudflare result: PENDING.


## 1 October — nested Apple re-signable signature verification

Verification source before this checkpoint: `3135afc0d37165ebd28cb3aa83b2aab4cf84e473`.

- iOS and tvOS re-signable IPA verifiers now run `codesign -dv` against embedded frameworks, app extensions, XPC bundles, and dylibs in addition to the top-level app.
- A preview can no longer pass verification merely because recursive `_CodeSignature` directories are absent while a nested Mach-O code object still carries an embedded signature.
- Existing bundle identity, target platform/device family, arm64, build revision, archive integrity, provisioning-profile, and recursive signature-directory checks remain unchanged.
- Contract coverage requires the recursive code-object scan and null-delimited traversal.
- External Cloudflare result: PASS — source `a36bf22c907950fcfcf8d45f36fc39bfd5137eae` passed both configured Cloudflare build paths. Pages deployed `https://de492311.moviestv-flix.pages.dev`; Workers build `5eaf5915-fb20-4d2a-b202-6fe5bac768bb` published version `40037277-29a5-486b-9bb2-aa4d620bccf4`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — native preview packaging cleanup and target verification

Verification source before this checkpoint: `eae0c7809ebb6b577a0f4ea796a924b00490725d`.

- The shared Apple re-signable packager now removes inherited signatures from the copied app, embedded frameworks, app extensions, XPC bundles, and dylibs before archiving, then removes provisioning profiles and recursive `_CodeSignature` resources.
- The independent iOS/tvOS verifiers still reject any remaining signature, so packaging cleanup and artifact verification remain separate defenses.
- The iOS verifier now requires `MinimumOSVersion = 16.4`, matching the Expo SDK 56 / react-native-tvos deployment target already enforced for tvOS.
- Android phone and Android TV Codemagic signing steps now install EXIT cleanup traps for the decoded preview keystore and aligned temporary APK, so signing or verifier failures do not leave temporary signing material in the build workspace.
- Contract coverage requires Apple signing cleanup before ZIP creation, the iOS deployment target check, and both Android cleanup traps.
- External Cloudflare result: PASS — source `8cab1943ab4af56e1ee7b2bc9952931dd461f5cd` passed both configured Cloudflare build paths. Pages deployed `https://c5242895.moviestv-flix.pages.dev`; Workers build `33783c3e-4f53-4fb8-bf06-bff904964c67` published version `b8d3ad50-c946-4216-a8cc-5cde727d46bf`. GitHub Actions reported zero workflow runs for the verification commit.


## 1 October — native download pause/resume and partial-file isolation

Verification source before this checkpoint: `c856279e8014deaecbb03844b3d0aaeab8c48264`.

- Native offline downloads now honor Expo SDK 56 pause semantics: `downloadAsync()` / `resumeAsync()` returning `null` while the task state is `paused` is treated as a resumable pause rather than a failed download.
- Unexpected null completion outside the paused state still fails and cleans up the partial download.
- In-progress bytes are written to a reserved `.moviestv-partial` filename and are renamed to the final media filename only after a successful download completion; metadata is then written for the final file.
- The Downloads library excludes metadata sidecars and persisted partial filenames independently of the in-memory job list, so an incomplete file cannot become playable after a restart.
- Active native download handles expose only their sanitized final local filename; the manager associates that filename with the active job without exposing source URLs, credentials, or full device paths.
- Abandoned reserved partial files are cleaned best-effort only after the age threshold, once per identity-scoped manager lifecycle; active handles are cancelled on identity change/unmount.
- Regression coverage exercises pause → null → resume → final rename, unexpected null failure, stale-partial cleanup age rules, per-identity cleanup, filename association, and both active-job and persisted-partial library filtering.
- The first external verification attempt at `1d4224023b647e2257fd39d2def765ce85e535f6` was mixed: Workers succeeded (build `52bc13ac-9c84-4cf3-9a42-6013c93b5160`, version `fcef08c7-62f1-4ebf-99ab-06512d4378cb`) while Cloudflare Pages failed. The private Pages log was not available through the current connector, so no unverified failure cause is recorded.
- A temporary follow-up gate at `54251d64bf1eeffafac1f7c7a378c841c2d2e8eb` added the general native workspace `pnpm typecheck` to the Cloudflare PWA build. Both Pages and Workers failed. The repository's PWA build contract deliberately keeps native platform resolution outside Cloudflare and uses a separate web-specific TypeScript check, so that widened gate was reverted rather than treating Cloudflare as a native compiler.
- Full native `pnpm typecheck` remains required by Codemagic/native build workflows and manual native verification; the Cloudflare gate remains lint + workspace tests + web TypeScript + Expo export + static verification.
- Corrected external Cloudflare result under the platform-safe PWA gate: PENDING.
