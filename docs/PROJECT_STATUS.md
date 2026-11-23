# MoviesTv-Flix — Project Status

Dated snapshot of what exists, what is verified, and what is blocked.

Rules: the Git repository is the truth; this file is a checkpoint. Evidence
vocabulary is fixed by `AGENTS.md` §9. Never upgrade an evidence class without
new proof.

## Snapshot

- Audit date: **2026-11-22**
- Latest release: **v0.7.3**, built from `main` with all three assets: iOS IPA
  (31.0 MB), Android APK (84.0 MB, versionCode 20261160) and the macOS DMG
  (6.2 MB, self-contained web build with an app icon).
- **The repository is private**, so anonymous GitHub release checks return 404.
  The macOS self-update therefore reports "Update check failed (HTTP 404)" until
  releases are readable without a session.
- Last verification pass: **2026-11-22** on `main` (`0.7.2` bump) — `pnpm lint` (0),
  `pnpm typecheck` (0), `pnpm test` (**179 app suites / 1,673 tests**,
  `packages/addons` 14 / 202),
  `pnpm build:pwa` (export verified, 50 files scanned). The macOS app was installed to `/Applications`
  and measured: first paint **2,599–2,626 ms**, down from 12,356 ms, with the
  Home header no longer overlapping the first row (`headerBottom 46`,
  `titleTop 76`).
- **macOS 0.7.3 — Verified now (device)**: installed at `/Applications/MoviesTv-Flix.app`,
  bundles its own web export, signed in against the live backend and listed the
  four providers synced from the phone plus Continue Watching progress
  ("The Odyssey, 7% · 12 min"). First paint 2,599–2,626 ms after the font-gate
  fix. Playing a real provider stream is still untested on this build.
- **iPhone 17 Pro Max — Verified now (device)**: 0.7.3 (build 20261160) installed
  over `devicectl` and launched (`MoviesTvFlix` process running) on 2026-11-22.
  It is signed with the distribution certificate in the login keychain and the
  only Ad Hoc profile available, which names `app.grape2354.valley804`; it
  therefore installs as a second app ("MoviesTv-Flix 0.7") next to the 0.5.5
  install under `com.jugentorba.moviestvflix`. An in-place upgrade of 0.5.5 still
  needs a profile for the real bundle id.
- **Android TV APK — Verified now (artifact)**: `MoviesTv-Flix-0.5.5-android-tv.apk`
  declares `android.software.leanback` required, `android.hardware.touchscreen`
  not required, a leanback launchable activity and the TV banner/icon. Runtime
  evidence is still missing: no Android TV system image is installed, and pulling
  one is a multi-GB SDK install that needs approval.
- **tvOS 27.2, Apple TV 4K simulator — Verified now**: the TV build launches and
  renders the left rail (Home / Movies / Series / Live TV / Search / Settings),
  the header and the catalog empty state. Two TV-specific defects had to be fixed
  first: pod targets declaring tvOS 11, and `expo-screen-orientation` throwing at
  import because its pod is not linked on tvOS. Live TV's channel box still needs
  a provider and remote navigation to reach. Startup measured
  in a release build on the iOS 27.2 simulator: `app-render` +54 ms,
  `catalog-mounted` +205 ms, `catalog-rows` +218 ms after JS start.
- Previous verification pass: **2026-11-21** on `main` (`0a970e70`) — the icon
  player captured in the iOS 27.2 simulator in landscape (nine controls, video
  letterboxed inside the safe frame), insets measured `T0 R62 B20 L62`.
- Previous verification pass: **2026-11-19** on `main` (`3ad6c234`) — `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (app 152 suites / 1,521 tests), iOS Release build
  for device, Android Release APK
- Previous verification pass: **2026-11-18** on `main` (`11aaafa0`) —
  `pnpm lint`, `pnpm typecheck`, `pnpm test` (app 146 suites / 1,487 tests),
  `pnpm build:pwa`, a Release iOS build on the iOS 27.2 simulator that installs
  and launches, and the built PWA inspected in Chromium
- Sync schema is **live** on Supabase project `exolfkcfxgfutzoutldl`; isolation
  proved by `apps/mobile-tv/scripts/verify-rls.mjs` (11/11 checks)
- Previous verification pass: **2026-11-18** on `feat/mkv-web-native-playback`
  (PR #67) — `pnpm lint`, `pnpm typecheck`, `pnpm build:pwa` and
  `pnpm test` (app 145 suites / 1,474 tests), plus the macOS DMG and PWA
  playback matrix in `docs/builds/mkv-playback-results.md`
- Last device-side verification: **2026-11-18** on PR #67 — mounted macOS DMG
  (libVLC 3.0.24): MKV H.264/AAC and MKV H.264/E-AC-3 at 1080p play with video
  and an audio track and seek from 7 s to 10.6 s; the injected JS bridge opens
  the native player. PWA origin: WebKit rejects MKV and plays remuxed HLS;
  Chromium plays MP4, MKV and remuxed HLS.
- Previous device-side verification: **2026-11-18** on `main` (`13495eb6`) — Android
  17 emulator, Metro-served debug build: imported a local M3U playlist with two
  public HLS channels, both listed in Live TV, and selecting one played it
  (frames decoded, no unavailable state). Earlier the same day, the debug build
  loaded from Metro through `adb reverse` for the first time in this repository,
  with zero `ReactNativeJS` errors.
- Previous device-side verification: **2026-11-17** on `main` (`3308fef9`) — Android
  17 emulator launch run: `Medium_Phone_API_37.0` (arm64-v8a, 1080×2400),
  `assembleRelease -PreactNativeArchitectures=arm64-v8a` APK (76 MB,
  debug-signed) installed, Home rendered live Cinemeta rows, and the in-app
  German locale was verified on Settings, Live TV, the guide and the M3U
  playlist screens
- Previous device-side verification: **2026-11-15** on
  `fix/vlc-surface-rerender-release` (`592e8d99`) — iOS simulator playback run
  (iPhone 17, iOS 27.2)
- Repository: `jugentorba/MoviesTv-Flix`
- Code state described here: `feat/mkv-web-native-playback` (PR #67);
  documentation refreshed by this commit
- Working tree at audit: clean on `main`
- Later docs-only commits do not change the snapshot below.
- Merged work on **2026-11-14**: PR #37 (`fix/web-container-capability`)
  `a78d38fe`, PR #38 (status bookkeeping) `f195ef63`, PR #39 (scoped
  pull-request CI) `12b7c7a4`, PR #40 (PR #34 evaluation) `af41bac1`, PR #41
  (native VLC surface) `e2c3eb31`, PR #42 (status bookkeeping) `0cf0c176`,
  PR #43 (libvlc teardown fix) `b36dea5b`, PR #44 (status bookkeeping)
  `6425b3f0`; CI green on `main` (run
  [43625866143](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43625866143)
  before #41, the `pull_request` runs
  [43629723794](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43629723794)
  for #41 and
  [43632379418](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43632379418)
  for #43); Cloudflare Pages preview
  `https://fix-web-container-capability.moviestv-flix.pages.dev`
- Merged work on **2026-11-15**: PR #49 (libvlc release on unmount), PR #50
  (M3U parser), PR #51 (M3U playlists as a Live TV source, `9b27b9db`),
  PR #52 (watch history screen and deletion, `9fbf168f`)
- Merged work on **2026-11-17**: PR #53 (native audio tracks that resolve after
  load, `4ccb205c`), PR #54 (playlist channel-cap reporting and Live TV notice,
  `5357456f`); open follow-up issue #55 is superseded by #54. Then PR #56
  (`6ae82e2b`, `t(key, params?)` and the `screens` pack), PR #57 (`dd9fa385`,
  Gradle 8.14.3 pin), PR #58 (`2ccc0ec5`, catalog copy), PR #59 (`92a790bc`,
  account and provider copy), PR #60 (`43994eb8`, downloads and update copy),
  PR #61 (`2e2a90de`, settings and profile copy) and PR #62 (`3308fef9`,
  Live TV guide and playlist copy)
- History span: **2026-09-05 → 2026-11-18**, 4,873 commits on `main` before
  this docs commit
- Latest published artifacts: private release `preview-latest`, assets uploaded
  **2026-10-02**
- Unmerged design work: `ui-redesign-v2` (PR #34), 358 commits ahead and 15
  commits behind `main`; evaluated 2026-11-14, split recommended
- Milestone: **preview alpha** — broad feature coverage, not release-ready;
  external configuration and physical-device QA outstanding

### Gates run at the latest verification (2026-11-18)

| Gate | Result | Notes |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | one workspace link added (`@moviestv/auth`) in PR #64; no external package |
| `pnpm lint` | PASS | exit 0, zero warnings |
| `pnpm typecheck` | PASS | all workspace packages |
| `pnpm test` | PASS | all workspace packages; app 146 suites / 1,487 tests |
| Supabase isolation (`scripts/verify-rls.mjs`) | PASS | 11/11 against the live project: a second user cannot read, insert into or update another user's row; a sessionless client is refused |
| iOS Release build + launch (iOS 27.2 simulator) | PASS | installs and stays running; screenshot captured. Two plugins make it reproducible: scene lifecycle and pod deployment target |
| PWA export | PASS | `pnpm build:pwa` + verifier (7 required files, 2 icons, 50 files scanned) |
| macOS DMG native playback (`--native-test`, `--bridge-test`) | PASS | mounted DMG, libVLC 3.0.24: MKV H.264/AAC and E-AC-3 1080p playing with video and audio track; seek 8 s moves clock 6.96 s → 10.58 s; bridge opens the player (2026-11-18) |
| macOS app first paint | PASS | `--smoke-test` reports `PAINTED after 2,599 ms` (bundled, loopback HTTP); was 12,356 ms before the font gate opened on a grace period (2026-11-22) |
| Provider setup transfer | PASS (unit) | setup code round-trips links + secret fields, rejects non-https, credentialed URLs, damaged JSON and foreign codes, caps entries (7 package tests); screen shows the code, applies a pasted one and reports unmatched providers (4 component tests) |
| macOS app icon | PASS | `Contents/Resources/AppIcon.icns` (1.3 MB, derived from the 1024 px mobile artwork) and `CFBundleIconFile = AppIcon`; LaunchServices re-registered (2026-11-22) |
| macOS provider-link persistence | PASS (unit) | host flag present in the packaged app (`desktopHost true`); the desktop store writes under `mtflix.desktop.addon-secret.` while the browser PWA keeps the in-memory store (3 tests) |
| macOS home layout without a hero | PASS | Continue Watching as first row: `headerBottom 46`, `titleTop 76`, `overlapping false`; the absolute top bar used to cover the row title (2026-11-22) |
| macOS DMG self-contained build | PASS | `build.sh --dmg --version 0.7.1`: 9.6 MB app / 4.8 MB DMG with `Contents/Resources/Web`; served from `127.0.0.1:47615`; `--smoke-test` exit 0 with `Home`/`MOVIESTV` in the DOM; running window captured (2026-11-22) |
| PWA playback matrix (WebKit + Chromium) | PASS | WebKit: MKV `MEDIA_ERR_SRC_NOT_SUPPORTED`, remuxed HLS plays and seeks. Chromium: MP4 plays, remux handshake 201/200 and hls.js playback 1920×1080 with seek (2026-11-18) |
| `pnpm build:pwa` | PASS | exit 0, export verifier reports 7 required files, 2 manifest icons, 23 files scanned; web chunks `index` 352K + deferred `AppRoot` 2.0M |
| Cloudflare Pages and Workers preview builds | PASS | every PR in this run (#56–#65) built on all three checks before merge |
| `expo prebuild --platform android` + `./gradlew assembleDebug` | PASS | Temurin JDK 21, Gradle 8.14.3, debug APK 341 MB for all ABIs (2026-11-17) |
| `./gradlew assembleRelease` (arm64 only) + install on the Android 17 emulator | PASS | 76 MB debug-signed release APK, `versionCode 1`, `minSdk 24`, `targetSdk 36`; launched, rendered and navigated with no `FATAL EXCEPTION` in logcat (2026-11-17) |
| `./gradlew :app:createBundleReleaseJsAndAssets` | PASS | release JS bundle built from the new `index.js` entry, 3.2 MB, 19 asset files (2026-11-18) |
| `assembleDebug` + `npm start` + cold launch on the Android 17 emulator | PASS | Metro served `index.js`; Home rendered live Cinemeta data; `logcat` 0 `ReactNativeJS` errors after a `--clear` restart (2026-11-18) |
| M3U playlist import → Live TV listing → playback on the Android 17 emulator | PASS | local playlist with two public HLS channels over `10.0.2.2`: both listed, "Big Buck Bunny" reached the player and decoded frames. Picture was colour noise from the emulator's software decoder, so quality is not assessed (2026-11-18) |

The same three gates passed on CI run
[43625866143](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43625866143),
automatically on PR #39 (run
[43625572076](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43625572076)),
on PR #41 (run
[43629723794](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43629723794))
and on PR #43 (run
[43632379418](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43632379418)).
The counts above include the seven `VlcVideoSurface` tests added by the teardown
fix. These are code-level results only. No device, account, deploy, or update
verification was performed at audit time.

## Feature matrix

| Area | Status | Evidence | Remaining gap |
| --- | --- | --- | --- |
| Home header and hero | **Verified now (Chromium + Android 17 emulator, live Cinemeta)** | `CatalogScreen.tsx`: gradient scrim behind the header, single-line Sora wordmark, Ionicons profile/library affordances, hero with backdrop, metadata row and Play/Details/My List; poster row renders live Cinemeta data | iOS/Android device rendering of the same screen; row density and card elevation are unchanged from the pre-redesign layout |
| Design tokens and theming | **Verified now** | `packages/ui/src/theme.ts`: 20 colour roles, dark/AMOLED/light, 10-step type scale, motion, elevation, gradients; `design-tokens.test.ts` (13 tests) enforces WCAG contrast and theme completeness. `ThemeProvider` + `useThemeStyles` apply the choice at runtime and persist it per device (6 tests); all 39 screens were migrated off module-level themed sheets, verified by typecheck and 1,511 passing tests | device rendering of AMOLED/light on iOS and Android TV; a handful of module-scope constants still resolve to the default theme by design |
| Settings surface | **Partial** | `SettingsScreen.tsx`: real Ionicons rows, Inter type; `AboutScreen.tsx` reports version, build, platform and live sync/account state (6 tests); `StorageSettingsScreen.tsx` splits cache from saved data and clears only the catalog cache, never user data (12 tests); both rendered in the built PWA (Chromium) | appearance, subtitle styling and privacy controls are still missing; the rest is navigation |
| Phone/tablet navigation | **Partial — Android emulator verified** | `PhoneTabs.tsx`, tests; Android 17 emulator 2026-11-19 release APK: real Ionicons, Inter labels, gradient header, live Cinemeta hero and Continue Watching with a 2% resume bar | physical Android phone/tablet, iOS/iPadOS device QA |
| TV rail and remote focus | **Partial — web TV mode verified** | `TVRail.tsx`: real Ionicons, Sora brand, white focus ring on the active item; rendered in the built PWA with "TV interface on this browser" enabled | the browser window was phone-sized, so rail proportions at 1920×1080 are unmeasured; Android TV and tvOS runtimes still untested |
| Catalog from installed add-ons | **Partial — Android emulator verified** | `CatalogProvider.tsx`, tests; Android 17 emulator 2026-11-17: Home rendered live Cinemeta data (hero, Continue Watching with a 2% resume position, Popular row) | other providers' live data, details and playback |
| Search | Source-implemented, unverified | `SearchScreen.tsx`, tests | live provider data |
| Player — Expo surface | **Partial** | Single `⋯` menu owns audio, subtitles, source, download, next episode, speed, fit, sound, fullscreen and PiP; first page keeps only transport, scrubber and times | menu sheet not yet captured on a device |
| Player — VLC surface | **Partial** | Same menu, because HEVC/Matroska sources route here through `shouldPreferVlc`; this is the player a 2160p source actually uses | device confirmation; VLC track enumeration for multilingual files |
| Source picker | **Partial** | Resolution chips with live counts; `i` panel per source with container, codecs, audio languages, size, provider and a playability verdict | no device pass yet |
| Downloads | **Partial** | Quality picker, size probed with `HEAD`, transfer line `182 MB of 4.2 GB · 12.4 MB/s · ~5 min left` | server without `content-length` falls back to a percentage |
| Live TV player (TV) | **Partial** | Modal shows channel position and `NOW`/`NEXT` from the existing guide data alongside zap, favourite, channels and provider actions | not run on a TV runtime; remote mapping unverified |
| Live TV pause | **Partial** | `livePause.ts` offers pause only when the stream exposes a finite window; `LIVE`/`PAUSED` badge; 6 tests | no real channel has been paused on a device |
| Profile avatars | **Partial** | 12 presets, home bar + profiles picker, unknown ids fall back safely | no device pass |
| Details and My List | **Partial — Chromium, live Cinemeta** | `MediaDetailsScreen.tsx`: gradient scrim hero, Sora display title, Inter metadata, compact back pill, actions above the fold | iOS/Android device rendering; playback actions still need a stream provider |
| Series seasons and episodes | Source-implemented, unverified | `SeriesEpisodeBrowser.tsx`, tests | live provider data |
| Add-on install and validation | Source-implemented, unverified | `src/addons/`, tests | real manifests |
| Provider secrets (SecureStore / memory) | Source-implemented, unverified | secure stores, tests | device audit |
| Source/server selection and ranking | Source-implemented, unverified | `packages/playback`, tests | real streams |
| Audio and subtitle choosers | Source-implemented, unverified | `AudioChooser`, `SubtitleChooser`; track discovery fixed on 2026-11-17 (PR #53) but not re-run on a device | multi-track media, device run |
| Web playback containers (MKV/H.264) | **Partial — engine-dependent, fallback added** | `webContainerSupport.ts`, `sourceFacts.ts`, `webRemuxFallback.ts`, `services/remux`; measured in WKWebView and Chromium 152 with generated Matroska (`docs/builds/mkv-engine-matrix.md`, `docs/builds/mkv-playback-results.md`): WebKit fails MKV with `MEDIA_ERR_SRC_NOT_SUPPORTED`, Chromium plays it; both play the remuxed HLS | the remux service is not deployed (Cloudflare Workers cannot run ffmpeg), so on the PWA MKV in Safari and AC-3/E-AC-3 in Chromium need another host; HEVC-in-MKV and audible output unmeasured |
| Native playback containers (MKV) | **Partial — iOS simulator and macOS DMG verified** | `VlcVideoSurface.native.tsx`, `@lunarr/vlc-player@2.1.1`; iPhone 17 / iOS 27.2 Release run 2026-11-15; macOS wrapper `apps/desktop-mac` with libVLC via `dlopen` (PR #67): mounted-DMG MKV H.264/AAC and E-AC-3 at 1080p play, seek works, JS bridge opens the player | physical iPhone/iPad/Apple TV, HEVC-in-MKV, audible audio (track count only), Android install and playback, notarization |
| Resume and Continue Watching | Source-implemented, unverified | `WatchProgressController` | cross-device E2E |
| Watch history screen and deletion | **Source-implemented, unverified** | `WatchHistoryScreen.tsx`, `watch-history-model.ts`, `WatchProgressController.forget`; unit + component tests | no device run, no live Supabase delete (B2 blocks the account path); draft PRs #12/#13 superseded |
| Live TV aggregation and fallback | Source-implemented, unverified | `src/live-tv/`, tests | real IPTV providers |
| Live TV favorites | Source-implemented, unverified | favorites modules, tests | account sync E2E |
| M3U playlist import (URL only) | **Partial — Android emulator verified** | parser **Verified now** against the public iptv-org index on 2026-11-17 (2.6 MB, 11,502 entries, 5,000 kept by the cap, 45 ms); `M3uLiveTvAdapter`, `M3uPlaylistStore`, settings and Live TV notice; Android 17 emulator 2026-11-18 imported a two-channel playlist, listed both channels and played one after PR #66 fixed every playlist channel being rejected as a playback variant | unchosen audio/subtitle tracks, physical devices, no refresh scheduling beyond Live TV's own refresh, and the 5,000-channel cap is reported but not configurable |
| XMLTV programme guide | Source-implemented, unverified | guide modules, tests | real guide data |
| TV remote zapping | Source-implemented, unverified | `LiveTvScreen.tsx`, tests | remote device QA |
| Downloads (native) | Source-implemented, unverified | `DownloadManagerProvider.native.tsx` | device QA |
| Downloads (web) | **Partial** | `DownloadManagerProvider.web.tsx` | browser handoff only; pause/resume are no-ops |
| Profiles (local) | Source-implemented, unverified | `src/profiles/`, tests | device QA |
| Profile sync and PIN | **Not on `main`** | `ui-redesign-v2` | inside PR #34 |
| Account and Supabase sync | Source-implemented, unverified | 14 migrations, `src/auth/` | credentials + E2E |
| App language (42 locales) | **Partial — Android emulator verified for de** | `src/i18n/resources/screens.ts` (224 keys for en/sq/fr/de), `i18n/translate.ts`, every screen-surface migrated in PRs #56–#62, tests; Android 17 emulator 2026-11-17: switching to Deutsch at runtime re-rendered Settings, Live TV, the guide settings and the M3U playlist manager in German, and the choice survived a force-stop cold start while the device locale was unset | screen copy exists only in en/sq/fr/de; the other 38 locales fall back to English for app-specific strings; no iOS device run, no translator review and no RTL screen audit |
| App updates (native) | **Blocked** | `worker/index.js`, checklist 2 Oct | update gateway returns HTTP 503 |
| PWA install and service worker | Source-implemented, unverified | `public/service-worker.js`, verifier tests | live deploy + install QA |
| Cloudflare deploy | **Blocked** | workflow evidence | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Cinematic/Nuvio-style UI | **Not on `main`** | `ui-redesign-v2` | PR #34, unmerged |
| XalaFlix / FMovies sources | **Not implemented** | issue #36 | endpoints unverified, likely unavailable |

### Build artifacts (from `docs/builds/preview-artifact-checklist.md`)

| Target | Artifact verification | Device QA |
| --- | --- | --- |
| Android phone | PASS — artifact `11214427748`, run `36977852331` | PENDING |
| Android TV | PASS — artifact `11214913377` | PENDING |
| iPhone / iPad (re-signable) | PASS — artifact `11210498063` | PENDING (external signing required) |
| Apple TV (re-signable) | PASS — artifact `11210434133` | PENDING (external signing required) |
| PWA source gate | PASS — run `36977094420`, build ID `baa2ad16478174ed` | install PENDING |

All artifacts above derive from source older than current `main` and from
**2026-10-02**.

## Blocked items

| ID | Blocker | Unblocks when | Action owner |
| --- | --- | --- | --- |
| B1 | Cloudflare deploy | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as repository secrets | repo owner |
| B2 | Account and cross-device sync | `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` present at build time or in runtime config | repo owner |
| B3 | In-app update install | `GITHUB_RELEASE_TOKEN` available to the Cloudflare runtime and a package actually published (gateway returned HTTP 503 `Update package is not published yet`) | repo owner |
| B4 | PR #34 merge decision | evaluated 2026-11-14: split into lint-clean native VLC, profile-scoped sync and UI PRs, each with its own evidence | maintainer |
| B5 | Android installer handoff (PR #35) | physical-device verification of the APK handoff | maintainer |
| B6 | XalaFlix / FMovies connectors | maintained reachable endpoint plus documented or authorized integration | issue #36 |
| B7 | Release readiness | device QA matrix recorded as PASS in the checklist | QA session |
| B8 | iOS 27 launch (issue #48) | `react-native-tvos` ships no `UIWindowSceneDelegate` and Expo 56's `AppDelegate` builds a bare `UIWindow`, so any Xcode 27 build dies with `UIScene life cycle is required`. Unblocks when a scene-adopting config plugin, an RN upgrade, or an Xcode pin lands | maintainer |

## Open branches and pull requests

| Ref | Relation | State |
| --- | --- | --- |
| `ui-redesign-v2` (PR #34) | 358 ahead / 15 behind `main` | draft; merges cleanly, typecheck/tests/web export pass, `pnpm lint` fails on 3 unused bindings; iPhone and Cloudflare checks failed on 2026-10-05 |
| `audit/android-installer-handoff-20261008` (PR #35) | 1 ahead of `ui-redesign-v2` | draft, targets the redesign branch, not `main` |
| `fix/web-container-capability` | merged as `a78d38fe` | kept on origin so the Cloudflare preview alias stays live |
| PRs #1–#30 (`feature/*`, `codex/*`) | historical stacked chain | superseded; do not merge individually |
| Issue #36 | open | XalaFlix / FMovies verification request |

`main`'s one extra commit (`5d77caff`, a failed-restore fallback in
`AddonsProvider.tsx`) and the branch's own `AddonsProvider.tsx` change touch
different functions, so the 15-commit divergence merges without conflicts. See
the PR #34 evaluation below.

## PR #34 evaluation (2026-11-14)

Draft PR #34 (`ui-redesign-v2` → `main`) is the only unmerged design branch: 94
files, `+9,446/−2,782`, 358 commits ahead of `main` and 15 behind (merge base
`6ee84bee`). Re-evaluated locally against `main` at `12b7c7a4`.

### What the branch actually contains

| Concern | Evidence |
| --- | --- |
| UI redesign | `src/navigation`, `src/screens`, `packages/ui` theme, i18n key changes, 23 files under `src/playback` |
| Apple-native MKV playback | `@lunarr/vlc-player@2.1.1` (MIT, peer `react-native >= 0.82`, Fabric/turbo-module, keywords `mkv`/`x265`/`vp9`), `VlcVideoSurface.native.tsx`, `shouldPreferVlc` / `shouldRetryWithVlc` routing in `VideoSurface.native.tsx` |
| Profile-scoped sync | 3 new migrations: `profile_id` composite primary keys on `user_preferences` and `user_watch_progress`, a new `user_profiles` table with RLS and three own-row policies |
| PWA manifest colour | `verify-web-export.mjs` changes only the asserted theme/background colour `#09090b` → `#07080B`, matching the branch manifest |

### Merge and gate result — **Verified now**

`git merge-tree --write-tree origin/main origin/ui-redesign-v2` exits 0 (tree
`ae30c1c2`), and merging `origin/main` into the branch in a detached checkout
completes without conflicts (15 files, `+1,195/−104`). `main`'s `5d77caff` and
the branch's `AddonsProvider.tsx` edit touch different functions, so the old
divergence concern is resolved textually.

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 172 suites / 1,872 tests (app 139 / 1,375; shared 33 / 497) |
| web `tsc -p tsconfig.playback.json` | PASS |
| `expo export --platform web` + `verify:web` | PASS — 7 required files, 2 icons, 23 files scanned |
| `pnpm lint` | **FAIL** — unused bindings: `VlcVideoSurface.native.tsx:137` (`t`), `playback-overlay.test.tsx:33` (`mockVlcRef`), `profiles-provider-avatar.test.tsx:4` (`act`) |
| `pnpm build:pwa` | **FAIL** — stops at the lint step above; export and verify pass when run manually |

So the branch is not broken by `main`'s newer commits; it is blocked by three
lint errors it introduced itself.

### Existing CI history on the branch (2026-10-05)

`validate`, `PWA package`, `Android phone`, `Android android-tv` and `Resolve
native build number` passed. `iPhone iPad` failed after 5 s with an empty step
list (job `111892075934`, 17:24:35 → 17:24:40) — a runner/infrastructure
failure, not a code failure, and its logs have expired. `Cloudflare Pages` and
`Workers Builds` failed on `b9e4229`: the Pages build command lives in the
Cloudflare dashboard, not in this repository, so the cause is **inferred**; the
local lint failure is the leading explanation.

### Recommendation — split, do not merge as one unit

1. **`fix(playback)`: native VLC surface.** The only change that closes the
   Apple-native MKV gap and the direct answer to the Safari/iOS failure. Ported
   onto `main` on 2026-11-14 behind the existing surface contract (see the
   session log); it still needs a device run on iPhone/iPad/Apple TV and a
   dependency review of binary size and the bundled VLC licences.
2. **`feat(profiles)`: profile-scoped sync.** Schema first: replay the three
   migrations on a shadow database, prove the composite-primary-key swap on
   existing rows, and test RLS with two accounts and two profiles.
3. **`feat(ui)`: redesign.** Largest surface and no dependency on 1–2; it can
   land last, or be dropped without affecting playback parity.

Evidence class for all three: **Source-implemented, unverified**. Only the
merge, gates and export above are **Verified now**, and they were produced on a
local merge of `main` into the branch, not on a device.

## Known bugs and risks

- CI now verifies pull requests that touch runtime code (`apps/`, `packages/`,
  `worker/`, `functions/`, `supabase/`, `scripts/`, manifests, `ci.yml`) and
  still skips docs-only PRs to protect the metered Actions minutes. Device
  builds remain manual: the Android, iOS and tvOS preview workflows and the
  release workflow are `workflow_dispatch`/`workflow_call`, so no PR proves a
  device artifact.
- The Cloudflare Pages/Workers build command is configured in the dashboard, not
  in this repository, so a failing Pages check cannot be reproduced from the
  tree with certainty (PR #34's Pages failure is the current example).
- `CinemetaCatalogGateway` and `FallbackCatalogGateway` are unreferenced outside
  tests (dead code); `CatalogProvider` wires `Remote`, `Demo` and `Stremio`
  gateways only.
- The app now imports every workspace package by name and declares all nine of
  them (PR #64); `workspace-dependency-contract.test.mjs` fails on a relative
  escape out of the app or an imported `@moviestv/*` package that is not a
  dependency. The dead catalog gateways below are still unreferenced.
- Android cleartext traffic and the Apple ATS media exception are intentional
  IPTV compatibility settings and are security-relevant.
- No versioning scheme: the app reports `0.1.0` and has a single
  `preview-latest` tag.
- `README.md` previously described the redesign and stale artifact status; it
  was corrected on 2026-11-13 to match `main`.
- Screen copy is migrated to one `screens` pack, but only en/sq/fr/de are
  translated: the other 38 supported locales show English for these strings.
- Web downloads cannot pause or resume; native downloads can.
- Web source ranking no longer hard-penalizes MKV: it passes
  `webMatroskaSupported` from a cached `canPlayType` probe, so a
  preferred-language MKV can outrank an unwanted-language MP4 in Chromium while
  WebKit keeps the conservative `-8_000_000` penalty. MP4 still wins over MKV at
  equal language. The probe was verified on macOS Safari 27.2 and Chromium 152
  with genuine Matroska samples (see `docs/builds/preview-artifact-checklist.md`,
  14 November engine probe): WebKit returns `""` and the file fails with
  `MediaError` 4, Chromium decodes H.264 Matroska progressively, including a DTS
  audio track and HEVC video in MP4 without a fatal error. iOS Safari, HEVC video
  inside Matroska and audio output remain unmeasured, and the probe is
  container-level, so an unsupported codec can still pass it and fail during
  decode.
- Web downloads still refuse MKV/AVI handoff (`downloadSource.web.ts`), so a
  Chromium user cannot download an MKV from the web app even though the player
  can now play it. That is a separate product decision.
- Apple-native MKV no longer depends on AVPlayer alone. The native surface routes
  Matroska, WebM, AVI, FLV, WMV and RealMedia sources, plus TrueHD/DTS audio, to
  `@lunarr/vlc-player` (MobileVLCKit/TVVLCKit 3.7.3, libvlc 3.7.5), and retries
  on VLC once when AVPlayer reports a format failure. **Verified now** in an
  iPhone 17 simulator (iOS 27.2, Release, Xcode 27.2): genuine Matroska plays
  through the app's surface at 13.0/13.0s (H.264/AAC) and 14.0/52.0s
  (H.264/E-AC3), with an MP4 control at 10.0/10.0s. Physical devices, HEVC inside
  Matroska, audible output and the binary-size increase remain unmeasured.
- The surface releases the libvlc instance **on unmount**, not when React
  detaches the ref. `@lunarr/vlc-player` declares its imperative handle without a
  dependency array, so React re-applies the ref on every render (`ref(null)`, then
  the new handle). The earlier teardown fix (`b36dea5b`) released on that
  transient null, which destroyed the player on the first re-render and is why
  native playback produced no video and no progress events. Instrumented counters
  measured 31 attach / 30 detach / 30 release cycles in 20 s. Fixed in `592e8d99`
  with three regression tests.
- Android builds again. `plugins/withAndroidGradleWrapper.js` pins the
  generated wrapper to Gradle 8.14.3 because React Native 0.85's included Gradle
  build applies `foojay-resolver-convention:0.5.0`, which reads
  `JvmVendorSpec.IBM_SEMERU`; Gradle 9 removed that constant, so configuration
  failed before compilation (the JDK was not the cause). On 2026-11-17,
  `expo prebuild --platform android` followed by `./gradlew assembleDebug` with
  Temurin JDK 21 produced `app-debug.apk` (341 MB, all ABIs). The debug build
  then loaded no JavaScript for a monorepo reason, fixed in PR #65:
  `@expo/config` roots Metro at the workspace root, so it served
  `/apps/mobile-tv/index.bundle` while a React Native debug build requests
  `/index.bundle`, and `main` pointed at `expo/AppEntry.js` so no `index` module
  existed either. `index.js` plus `EXPO_NO_METRO_WORKSPACE_ROOT=1` on the
  `start` and `export:web` scripts fixes both. A second render error
  (`Expected HMRClient.setup() call at startup`) came from the
  `React.lazy(() => import('./src/app/AppRoot'))` split bundle in development;
  native now imports the provider stack synchronously while web keeps the lazy
  chunk. Android **playback** is still unverified because the emulator has no
  stream provider or MKV source installed.
- Android also needs `plugins/withAndroidVlcJniLibs.js`: `libvlc-all` and
  `react-android` both ship `libc++_shared.so`, so the native-library merge fails
  without a `pickFirsts` rule.
- **The PWA MKV fallback has no deployable host yet.** `services/remux` needs a
  container runtime with ffmpeg; Cloudflare Workers cannot run it and Cloudflare
  Stream is paid. Until that service is deployed and
  `EXPO_PUBLIC_REMUX_URL` is set in the Pages build, MKV in Safari and
  AC-3/E-AC-3 audio in Chromium remain unplayable on the PWA, now with an
  actionable error instead of a dead end. The macOS DMG needs no service.
- **libVLC 3 forwards only User-Agent and Referer.** A provider that requires a
  different header still fails in the DMG while the PWA can forward any
  allow-listed header to the remux service.
- **Fast Refresh is not established on Android.** The native debug bundle is
  requested without `hot=true`, so Metro sent no HMR delta for a file edit
  during the verification run; the app stayed rendered and logged no error. The
  working dev loop is edit → reload → relaunch, not hot reload.
- The Android **release** path was not rebuilt end to end after the entry
  change; only `:app:createBundleReleaseJsAndAssets` was re-run (3.2 MB bundle).
- `apps/mobile-tv/src/app` makes Expo log "Using src/app as the root directory
  for Expo Router" even though `expo-router` is not a dependency. It is
  misleading rather than harmful today.
- iOS `pod install` now runs on this workstation (CocoaPods 1.17.0): 92 pods,
  `react-native-vlc-player` autolinked, `VLCPlayerSpec` codegen executed, and the
  Release build for the simulator succeeds. Xcode 27 rejects pod targets below
  iOS 15, so the generated `ios/Podfile` post-install pins pods to 16.4.
- iOS 27 cannot launch this app without scene adoption — see blocker B8 and
  issue #48.

## Decisions log

| Date | Decision | Reason | Reference |
| --- | --- | --- | --- |
| 2026-10-02 | Android previews keep a pinned signer | in-place upgrade requires a stable signature | `preview-artifact-checklist.md` |
| 2026-10-02 | Web downloads are handoff-only | a browser cannot resume arbitrary remote streams | `downloadSource.web.ts` |
| 2026-10-04 | Redesign ships as a single PR from `ui-redesign-v2` | large UI surface; avoid partial merges | PR #34 |
| 2026-10-09 | No website connectors until verified | legal and technical uncertainty | issue #36 |
| 2026-11-13 | Stabilize `main` before considering a PR #34 merge | release path must not depend on unmerged draft work | this document |
| 2026-11-13 | Web container support is probed per engine, not hardcoded | Chromium plays MKV/H.264 (`canPlayType` → `maybe`, verified), WebKit cannot demux Matroska | `webContainerSupport.ts` |
| 2026-11-13 | Apple-native MKV parity requires an FFmpeg-based player | `expo-video` uses AVPlayer on iOS/tvOS, which has no Matroska demuxer; Nuvio uses MPVKit | this document |
| 2026-11-13 | No server-side remux or transcode for compatibility | it adds paid infrastructure and moves playback off-device; client engines must carry the gap | this document |
| 2026-11-14 | Source ranking follows the engine's Matroska capability | the old blanket MKV penalty buried the user's preferred audio language on Chromium, which can play the file | `ranking.ts` |
| 2026-11-17 | Android runtime evidence is taken from a release APK until the Expo dev-server entry is fixed (superseded 2026-11-18: the entry is fixed, PR #65) | the debug APK loaded no JavaScript: `npx expo start` answered `/index.bundle` with `UnableToResolveError` for `./index` resolved against the repository root. A release APK embeds the bundle, so it proves the native shell, navigation and resource loading without depending on Metro | this document |
| 2026-11-17 | The app language is an in-app preference, independent of the device locale | with `persist.sys.locale` empty and `system_locales` unset, switching to Deutsch in the app re-rendered every migrated screen and survived a force-stop cold start, which is what the product goal requires | `PreferencesProvider`, `I18nProvider` |
| 2026-11-18 | The app declares an explicit `index.js` entry and pins Metro's server root to the app | Expo roots Metro at the workspace root in a pnpm monorepo, so `/index.bundle` 404'd against the repository root while the native debug build requests exactly that URL. A `metro.config.js` override of `unstable_serverRoot` fixed `start` but broke `expo export`, which resolves the entry against the workspace root; the env var keeps both consistent | `index.js`, `package.json` scripts |
| 2026-11-18 | Native loads the provider stack synchronously; web keeps the lazy chunk | `React.lazy(() => import(...))` makes a Metro split bundle in development, and the split bundle's own HMR client instance throws `Expected HMRClient.setup() call at startup`, which the boot boundary surfaces as a render error. Release inlines the import anyway, so only the browser gains from splitting | `src/app/loadAppRoot.native.ts`, `loadAppRoot.web.ts` |
| 2026-11-18 | A playlist provider skips the playback manifest check | playlist descriptors carry `manifestUrl: ''` because each M3U entry is its own stream, so the add-on manifest rule silently dropped every playlist variant and Live TV could list a user's channels but never play one. The channel URL is still re-validated on resolve, and add-on providers still need a valid manifest | `LiveTvPlaybackController.ts` |
| 2026-11-18 | The macOS DMG plays MKV with libVLC loaded through `dlopen`, not a vendored framework | the wrapper is a WKWebView, so it inherits WebKit's missing Matroska demuxer; VLC is a documented prerequisite and `MTFLIX_VLC_LIB` overrides the path, which keeps the repository free of a ~100 MB binary. The build adds rpaths because `libvlc.dylib` ships `@rpath/libvlccore.dylib` without its own `LC_RPATH` | `apps/desktop-mac/` |
| 2026-11-18 | The PWA fallback remuxes to HLS with `-c:v copy` rather than transcoding | the video bitstream is already H.264, so copying it keeps quality and starts in seconds; audio is copied when AAC/MP3/Opus/Vorbis/FLAC and transcoded only when the engine cannot decode it | `services/remux/server.mjs` |
| 2026-11-18 | Remux sessions take the source URL in a POST body, never a query string | signed provider URLs and provider headers must not reach access logs, `Referer` headers or browser history; an opaque session id is the only thing that appears in later URLs | `webRemuxFallback.ts`, `services/remux/server.mjs` |
| 2026-11-18 | Guest-first accounts: the app is usable without signing in, and an account is an opt-in upgrade | anonymous Supabase users can inherit their data through manual linking, which is why that setting is on; forcing registration before playback is the main reason people abandon a streaming app | `docs/builds/supabase-project.md` |
| 2026-11-18 | iOS scene adoption and pod deployment targets are config plugins, never edits to `ios/` | `ios/` is gitignored and regenerated, so a hand patch is lost on the next prebuild and the build silently returns to an app that installs and refuses to launch | `plugins/withIosSceneLifecycle.js`, `plugins/withIosPodsDeploymentTarget.js` |
| 2026-11-18 | The accent moves from Netflix's `#e50914` to `#6C4BEF` | the brighter violet measured 4.35:1 against white, just under AA for body text; this value measures 5.4:1 and stops the app reading as a clone | `packages/ui/src/theme.ts` |
| 2026-11-19 | Two player surfaces are treated as one product | `shouldPreferVlc` sends HEVC and Matroska to `VlcVideoSurface`, so a change made only in `ExpoVideoSurface` is invisible to anyone watching a 4K source. Every player change must be applied to both, and verification must include an HEVC source | `VideoSurface.native.tsx` |
| 2026-11-19 | Player menu rows are always rendered, with an honest empty state | hiding the Audio row when fewer than two tracks were detected made the feature look missing rather than empty; a chooser that says "this source has a single audio track" is better than no control | `PlaybackOverlay.tsx`, choosers |
| 2026-11-19 | Live TV pause is offered only when `duration` is finite | a plain live HLS stream has no window behind the live edge, so pause either does nothing or jumps back to live; a control that cannot work must not be shown | `live-tv/livePause.ts` |
| 2026-11-19 | Profile avatars are a preset set, not uploads | a photo needs storage, moderation and a sync story; a coloured glyph tiles reads at TV distance and needs no backend | `profiles/avatars.ts` |
| 2026-11-19 | Each version publishes its own release, with the rolling tag kept for the updater | the rolling tag made iOS look 15 minutes older than Android inside the same run, which caused repeated "is this the new build?" confusion | `release-preview.yml` |
| 2026-11-14 | Pull-request CI is scoped by path, not blanket | verify changes that can alter runtime behaviour without spending metered Actions minutes on docs-only PRs | `.github/workflows/ci.yml` |
| 2026-11-14 | Split PR #34 instead of merging `ui-redesign-v2` as one unit | a 94-file branch mixing UI, a new native player and schema changes cannot be verified or reverted as one unit; the VLC surface is the only part that closes the Apple-native MKV gap | this document |
| 2026-11-14 | Native MKV playback uses libvlc behind the existing `VideoSurface` contract | keeps the overlay, watch progress, downloads and ranking untouched; only the native engine choice changes | `VideoSurface.native.tsx` |
| 2026-11-14 | Native container routing is explicit per source, with one AVPlayer-error retry | forcing VLC for every source would lose AVPlayer's HLS/DRM behaviour, while AVPlayer's generic item failure needs a recovery path | `shouldPreferVlc`, `shouldRetryWithVlc` |
| 2026-11-14 | Keep the `canPlayType` Matroska gate instead of attaching and waiting for the error | measured in Safari 27.2: WebKit reports `""` and fails genuine Matroska with `MediaError` 4, so attaching only costs a watchdog delay and a worse message; Chromium decodes it, which the probe reports correctly | `docs/builds/tools/web-container-probe.html` |
| 2026-11-15 | Release the libvlc player on unmount, not on ref detach | the library re-applies its imperative handle on every render, so detach-time release destroyed the player before `onLoad`; unmount is the only real teardown | `VlcVideoSurface.native.tsx` |
| 2026-11-15 | Track the iOS 27 UIScene launch failure separately (issue #48) | it kills every Xcode 27 build before JS starts and is unrelated to playback; needs a config plugin or a toolchain pin | issue #48 |
| 2026-11-15 | Model an M3U playlist as a Live TV provider with `kind: 'playlist'` and a runtime-only `directStreamUrl` | an M3U entry *is* the stream, so there is no add-on handler to call; a single descriptor type keeps the channel service and playback controller on one adapter (`RoutedLiveTvAdapter` dispatches) | `packages/live-tv/src/m3u-provider.ts` |
| 2026-11-15 | Allow cleartext HTTP for playlist fetches only (`fetchBoundedText(..., { allowHttp })`) | most IPTV providers publish playlists over HTTP and the app already ships an intentional cleartext IPTV media exception; the guide path stays HTTPS-only and authority credentials are still rejected | `HttpTextLoader.ts` |
| 2026-11-15 | Playlist records are secrets, never synchronized | the URL path usually carries the provider's credentials; records go to SecureStore (identity-scoped) on native and to session memory on web, never to preferences, sync payloads, logs or the service worker | `M3uPlaylistStore.ts` |
| 2026-11-15 | A watch-history delete cancels the queued upload and waits for the in-flight one | deleting first and letting a pending `upsert` finish would re-create the remote row, so the row would reappear on the next restore | `WatchProgressController.removeMatching` |
| 2026-11-15 | A failed remote delete keeps the local delete and reports `offline` | local storage is authoritative for the user's intent; re-adding the row locally would be worse than a visible sync warning | `WatchProgressController` |
| 2026-11-15 | Watch history is one row per media, bounded to 500, newest first | it is a reading surface, not an archive; completed and barely-started records stay (unlike Continue Watching) | `watch-history-model.ts` |
| 2026-11-17 | Native track lists are chosen from whichever source is non-empty | AVPlayer resolves media selection groups after `sourceLoad`, so the event can carry `[]` while the player property already has tracks (and the reverse) | `pickTrackList` in `ExpoVideoSurface.native.tsx` |
| 2026-11-17 | The playlist cap is reported, not raised | 11,502 entries parse in 45 ms, so the 5,000 limit protects the channel cache and the list on a low-end device, not the parser | `m3u.ts`, `LiveTvChannelService.ts` |
| 2026-11-17 | The Gradle wrapper is pinned to 8.14.3 through a config plugin | React Native 0.85's included Gradle build applies `foojay-resolver-convention:0.5.0`, which reads `JvmVendorSpec.IBM_SEMERU`; Gradle 9 removed that constant, so configuration failed before compilation. Installing JDK 21 alone did not fix it | `plugins/withAndroidGradleWrapper.js` |
| 2026-11-17 | Screen copy lives in one `screens` resource pack, and `t()` interpolates `{name}` tokens | every screen carried its own en/fr/de/sq table, and any sentence with a title or number stayed hardcoded; a single pack makes screens testable with real copy instead of key echoes | `i18n/resources/screens.ts`, `i18n/translate.ts` |
| 2026-11-17 | Settings copy uses the `settingsScreen.*` prefix | `settings.*` already exists in the base resource and the screens pack is applied last, so reusing the prefix would overwrite base translations | `resources/screens.ts` |
| 2026-11-13 | Adopt `AGENTS.md` + `docs/PROJECT_STATUS.md` as shared agent context | one consistent brief for OpenCode, ChatGPT and future agents | this commit |
| 2026-11-21 | `SafeAreaProvider` is mounted once, at the root of `AppRoot` | every screen read `SafeAreaInsetsContext`, but nothing ever provided it, so every inset in the app resolved to zero; the player header therefore rendered under the Dynamic Island and no screen could clear a hardware cutout | `src/app/AppRoot.tsx` |
| 2026-11-21 | The video layer is padded by the OS insets, not drawn edge-to-edge | a notch, Dynamic Island or punch-hole physically covers part of the display; insetting the *picture* (while the chrome insets itself) guarantees nothing important is hidden, and on a 16:9-into-19.5:9 film the padding lands in the side letterbox, so nothing shrinks. Malformed insets are clamped rather than trusted | `src/playback/useSafeVideoFrame.ts` |
| 2026-11-21 | The "vertical black pill" on the player's left edge is the Dynamic Island, not an artifact | the shape sits exactly on the 62 pt landscape side inset, appears only on notched iPhones held sideways and is drawn by the system over the app. No code change is needed; the safe-area frame already keeps the picture clear of it | simulator screenshots at 2622x1206 |
| 2026-11-21 | The player chrome is one shared component, not per-engine markup | the VLC and AVPlayer surfaces drifted three times because a fix landed in one of them. `PlayerChrome` owns the title block, scrubber, icon row and lock, so parity is structural instead of a checklist item | `playback/PlayerChrome.tsx` |
| 2026-11-21 | The source picker groups by quality but orders groups by rank | grouping by a fixed 4K→480p order would overrule the resolver, which already ranked every source; the first group must hold the best source, not the largest number | `playback/sourceGroups.ts` |
| 2026-11-21 | Navigation is one icon back control plus an edge swipe | the text "‹ Back" button ate a third of every header; a native-stack edge gesture is what users already do, so it was reproduced with a PanResponder limited to the outer 32 pt and completed past 90 pt to avoid fighting carousels | `components/IconBackButton.tsx`, `components/useSwipeBack.ts` |
| 2026-11-21 | The floating tab bar includes the bottom safe inset | at `bottom: 8` its icons sat under the home indicator, so the last row was partly untappable | `navigation/PhoneTabs.tsx` |
| 2026-11-21 | A provider synced without its private link is labelled, not silently dead | the manifest link usually carries the key, so it is never synchronized; the second device received a listed-but-unusable provider and every screen implied nothing had been set up. The gate stays, the UI now says why and offers "Finish setup" pinned to that provider id | `ProvidersScreen.tsx`, `CatalogScreen.tsx` |
| 2026-11-21 | The orientation lock is re-applied after mount | iOS applies an orientation lock to the active view controller, which is not always ready on the tick the player mounts; one `lockAsync` call silently did nothing and the film stayed portrait until the phone was rotated by hand | `src/playback/usePlaybackOrientation.ts` |
| 2026-11-22 | The macOS app carries its own web export instead of loading the deployed PWA | the only preview URL answered 404, so a DMG built the old way opened a blank window and needed a deploy before it could run. `build.sh` copies `mobile-tv/dist` into `Contents/Resources/Web`, and the app serves it from `127.0.0.1:47615` (five candidate ports); only `/api/*` still reaches `main.moviestv-flix.pages.dev` | `apps/desktop-mac/build.sh`, `LocalWebServer` |
| 2026-11-22 | The bundled build is served over loopback HTTP, not a custom URL scheme | a `WKURLSchemeHandler` looked smaller, but under that opaque origin WebKit never settled expo-font (6 faces requested, `rootHtml` stuck at the 165-byte loading placeholder) and `messageHandlers` stayed invisible; the identical export renders over `http://127.0.0.1`. The scheme handler was deleted, not kept as a fallback | `apps/desktop-mac/main.swift` |
| 2026-11-22 | The macOS smoke test puts the window on screen before asserting | WebKit throttles timers and animation frames in a hidden window, so expo-font's observer never fired and a headless `--smoke-test` reported an empty DOM for a page that renders instantly when visible. The test keeps its 15 s settle window and still exits non-zero when the Home screen is absent | `apps/desktop-mac/main.swift` |
| 2026-11-22 | The font gate opens after a 2 s grace period even if the font observer never settles | a blank first frame is worse than the system font. Under WKWebView the `@font-face` files arrive and `document.fonts.status` reads "loaded", yet expo-font's observer stays pending until its own 12 s timeout — measured as the macOS app's 12,356 ms first paint. The gate now opens at 2 s; late faces still apply. | `useFontGate.ts`, `AppRoot.tsx` |
| 2026-11-22 | Home content without a hero starts below the header | the home top bar is an absolute gradient so artwork can run underneath; with no catalog data the first row was Continue Watching, whose title rendered behind the brand. The first sub-row now takes the same clearance the empty/error cards already used. | `CatalogScreen.tsx` |
| 2026-11-22 | The packaged desktop app persists provider links locally; the browser PWA still does not | a configured add-on URL can carry a debrid key, so it is still never synchronized. But the macOS bundle is a single-user app served from loopback with its own container, not a page that can be reloaded or replayed, and without persistence a provider had to be re-entered on every launch. `apps/desktop-mac` injects `window.__MOVIESTV_DESKTOP__`; the store keys are prefixed and never enter a sync payload | `DesktopAddonSecretStore.ts`, `addonSecretRuntime.web.ts` |
| 2026-11-23 | The desktop updater reads GitHub releases and installs the DMG natively | the Mac app is not a PWA: reloading a service worker can never install a new bundle. A GitHub release check plus a native download/replace/relaunch is the smallest path that needs no Sparkle dependency and no signing infrastructure. The check is unavailable, not silently "up to date", when releases are not readable — which is the current state with a private repository | `desktopUpdate.ts`, `UpdateInstaller`, `AppUpdateScreen.tsx` |
| 2026-11-22 | Providers move between devices as a copyable setup code, never through the server | the link can embed a debrid key, and the product also avoids any debrid integration of its own so a store review is not blocked by one. A code the user copies by hand transfers the same data without a row, a log or a dependency; a passphrase-encrypted sync remains possible later but needs crypto code and a recovery story | `packages/addons/src/setupTransfer.ts`, `ProviderTransferScreen.tsx` |
| 2026-11-22 | A configured provider link is shown in its details screen for manual transfer | sync must keep withholding the link, but regenerating it on the provider's website is the only alternative. Selectable text lets the user copy it to another device once, where it now persists | `ProviderConfigScreen.tsx` |
| 2026-11-22 | The device build is signed under the profile's App ID rather than skipping installation | the only Ad Hoc profile available names `app.grape2354.valley804`, and iOS refuses a bundle id the profile does not name. Retargeting installs a working 0.7.1 for verification, at the cost of a second icon and a fresh container; the public IPA stays unsigned and keeps the real bundle id, so nobody else inherits the placeholder | `scripts/sign-adhoc.sh` (`--app-id`) |

## Next tasks

1. **A profile for `com.jugentorba.moviestvflix`.** 0.7.1 is verified on the
   device, but under the placeholder App ID the only available profile names. A
   profile for the real bundle id replaces 0.5.5 in place, keeps its data and
   removes the second icon; it needs the team account that owns the signing certificate.
2. **Public update channel, or accept manual updates.** The built-in updater
   needs a release endpoint readable without a GitHub session. Either make the
   repository/releases public or publish the DMG plus a small manifest on public
   storage; otherwise the check keeps reporting 404 and updates stay manual.
3. **Automatic provider transfer (optional).** Sign-in sync brings metadata and
   progress, and a setup code now carries the links in one paste. Fully automatic
   transfer needs passphrase-encrypted sync: a crypto dependency, a recovery
   story, and a store-review note. Explicitly deferred — no debrid integration
   ships.
3. **macOS playback with a real source.** The app signs in and lists providers;
   playing an actual stream through the libVLC bridge is still
   Source-implemented, unverified on this build.
4. **Live TV on a physical TV.** The channel box, `CH▲/CH▼` zapping, `OK` drawer
   and `Back` overlay close are simulator-verified only.
5. **PWA deploy.** `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are still
   missing, so the preview URL is a 404 and the site is not updated from `main`.
6. **First-frame latency.** Measure source-resolved → first frame on the phone,
   then fix the largest gap; startup timings exist, playback timings do not.
7. **Trakt/Simkl/MDBList and native debrid.** Blocked on OAuth apps and paid
   API keys; needs a product decision before code.
8. **Notarized DMG.** Blocked on a `Developer ID Application` certificate; the
   current DMG is ad-hoc signed and needs right-click → Open.

## Session log

### 2026-11-23 (0.7.3 and the desktop updater)
- Settings → App updates shows the host's own version and checks GitHub releases;
  "Update now" hands the DMG to a native installer that replaces the app and
  relaunches. 6 new tests; 180 app suites / 1,679 tests.
- Verified: iOS build 0.7.3/20261160, APK versionName 0.7.3, DMG installed with
  icon. iPhone install succeeded; `devicectl launch` reported "Locked" because
  the device was locked, not a crash.
- **Blocked:** the repository is private, so the anonymous release check 404s. The
  updater fails loudly instead of pretending to be current; making releases
  public (or hosting the DMG elsewhere) is a product decision.

### 2026-11-22 (macOS app icon)
- The DMG carried no icon: `CFBundleIconFile` was missing and Resources held only
  `Web`. `build.sh` now generates `AppIcon.icns` from `mobile-tv/assets/icon.png`.
- The v0.7.2 DMG asset was replaced with the icon-bearing build.

### 2026-11-22 (0.7.2, all three platforms rebuilt)
- v0.7.2 rebuilt from `main`: iOS IPA (unsigned), Android release APK
  (versionCode 20261159) and the macOS DMG; release carries all three.
- iPhone 0.7.2 signed with the Ad Hoc profile and installed over `devicectl`;
  it launches and runs under `app.grape2354.valley804`.
- Prebuild regenerates `android/`, so `android/local.properties` (`sdk.dir`) must
  be recreated before a Gradle build; iOS `Info.plist` keeps its old version and
  is patched with PlistBuddy.

### 2026-11-22 (provider setup code)
- Providers move between devices as one copyable code (links + secret fields);
  nothing reaches the server and the app still has no debrid integration.
- Validation on both ends, 11 new tests, and an unmatched provider is reported
  rather than dropped.

### 2026-11-22 (provider links on desktop)
- Provider metadata synced but the configured link did not, so the Mac listed
  three providers as "Setup required" and forgot any pasted link on restart.
- The desktop bundle now persists add-on links locally; the PWA stays memory-only.
  Provider details shows the link as selectable text for a one-time transfer.

### 2026-11-22 (macOS install, font gate, header overlap)
- Rebuilt the web export (it predated two source files), installed 0.7.1 to
  `/Applications`; it signs in and lists the phone's synced providers.
- First paint 12,356 → 2,599 ms: expo-font's observer never settles in WKWebView,
  so the gate now opens after 2 s; regression test in `use-font-gate.test.ts`.
- Home without a hero no longer hides its first row under the top bar.

### 2026-11-22 (0.7.1 on the iPhone)
- `sign-adhoc.sh` signs an IPA with the keychain's Apple Distribution identity
  and a profile's own entitlements; installed 0.7.1 on the paired iPhone and it
  launched under `app.grape2354.valley804` (the App ID the profile names).
- The GitHub release now lists iOS IPA, Android APK and macOS DMG together, with
  the macOS asset named `MoviesTv-Flix-0.7.1-macos.dmg`.

### 2026-11-22 (macOS DMG in the release)
- The DMG now bundles the web export and serves it over loopback HTTP; the
  custom-scheme attempt stalled on WebKit fonts and was deleted.
- `--smoke-test` shows the window first (hidden windows throttle timers), exits 0
  with `Home`/`MOVIESTV` in the DOM, and the running window was captured.
- `MoviesTv-Flix.dmg` is attached to v0.7.1 next to the IPA and APK.

### 2026-11-22 (genre browse, cleaner home)
- Genre sections are browse targets, not home rows: Movies/Series get a genre
  strip and Home stops duplicating "Popular · Action" per genre.

### 2026-11-22 (crash boundary, watched badge)
- A root error boundary replaces white screens with a retry card (render and
  lifecycle errors only).
- Finished titles show a check on the poster, sharing Continue Watching's 95%
  line.

### 2026-11-22 (continue watching as a home row)
- The Continue Watching row joins the home layout pass, so it can be moved or
  hidden from Settings → Home screen like a provider row.

### 2026-11-22 (continue watching)
- A Continue Watching row synthesised from local progress, with a bar on each
  poster; episodes collapse into their series. Not yet reorderable from the home
  layout manager.

### 2026-11-22 (player settings)
- Skip-intro on/off (off cancels the IntroDB request) and a 5/10/15 s up-next
  countdown, both device-local and live-updating while the player is open.

### 2026-11-22 (addon quickstart)
- Providers offers one-press installs for Cinemeta and OpenSubtitles v3, both
  manifests fetched and checked first; no scraper add-ons by design.

### 2026-11-22 (home row management)
- Settings → Home screen: per-profile row order and visibility, with new rows
  appended in provider order and removed rows forgotten.

### 2026-11-22 (captions + up-next)
- Subtitle position (Low/Normal/High) and bold, with clamped offsets.
- Next episode starts after a cancellable 10-second countdown instead of
  instantly; tests assert the countdown before the play call.

### 2026-11-22 (skip intro via IntroDB)
- IntroDB skip segments (intro/recap/outro/credits) on both engines, with a
  bounded request and a validated parser. Endpoint verified on introdb.app
  before implementation. Not yet seen on a real episode.

### 2026-11-22 (performance measured)
- Chrome CPU profile of the web build while opening Settings and Appearance:
  **15.2 s of 16.2 idle** — page opens are not CPU-bound. The fix was to start
  the details fetch on touch-down, not to re-render less.
- Competitive benchmark (Nuvio docs/site) recorded for the next tier: home-row
  management, skip intro/recap/outro via IntroDB, next-episode auto-play,
  subtitle offset/bold/forced/secondary, addon directory + TV QR install, Trakt/
  Simkl/MDBList, native debrid.

### 2026-11-22 (settings shell + colour wheel)
- One `SettingsPage` shell (back pill, eyebrow, oversized title, cards) replaces
  four header patterns; the accent is now a wheel with WCAG-derived text colour.
- `MediaCard`/`MediaRow` memoised with stable handlers — fewer re-renders, but
  no millisecond measurement yet.

### 2026-11-21 (tvOS boots)
- The TV target builds and runs on the Apple TV 4K simulator. Pods needed
  `TVOS_DEPLOYMENT_TARGET` raised to 16.4, and orientation/brightness had to be
  loaded lazily because their pods do not exist on tvOS.

### 2026-11-21 (web build repaired)
- `build:pwa` failed on its first run this session. The web player had never
  received the subtitle/audio/source/download/next/lock controls, and the asset
  guard still demanded the 512 placeholder icon. Both fixed; the PWA renders in
  Chromium with no console errors.

### 2026-11-21 (subtitle fixes)
- A style chosen in Settings now applies to the **next film**, not the next
  launch: the overlay is long-lived, so the read is keyed on the source id.
- The Appearance preview sits on grey so Soft and Off are distinguishable —
  found by looking at a simulator screenshot, not by a test.

### 2026-11-21 (subtitle appearance)
- Caption size (Small/Medium/Large) and background (Off/Soft/Solid) are now
  device-local settings with a live preview; line height scales with the size so
  accents are never clipped.

### 2026-11-21 (accent colours)
- Six device-local accents, each verified at **≥ 4.5:1** against white by a test.
- 0.5.0 shipped the brightness (left) and volume (right) gesture sliders with
  `expo-brightness`; both are linked and present in the binaries.

### 2026-11-21 (brightness and volume gestures)
- Left half drags brightness (app-scoped, restored on close), right half drags
  playback volume; the arithmetic is tested, the gesture itself is not.
- New dependency `expo-brightness`, prebuilt and linked on both platforms.

### 2026-11-21 (TV channel box)
- The TV Live TV player leads with a channel box: number, name, country,
  now/next and one remote hint line. Verified in tests only — no TV runtime has
  been launched, so this stays **source-implemented, unverified**.

### 2026-11-21 (startup measured, catalog snapshot)
- Startup measured instead of guessed: React costs ~220 ms; the rest is native
  bundle load plus the providers answering over the network on every launch.
- The catalog now paints the previous rows from an identity-scoped snapshot
  before the network answers.

### 2026-11-21 (card quick actions)
- Long-press a poster for **My List** and **Details** without a details round
  trip; identity follows `sameMyListMedia`, and the 200-item cap drops the
  oldest entry instead of failing.

### 2026-11-21 (hold for 2×)
- Hold the picture for 2× on both engines, through one `useHoldSpeed` hook that
  restores the rate the user had chosen.
- The gesture itself is unverified: neither the harness nor `simctl` can inject a
  long press, so the 350 ms threshold needs a real finger.

### 2026-11-21 (downloads + swipe everywhere)
- Download line reports written of total, rate and **bytes left** (GB for a
  film), with no invented total when a server omits `Content-Length`.
- Edge-swipe back now covers account, add-provider, provider-config, update
  and install too.

### 2026-11-21 (source picker + player chrome)
- Source picker rebuilt: poster hero, resume pill, provider chips, quality
  groups with sizes; latency fix for `2160p` never matching the old regex.
- Player chrome moved to one shared component: bottom-left title, caption-less
  icons, visible rail, lock.

### 2026-11-21 (navigation polish)
- Back is a 40 pt chevron on every sub-screen, plus edge-swipe back on details,
  library, downloads, providers and languages.
- Player control bar is icons; the tab bar clears the home indicator.

### 2026-11-21 (sync: providers across devices)
- History, preferences and the provider *list* sync; private links never do.
- Providers now says so with a banner, a **Finish setup** action and a catalog
  hint, instead of leaving the second device with dead rows.

### 2026-11-21 (player: icons, rotation, hardware cutouts)
- Found the root cause behind every cutout bug: `SafeAreaProvider` was never
  mounted, so every inset in the app was zero.
- Player now rotates itself, pads the picture by the OS insets, and the `⋯`
  text sheet became one bar of labelled icons (v0.3.7).

### 2026-11-19 (pipeline + TV player)
- The versioned-release job now runs with `if: always()`, so a cancelled macOS
  runner no longer suppresses a release that already built Android and tvOS. That
  is why 0.2.2-0.2.6 had to be packaged by hand.
- The TV Live TV modal gained the channel position and a `NOW`/`NEXT` line taken
  from the guide data the channel rows already load.
### 2026-11-19 (latest) — player menu, sources, downloads, live pause, avatars
- The reason three player rewrites looked identical on the device: HEVC/Matroska
  routes to a second surface. Both now share one menu.
- Added resolution filters with a per-source info panel, a download quality
  picker with byte-accurate progress, capability-gated Live TV pause and preset
  profile avatars. Released 0.2.1 → 0.2.6.
- Everything is compile- and test-verified (152 suites / 1,521 tests); the menu
  and the choosers still need a real device check.
### 2026-11-19 (releases) — versioned downloads
- The rolling `preview-latest` tag made builds impossible to tell apart: Android
  and iOS publish minutes apart inside one run, so the iOS package looked older
  than it was. `release-preview.yml` now also publishes a `v<version>` release
  with clean names (`-ios.ipa`, `-tvos.ipa`, `-android.apk`, `-android-tv.apk`)
  and a device-to-file table; the rolling tag stays as the updater's channel.
- Version moved to 0.2.1; the last text glyphs (search, clear, resume, add,
  reorder arrows, back chevrons) became Ionicons.
### 2026-11-19 (player) — real-device screenshot drove three fixes
- The iPhone screenshot showed the player's two control layers overlapping and
  transport glyphs (`↶10`, `10↷`, `Ⅱ`, `⛶`, `🔇`) rendering as broken characters
  because the UI font has no coverage for them.
- The action row now clears the transport bar, the transport controls are
  Ionicons, and playback locks to landscape and releases on exit.
- Evidence: lint 0, typecheck 0, 1,511 tests. The layout and rotation are
  **not yet confirmed on the device** — the next install is the test.
### 2026-11-19 (release) — GitHub preview release for every platform but Windows
- `release-preview.yml` on `main` (`4cc49443`) published version **0.2.0**
  (build 95088635) to the `preview-latest` release: Android phone APK, Android TV
  APK, iOS resignable IPA, tvOS resignable IPA, update manifest and checksums.
- Fixed the check that had been failing the Android phone job:
  `@lunarr/vlc-player` declares `android.software.leanback` as optional, which
  the verifier treated as an error. It now accepts absent-or-optional and still
  rejects a required declaration.
- PWA deploy still fails: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are
  not configured (blocker B1).
### 2026-11-19 (end) — TV rail
- The TV rail renders in web TV mode with real Ionicons, the Sora brand and a
  white focus ring on the active item. Proportions at real TV resolution are not
  measured because the browser window was phone-sized.
### 2026-11-19 (end) — Android release build
- `assembleRelease` for arm64-v8a: BUILD SUCCESSFUL in 2m44s, 80 MB APK.
- Installed on the Android 17 emulator and launched: Home renders the new system
  (Ionicons, Inter/Sora, gradient header, Cinemeta hero, Continue Watching with
  resume progress) in the device's German locale.
### 2026-11-19 (end of stretch) — player chrome
- Header moved from a flat 72% band to a gradient scrim; titles on Sora, labels
  and subtitles on Inter; the source/audio/subtitle choosers use the display
  token instead of 26 px weight-900 headings.
- Evidence class: source-implemented, unverified. 348 playback tests, lint and
  typecheck pass, but the overlay could not be captured. Measured cause: every
  item in Cinemeta's Popular row is a *series*, and a series details page has no
  Play action until an episode is chosen, so automation never reached a stream.
  An earlier guess that the details view covers the tab bar was checked with
  `elementFromPoint` and is **false** — the tab bar stays hit-testable.
### 2026-11-19 (later still) — runtime theming
- `ThemeProvider` applies dark/AMOLED/light at runtime and persists the choice
  per device; all 39 themed stylesheets were migrated to `createStyles(theme)`
  behind `useThemeStyles`, with the type checker proving nothing was missed.
- Verified in the built PWA: Light repaints the whole app, AMOLED gives a true
  black background, and the choice survives a reload.
### 2026-11-19 (later) — details redesign
- The details hero moved off a flat 34% wash onto the `scrimBottom` token, and
  the title onto Sora. Its own 590 px minimum was overriding the compact variant
  and pushing actions below the fold; that is removed.
- Verified against live Cinemeta in the built PWA.
### 2026-11-19 — settings features and a real Home header
- `About` exposes version, build, platform and live sync/account state, and its
  note never promises sync to a guest.
- `Storage` measures what the app keeps and clears only the catalog cache; user
  data has no destructive one-tap action.
- Home verified against live Cinemeta: gradient header scrim, single-line
  display wordmark, Ionicons in place of `◉`/`☆`.
### 2026-11-18 — live sync backend, iOS 27 launch fix, design foundation
- Supabase project provisioned and 14 migrations applied; isolation proved by a
  committed script (11/11) rather than asserted.
- iOS builds now launch on iOS 27: the scene delegate and the pod deployment
  target are config plugins with contract tests, and a Release build boots on
  the simulator. An unsigned 28 MB IPA is built for ESign/Feather.
- Design system replaced the single palette: 20 colour roles, three themes,
  Inter + Sora, Ionicons instead of text glyphs, and content that clears the
  floating header.
### 2026-11-18 — MKV playback on macOS and the web
- The DMG is a WKWebView, so every MKV failed with `MEDIA_ERR_SRC_NOT_SUPPORTED`.
  Measured both engines: WebKit has no Matroska demuxer at all; Chromium plays
  H.264 AAC MKV but cannot decode AC-3/E-AC-3, even in MP4. Container and audio
  codec now appear as badges, and failures quote them.
- `apps/desktop-mac` rebuilds the wrapper from the repository and adds a libVLC
  player behind an injected bridge; `services/remux` gives the PWA an HLS
  fallback with the video copied and audio transcoded only when required.
- Mounted-DMG MKV/AAC and MKV/E-AC-3 play at 1080p with a live audio track and
  working seek; WebKit on the PWA origin plays the remux and rejects the raw MKV;
  Chromium plays MP4 and the remux. The remux service still needs a host.
### 2026-11-18 — Live TV can finally play a playlist channel
- Live TV listed an imported M3U playlist and then reported "Sender nicht
  verfügbar" for every channel. `validVariant` demanded an add-on manifest URL,
  which a playlist provider does not have, so all playlist variants were
  filtered before resolution; the screen test only checked the channel list.
- PR #66 lets playlist providers skip that check and adds four regression tests
  (playlist `selectChannel`, playlist `selectLogicalChannel`, insecure add-on
  manifest still rejected, loopback http still accepted).
- Emulator run: two-channel playlist imported over the local network, both
  channels listed, one played and decoded frames. 143 suites / 1,456 tests.
### 2026-11-18 — the dev-server workflow works, and the app declares its packages
- Android debug builds now load from Metro: `index.js` entry plus
  `EXPO_NO_METRO_WORKSPACE_ROOT=1`, and a platform-split `loadAppRoot` so the
  native split bundle stops throwing `Expected HMRClient.setup()`. Emulator cold
  launch rendered Home with zero `ReactNativeJS` errors.
- PR #64 made every workspace package a declared dependency and imports it by
  name; a contract test now fails on a relative escape out of the app. PR #63
  added a resource-parity suite: 42 locales, 320 English keys, no empty value
  and no dropped `{name}` placeholder.
- 143 suites / 1,452 tests, lint 0, typecheck 0, `build:pwa` 0. Still no
  playback, no physical device, and Fast Refresh is not established.
### 2026-11-17 — Android emulator launch and German locale on device
- Release APK (arm64-v8a, 76 MB, debug keystore) installed on
  `Medium_Phone_API_37.0`: Home rendered live Cinemeta data, tabs and the
  Settings/Live TV stacks navigate, no `FATAL EXCEPTION` in logcat.
- In-app Deutsch verified on device for Settings, Live TV, the guide settings and
  the M3U playlist manager (including the native credential note), and it
  survived a cold start while the device locale was unset.
- Not verified: playback (no provider or MKV source), physical devices, TV. The
  debug APK cannot load JavaScript because the dev-server entry resolves
  `./index` from the repository root.
### 2026-11-17 — screen copy migration and a buildable Android project (PR #56–#62)
- `t()` gained `{name}` interpolation plus `i18n/translate.ts`; 17 screen
  surfaces moved their copy into one en/sq/fr/de `screens` pack (224 keys) with
  English fallback, in six copy PRs.
- Android now builds: `withAndroidGradleWrapper` pins Gradle 8.14.3 because RN
  0.85's foojay plugin needs `JvmVendorSpec.IBM_SEMERU`; JDK 21
  `assembleDebug` produced a 341 MB all-ABI debug APK.
- 142 suites / 1,448 tests, lint 0, typecheck 0 on `main`; no APK install, no
  visual review and no translator pass, so device and locale coverage stay
  unverified.

### 2026-11-17 — audio track discovery and the playlist channel cap (PR #53, #54)

- Fixed native audio track discovery: prefer a non-empty track list from either
  the native event or the player property, and re-apply the selection on
  `readyToPlay`. Same ready re-apply on the Live TV surface. 3 regression tests.
- Parsed the public iptv-org index (2.6 MB, 11,502 entries) with the real parser:
  5,000 kept, 6,502 dropped by the cap with no signal, 45 ms. Added
  `M3uPlaylist.truncated`, carried it through the adapter, router and channel
  service, and show a localized notice in Live TV. 9 tests.
- Evidence: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 176 suites / 1,967
  tests, `pnpm build:pwa` verified. No device run; the audio fix is unverified
  until a simulator or device pass re-checks the chooser.

### 2026-11-15 — watch history screen with deletion (PR #52)

- Added `forget`/`forgetAll` to `WatchProgressController` and the context: a
  delete cancels a queued remote upload, waits for the in-flight one to settle
  and only then calls the gateway `remove`; a failed remote delete keeps the
  local delete and reports `offline`.
- Added `WatchHistoryScreen` behind a Library header button: newest first, one
  row per media, 500-row bound, per-row remove, two-step clear-all, resume and
  en/fr/de/sq copy. Model helpers in `watch-history-model.ts`.
- Evidence: unit and component tests only — 141 suites / 1,431 mobile-tv tests,
  `pnpm lint` 0, `pnpm typecheck` 0, `pnpm build:pwa` verified. No device run and
  no live Supabase delete (B2 blocks it); PRs #12/#13 are superseded.

### 2026-11-15 — M3U playlists become a usable Live TV source (PR #51)

- Added the parser bridge (`live-tv` package), a playlist adapter, a routed
  adapter, identity-scoped secure playlist storage and an add/enable/remove
  settings screen; Live TV now merges playlist providers and refreshes on change.
- Security: playlist records are secrets (SecureStore/identity scope on native,
  session memory on web), `directStreamUrl` stays in the memory channel cache,
  and cleartext HTTP is opted into for playlist fetches only.
- Evidence: unit tests only — `pnpm lint`, `pnpm typecheck`, `pnpm test`
  (174 suites / 1,927 tests) and `pnpm build:pwa`. No real IPTV provider fetched,
  no device run.

### 2026-11-15 — native MKV playback verified in the iOS simulator, and why it was broken

- Built the app for the iPhone 17 simulator (iOS 27.2, Xcode 27.2, CocoaPods
  1.17.0, MobileVLCKit 3.7.5) and served genuine Matroska from a local add-on
  after confirming the containers by magic bytes. Result: `VlcVideoSurface`
  plays MKV H.264/AAC (13.0/13.0s) and MKV H.264/E-AC3 (14.0/52.0s) through
  libvlc, with an MP4 control at 10.0/10.0s.
- The first runs produced no video, no progress and no error. Instrumented
  counters showed 31 attach / 30 detach / 30 release cycles in 20 s: the library
  re-applies its `useImperativeHandle` on every render, and the teardown fix
  released the player on that transient ref detach. Fixed in `592e8d99`; three
  regression tests added; gates 167 suites / 1,847 tests. PR #49.
- Also found: Xcode 27 builds install but cannot launch without UIScene
  adoption (`react-native-tvos@0.85.3` has no `UIWindowSceneDelegate`). Filed as
  issue #48. Local verification used a throwaway scene delegate in the gitignored
  `ios/` directory; nothing from it is in the repository.

### 2026-11-14 — web container probe measured in real Safari and Chromium

- Ran `docs/builds/tools/web-container-probe.html` in Safari 27.2 (macOS 27.2)
  and Chromium 152 against genuine Matroska files: WebKit answers `""` for
  `video/x-matroska` and both H.264 Matroska samples fail with `MediaError` code
  4, while Chromium answers `maybe` and decodes them (50 and 41 frames, clock
  advancing). The shipped engine rule and its MKV message are therefore correct
  on macOS; iOS Safari and HEVC/DTS Matroska stay unmeasured.
- Caught a sample trap: `test-videos.co.uk`'s "mkv" files are MP4 (`ftyp isom`)
  with an `.mkv` URL, which silently "passes" a Matroska test in any engine. All
  samples used here were checked by magic bytes first.
- Codec edges in Chromium 152: Matroska carrying DTS 4.0 plays (1280×688, 36
  frames, no `MediaError`) and HEVC-in-MP4 (`hev1`) decodes (41 frames), so
  neither codec alone disqualifies a source on macOS. Audio audibility is
  unmeasured — the `captureStream()` check returned zero audio tracks even for an
  AAC control, so it was discarded rather than reported.
- Evidence recorded in `docs/builds/preview-artifact-checklist.md`; no code
  changed and no provider stream was reachable (`lumio.stream` still NXDOMAIN).

### 2026-11-14 — libvlc teardown leak in the native surface

- `pnpm test` caught a real leak in the merged surface: the unmount effect saw
  `playerRef.current === null` because React detaches instance refs before
  passive cleanup, so `release()` never ran and libvlc kept its decoder and
  native view alive after leaving the player.
- Replaced the effect with a callback ref (`attachPlayer`) that releases exactly
  once when the view detaches; `vlc-video-surface.test.tsx` adds seven tests,
  including the unmount-release regression and a credential-header assertion
  that media options never carry tokens.
- Gates: lint, typecheck, 167 suites / 1,844 tests (app 134 / 1,347; shared 33 /
  497), `pnpm build:pwa` exit 0. `expo export` for iOS and Android bundles the
  surface (`VLCPlayer`, `selectAudioTrack`, `progressUpdateInterval`,
  `vlc-audio` present in both `.hbc` files). Still no device run, so the VLC
  surface stays **Source-implemented, unverified**. Merged as `b36dea5b`
  (PR #43) after the `pull_request` run
  [43632379418](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43632379418)
  passed.

### 2026-11-14 — native VLC surface for Apple MKV playback

- Ported the libvlc surface from `ui-redesign-v2` onto `main` behind the existing
  `VideoSurface` contract: Matroska/WebM/AVI/FLV/WMV/RealMedia and TrueHD/DTS
  start on VLC, and an AVPlayer format failure retries there once.
- Added `@lunarr/vlc-player@2.1.1` (MobileVLCKit/TVVLCKit 3.7.3, libvlc 3.7.5),
  the `withAndroidVlcJniLibs` packaging plugin for the duplicate
  `libc++_shared.so`, routing tests and a native-error classifier. Gates: lint,
  typecheck, 166 suites / 1,837 tests, web export and PWA verifier pass; merged
  as `e2c3eb31` (PR #41) after the `pull_request` run
  [43629723794](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43629723794)
  passed.
- No pod install, Gradle build or device playback run happened, so the feature
  stays **Source-implemented, unverified**.

### 2026-11-14 — pull-request CI and PR #34 evaluation

- CI now runs on pull requests that touch runtime code, path-scoped so docs-only
  PRs spend nothing (PR #39, `12b7c7a4`); the manual-only contract test was
  narrowed to the native preview workflows.
- Evaluated PR #34 against `main`: clean merge, typecheck/tests/web export pass
  (172 suites / 1,872 tests), but `pnpm lint` fails on 3 unused bindings.
- Recommend splitting PR #34 into native VLC, profile-scoped sync and UI PRs
  instead of merging 94 files at once; `main` gates are 165 suites / 1,826 tests.

### 2026-11-14 — web MKV capability and engine-aware ranking

- Replaced the blanket MKV/WebM rejection with a per-engine `canPlayType` probe:
  Chromium attaches MKV/H.264 sources it can demux, while WebKit fails over fast
  with an MKV-specific message.
- Ranking now receives `webMatroskaSupported` from a cached probe, so a
  preferred-language MKV can outrank an unwanted-language MP4 in Chromium;
  WebKit keeps the previous `-8_000_000` penalty and MP4 still beats MKV at
  equal language.
- Verified in Chromium 152: `video/x-matroska` reports `maybe` and a real
  Matroska file plays (readyState 4). Safari/iOS cannot demux Matroska at all.
- Gates: lint, typecheck and tests pass — 165 suites / 1,826 tests
  (app 132 / 1,329; shared 33 / 497). `pnpm build:pwa` also passes: web export
  verified and the shipped `AppRoot` bundle contains `video/x-matroska`.
- Pushed as PR #37; CI run
  [43621246059](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43621246059)
  passed on `13319a61`, and run
  [43621746525](https://github.com/jugentorba/MoviesTv-Flix/actions/runs/43621746525)
  passed on `30c7fa73`. Cloudflare Pages built the PR preview
  `https://fix-web-container-capability.moviestv-flix.pages.dev` from the same
  bundle hash as the local export. Merged to `main` as `a78d38fe` on
  2026-11-14 (PR #37); no app release or store artifact was produced.

### 2026-11-13 — takeover audit and shared documentation

- Audited repository, history, docs, branches, release artifacts and issue
  tracker. No application code changed.
- Local gates passed: 164 suites / 1,804 tests. Confirmed redesign is unmerged,
  external configuration is blocked, device QA is pending, and no Watch History
  screen exists on `main`.
- Added `AGENTS.md` and this status document; corrected two stale claims in
  `README.md` (watch history, Android TV / tvOS artifact status).

### 2026-10-28 — last `main` commit before audit

- `5d77caff` recovered the provider UI when the initial restore fails, so the
  provider screen can no longer stay stuck on a spinner.
