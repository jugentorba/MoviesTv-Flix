# Preview artifact checklist

This file records only evidence from real external build/deploy outputs. Do not replace `PENDING` with `PASS` until the corresponding artifact has been produced and verified.

## 14 November 2026 — PWA preview for the web container fix (18:40 UTC)

- Source: `30c7fa73` on `fix/web-container-capability` (PR #37). GitHub Actions CI run `43621746525`: PASS (lint, typecheck, tests).
- Build: PASS — local `pnpm build:pwa` on the same commit; `PWA export verified: 7 required files, 2 manifest icons, 23 files scanned`.
- Cloudflare Pages preview: PASS — deployment `48128eb6`, PR preview `https://48128eb6.moviestv-flix.pages.dev`, branch alias `https://fix-web-container-capability.moviestv-flix.pages.dev`, reported by the `cloudflare-workers-and-pages` bot for commit `30c7fa7`.
- Artifact identity: PASS — the deployed `index.html` requests `AppEntry-dfd9954fadfed54eec2a6cce1a8100d3.js`, the same hash produced by the local export; the deployed `AppRoot-c0e82b741e929684b23567cbe9925a7a.js` contains `video/x-matroska` and the MKV fallback message.
- Pages Functions: PASS — `/api/runtime-config` returns HTTP 200 on the preview.
- Workers build `moviestv-flix` for the same commit was still in progress at the last check; no Worker deployment result is claimed.
- Safari playback of the reported provider streams: PENDING — needs the add-on host, which returns NXDOMAIN from the build environment, plus a Safari/iOS device or browser.
- Merge to `main`: PASS — PR #37 merged as `a78d38fe` on 2026-11-14 after owner
  approval; no release tag, store artifact or in-app update manifest was
  produced.
- Engine behaviour is now measured rather than assumed; see the next section.

## 14 November 2026 — web container engine probe (19:45 UTC)

Method: `docs/builds/tools/web-container-probe.html`, served over HTTP and run in
two real engines on the same workstation. It reports `canPlayType` and then
attaches genuine Matroska and MP4 files, sampling `currentTime`, decoded frame
count and `MediaError` after playback starts. Container identity of every sample
was checked by magic bytes (`1A45DFA3` + `matroska` DocType) before use —
`test-videos.co.uk`'s "mkv" folder serves an MP4 (`ftyp isom`, `avc1`) and is
therefore unusable as Matroska evidence.

Samples: Matroska H.264/AAC (`filesamples.com … sample_640x360.mkv`), Matroska
H.264/E-AC3 (`samples.ffmpeg.org/Matroska/H264+EAC3.mkv`), MP4 H.264 control.

| Engine | `canPlayType('video/x-matroska')` | Matroska H.264/AAC | Matroska H.264/E-AC3 | MP4 control |
| --- | --- | --- | --- | --- |
| Chromium 152 (Electron 44, in-app browser) | `maybe` | PASS — 640×360, 50 frames, clock advancing | PASS — 1280×528, 41 frames | PASS |
| Safari 27.2 (macOS 27.2, WebKit 605.1.15) | `""` | **FAIL** — `MediaError` code 4, `readyState` 0 | **FAIL** — `MediaError` code 4 | PASS — 1280×720 |

Second pass, codec edges, Chromium 152 on the same samples plus two more:

| Sample | Chromium | Safari 27.2 |
| --- | --- | --- |
| Matroska H.264 + DTS 4.0 (`samples.ffmpeg.org/A-codecs/DTS/Edward.Scissorhands…mkv`) | PASS — 1280×688, 36 frames, no `MediaError` | not re-run (no Matroska demuxer) |
| MP4 HEVC (`hev1`, test-videos.co.uk h265 folder) | PASS — 1280×720, 41 frames | not run |

- Result: the shipped rule in `webContainerSupport.ts` matches both engines on
  macOS for progressive Matroska. WebKit reports no Matroska demuxer and the file
  fails with `MEDIA_ERR_SRC_NOT_SUPPORTED`, which is exactly the case the
  pre-attach rejection and its message exist for; Chromium advertises and decodes
  it, so the engine-aware ranking is correct.
- Chromium also reports `MediaSource.isTypeSupported('video/x-matroska; …')` as
  `false`, so Matroska there is progressive only, never MSE/HLS-fMP4 backed.
- Chromium decodes HEVC (`hev1` in MP4) and plays Matroska carrying a DTS track
  without a fatal error, so on macOS neither HEVC nor DTS alone disqualifies a
  source there. Whether the DTS audio is audible is **not measured**: the
  `captureStream()` track count read 0 audio tracks even for the AAC MP4 control,
  so that method is invalid here (a muted element produces no captured audio) and
  no claim is made.
- A proxied run of the AAC Matroska through a local CORS proxy returned
  `MediaError` 4 while the same URL played directly; the proxy, not the engine,
  caused that result, so it is discarded rather than recorded as a finding.
- Still unproven: iOS Safari (same WebKit engine, not measured here), HEVC video
  inside Matroska (only HEVC-in-MP4 and DTS-in-Matroska were measured),
  audio output for any sample, and playback of the reported provider streams,
  which stay BLOCKED on the NXDOMAIN add-on host.

## 2 October 2026 — latest Android release and live gateway audit (09:28 UTC)

- Verified source: `fb5fff62495ecaaedefb0bd7ee74b26bea4d1636`; successful GitHub Actions run `36977852331`.
- Source gate: PASS — lint, native TypeScript and workspace tests completed successfully. App log records 131 suites / 1,309 tests passed; shared package suites also passed.
- Android phone: PASS — build, signing and independent workflow artifact verifier completed; artifact ID `11214427748`.
- Android TV: PASS — generated TV manifest check, build, signing and artifact verifier completed; artifact ID `11214913377`.
- Both Android variants use versionCode `90925717`, package `com.jugentorba.moviestvflix`, and pinned signer `0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D`.
- Published Android APKs, checksum/signing sidecars, both Apple IPAs and the shared update manifest are present in private release `preview-latest`.
- Static manifest sync: PASS — bot commit `af5c0652cbe60ebbcb6629442aba036bb68af605` records the current Android builds/hashes without advertising unavailable download URLs.
- Removed temporary push-triggered Android rebuild workflow in `26394bc5ccab4594de10209c48fd20f42554b922` after the successful release. Confirmed the temporary file is absent; the normal manual/reusable Android workflow remains.
- Live gateway: BLOCKED — direct curl probes at 09:26–09:28 UTC returned HTTP 200 with the old build-1 fallback manifest, while `/api/app-update/android.apk` and `/api/app-update/ios.ipa` returned HTTP 503, JSON `Update package is not published yet`.
- This is not a missing GitHub artifact: the release assets were independently listed through the authenticated GitHub connector. The worker's 503 branch means release lookup is unavailable (missing/invalid runtime token or failed upstream lookup). Exact Cloudflare secret state is not observable through GitHub and has not been asserted.
- Required deployment follow-up: verify Cloudflare runtime `GITHUB_RELEASE_TOKEN` can read this private repository's release, complete the current Pages deployment, then re-probe the manifest and actual package downloads. Never put that token in static files or `EXPO_PUBLIC_*` variables.
- Cloudflare Pages and Workers builds for `26394bc` were in progress at the last check; no deployment success is claimed here.
- Physical-device installation, in-place Android update/data retention, iOS external signing and playback remain PENDING.

## Android phone

### GitHub Actions preview (1 October 2026)

- Build: PASS — workflow run `36888753912`, phone job completed successfully.
- Artifact: PASS — `MoviesTv-Flix-phone-preview`, latest artifact ID `11184950742`.
- SHA-256: `705ac7a3b244f8d7fc32da2f0b79c0dabf761c419070625953eee584784a897d` — independently re-downloaded on 1 October and matched the artifact sidecar.
- Built source checkout: `0caaa8c6fb8491c325e425dfef04ecb0932bbb80`.
- Independent package-content audit: PASS — `AndroidManifest.xml`, `assets/index.android.bundle`, expected source revision `0caaa8c6fb84`, and native libraries for arm64-v8a/armeabi-v7a/x86/x86_64 are present.
- Android versionCode: `1074`.
- Package / embedded bundle / signature / zip alignment: PASS — enforced by `scripts/verify-android-preview.sh` before upload.
- Preview signer SHA-256: `0F:D5:A5:0B:BE:E3:0D:1D:3B:BC:7F:1B:5D:DE:E3:51:A7:0C:0F:7B:DA:7F:99:EA:17:59:0F:93:11:42:2D:1D`.
- Independent signer audit: PASS — the certificate extracted directly from the APK Signature Scheme v2 block has the same SHA-256 fingerprint (subject/issuer `CN=MoviesTv-Flix Preview, O=Local Preview, C=FR`).
- Stable preview signing identity: PASS for GitHub Actions — the workflow now reuses the repository preview keystore and verifies its certificate fingerprint.
- Future in-place updates: SOURCE READY — the workflow uses the stable preview signer and a monotonic native build number as Android `versionCode`, including reusable workflow calls.
- Physical-device install, playback and in-place update: PENDING.


### Updater-ready Android previews (2 October 2026)

- Full Android updater rebuild: PASS — workflow run `36970306200`.
- Phone artifact: PASS — `MoviesTv-Flix-phone-preview`, artifact ID `11211229555`.
- Android TV artifact: PASS — `MoviesTv-Flix-android-tv-preview`, artifact ID `11211472570`.
- Built source checkout: `c7db9340902b1899bc95fcb953b27cb89d3ef843`.
- Monotonic Android versionCode/build: `90919882` for both phone and TV artifacts.
- Phone APK SHA-256: `edc2b88895bd7fcb28b705b373d7e9047ff889dbe2b0fa2378038bd8a1108502` — independent artifact re-download matched the sidecar.
- Android TV APK SHA-256: `02df39cc44a0d3b4cd6b537d5695d0d9fe08ff12730537acf1206767dd652cd8` — release asset digest.
- Stable signer: PASS — phone independent audit matched the expected preview certificate SHA-256.
- Direct in-app updater bridge: PASS in compiled phone APK — the APK contains `MoviesTvFlixPreviewUpdaterModule` / `MoviesTvFlixPreviewUpdaterPackage`; the bridge verifies the downloaded APK SHA-256, package name, signer, exact expected versionCode, and that the versionCode is newer before opening Android's installer.
- Persistent update release: PASS — phone APK, Android TV APK, checksums, signer reports and shared update manifest are published on private release tag `preview-latest`.
- Android in-place update on a physical device: PENDING — requires installing an updater-ready preview once, then exercising Settings → Updates against the live Cloudflare gateway.

- Codemagic build: PENDING
- SHA-256: PENDING — workflow publishes `MoviesTv-Flix-android-phone-preview.apk.sha256`
- Build revision shown in Preview diagnostics: PENDING
- Package: `com.jugentorba.moviestvflix`
- Embedded JS bundle: PENDING
- APK signature: PENDING
- Signing certificate report: PENDING — workflow publishes `MoviesTv-Flix-android-phone-preview.apk.signing.txt`
- Persistent preview signer: SOURCE READY — Codemagic workflow requires encrypted group `moviestv_preview_signing` with `CM_KEYSTORE`, `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, and `CM_KEY_PASSWORD`; signing material is no longer generated from the expiring dependency cache
- Install without Metro: PENDING
- In-place update over the previous preview signed by the same Codemagic workflow: PENDING
- Preview diagnostics on physical device: PENDING — Settings → Preview diagnostics is available in preview builds

## Android TV

### GitHub Actions preview request (1 October 2026)

- Trigger: REQUESTED — source checkout `b72adb10aa1c579a3d29df63c78a362546744fc0` temporarily enabled the push trigger and constrained the matrix to `android-tv` only.
- Workflow restoration: PASS — `fdce33e7b725f5788f568c7000c701de8f39efdc` restored the checked-in workflow to `workflow_dispatch` only.
- Build/artifact verification: PENDING — do not promote any Android TV artifact item below until the workflow result and uploaded artifact are inspected.

- Codemagic build: PENDING
- SHA-256: PENDING — workflow publishes `MoviesTv-Flix-android-tv-preview.apk.sha256`
- Build revision shown in Preview diagnostics: PENDING
- Package: `com.jugentorba.moviestvflix`
- Embedded JS bundle: PENDING
- APK signature: PENDING
- Signing certificate report: PENDING — workflow publishes `MoviesTv-Flix-android-tv-preview.apk.signing.txt`
- Persistent preview signer: SOURCE READY — Android TV uses the same encrypted `moviestv_preview_signing` identity as the phone workflow so compatible previews can retain signer continuity
- Leanback launcher activity: PENDING
- Leanback feature declaration: PENDING
- Touchscreen not required: PENDING
- Faketouch not required: PENDING
- TV launcher icon/banner artwork: PENDING
- Install without Metro: PENDING
- In-place update over the previous Android TV preview signed by the same Codemagic workflow: PENDING
- Remote focus/navigation QA: PENDING — source supports D-pad/Back plus CH+/CH− zapping; Android TV build consumes channel keys after forwarding them to react-native-tvos so the system tuner should not take over
- Live TV drawer/zapping/playback QA: PENDING — source supports player tap/OK channel drawer, Previous/Next controls, dedicated CH+/CH− remote keys, favorites and provider/source failover
- Preview diagnostics layout check: PENDING — physical TV build should report `Layout: tv`

## iOS re-signable

### GitHub Actions preview (1 October 2026)

- Build: PASS — workflow run `36904837520`.
- Artifact: PASS — `MoviesTv-Flix-ios-resignable-preview`, artifact ID `11185260164`.
- Built source checkout: `1b5c70cca8602e76f4f00f6d7052b157d610231c`.
- Re-signable IPA packaging and verifier: PASS.
- SHA-256: `e55863621d78e80dab175c1f28ffec98ffa6c467d42ebb0e51d3180ea81db3fb`.
- Independent artifact re-download audit: PASS — sidecar hash matched; bundle `com.jugentorba.moviestvflix`, platform `iphoneos`, minimum iOS `16.4`, device families iPhone/iPad, ARM64 executable, embedded source revision present, and no provisioning profile or `_CodeSignature` entries.
- Physical iPhone/iPad install after external signing: PENDING.

### Updater-channel iOS preview (2 October 2026)

- Build/publish: PASS — caller workflow run `36967752429`; iOS verify, native build and `preview-latest` release publisher all completed successfully.
- Artifact: PASS — `MoviesTv-Flix-ios-resignable-preview`, artifact ID `11210498063`.
- Built source checkout: `703b701e8a4bff7803f715c4e8ded44011ad6a02`.
- App version/build: `0.1.0 (90917830)` — the new monotonic native build number is embedded in `CFBundleVersion` and the published update manifest.
- SHA-256: `7473bbb8e3a4cbee1ddcee9167b4cbf3c394c571c581734f2c84cfcecb8d31b6` — independent re-download matched the artifact sidecar.
- Independent package audit: PASS — bundle `com.jugentorba.moviestvflix`, platform `iphoneos`, minimum iOS `16.4`, device families `[1,2]`, ARM64 executable, source revision embedded in `main.jsbundle`, no `embedded.mobileprovision`, and no `_CodeSignature` entries.
- Persistent update release: PASS — IPA, checksum sidecar and `MoviesTv-Flix-update-manifest.json` published to `preview-latest`.
- Physical iPhone/iPad install after external signing: PENDING.

- Codemagic build: PENDING
- SHA-256: PENDING — workflow publishes `MoviesTv-Flix-ios-resignable-preview.ipa.sha256`
- Build revision shown in Preview diagnostics: PENDING
- Bundle: `com.jugentorba.moviestvflix`
- Physical-device ARM64 build: PENDING
- Embedded provisioning profile: expected NONE; verification PENDING
- Existing code signature: expected NONE; verification PENDING
- Requires external re-signing: YES

## tvOS re-signable

### GitHub Actions preview request (1 October 2026)

- Trigger: REQUESTED — source checkout `47312ed07e7d308e8d77dfe61ac76189c53dc4b4` requested the re-signable tvOS preview build.
- Workflow restoration: PASS — `1fcb42fc58ef995a372d4181a975beb19390f72e` restored the checked-in workflow to `workflow_dispatch` only.
- Build/artifact verification: PENDING — do not promote any tvOS artifact item below until the workflow result and uploaded IPA are inspected.

- Codemagic build: PENDING
- SHA-256: PENDING — workflow publishes `MoviesTv-Flix-tvos-resignable-preview.ipa.sha256`
- Build revision shown in Preview diagnostics: PENDING
- Bundle: `com.jugentorba.moviestvflix`
- Physical-device ARM64 build: PENDING
- Platform: expected `appletvos`; verification PENDING
- Minimum tvOS version: expected `16.4`; verification PENDING
- Apple TV device family: expected 3; verification PENDING
- Embedded provisioning profile: expected NONE; verification PENDING
- Existing code signature: expected NONE; verification PENDING
- Requires external re-signing: YES
- Real Apple TV launch/remote/playback QA: PENDING

### Updater-channel tvOS preview (2 October 2026)

- Build/publish: PASS — caller workflow run `36967878204`; tvOS verify, native build and `preview-latest` publisher completed successfully.
- Artifact: PASS — `MoviesTv-Flix-tvos-resignable-preview`, artifact ID `11210434133`.
- Built source checkout: `e5882c9f233a5c2cad94e4232c6f2a200a56e016`.
- App version/build: `0.1.0 (90917933)`.
- SHA-256: `543c826d1695f6a50bda5b596fd7bed74776f95ada2fe9ae653ead43a0fd878f` — independent re-download matched the artifact sidecar.
- Independent package audit: PASS — bundle `com.jugentorba.moviestvflix`, platform `appletvos`, minimum tvOS `16.4`, Apple TV device family `[3]`, ARM64 executable, source revision embedded in `main.jsbundle`, no provisioning profile, and no `_CodeSignature` entries.
- Persistent update release: PASS — tvOS IPA and checksum sidecar published and the shared update manifest advanced to tvOS build `90917933`.
- Real Apple TV signing/install/launch/remote/playback QA: PENDING.

## PWA

### 2 October 2026 updater/PWA gate

- Current source production PWA gate: PASS — isolated workflow run `36977094420` completed `pnpm build:pwa` successfully, including the full workspace test suite, web TypeScript pass, Expo export and static-output verifier.
- Deployable PWA build ID: `baa2ad16478174ed`.
- App tests in that gate: PASS — `131` mobile-TV suites / `1309` tests, plus all workspace package suites and script-level PWA/native-update contracts.
- PWA security verifier: PASS — `7` required files, `2` install icons and `23` exported files scanned.
- Update-hostname verifier regression: PASS — the resolved-media URL rule now requires a real media-extension boundary and no longer mistakes the `main.moviestv-flix.pages.dev` hostname for a `.mov` media URL.
- Unified release source: READY — manual `Release preview` workflow builds Android phone/TV, iOS, tvOS and then deploys the PWA from the same source revision.
- Manual Cloudflare deploy source: READY — `cloudflare-pages-deploy.yml` builds `pnpm build:pwa`, deploys the existing `moviestv-flix` Pages project and verifies the update-manifest route.
- Live branch deployment observed before the gate repair: STALE — `https://main.moviestv-flix.pages.dev` served build ID `ff049b003438fcf0`; `/api/runtime-config` was live but `/api/app-update/manifest` returned HTTP 404 and `/updates/latest.json` fell through to the SPA HTML shell.
- GitHub direct-deploy credentials: PENDING — repository secret `CLOUDFLARE_API_TOKEN` was not present during the 2 October credential probe, so the manual GitHub→Pages deployment cannot be dispatched safely yet.
- Live update-gateway verification after a fresh Cloudflare deployment: PENDING.

Current Cloudflare verification date: 2026-10-01.

- Cloudflare source gate/deploy refresh: PASS — both Pages and Workers successfully built source `a36bf22c907950fcfcf8d45f36fc39bfd5137eae`, which includes the account/backend isolation, provider/PWA reliability, bounded subtitle handling, Safari pre-metadata playback startup hardening, and nested Apple preview signature verifier. The configured build command is `pnpm build:pwa`, so the external gate includes lint, the full workspace tests, web TypeScript, Expo export and the static-output verifier.
- Current Pages preview: PASS — `https://de492311.moviestv-flix.pages.dev`; branch preview remains `https://main.moviestv-flix.pages.dev`.
- Cloudflare Workers build: PASS — build `5eaf5915-fb20-4d2a-b202-6fe5bac768bb`, version `40037277-29a5-486b-9bb2-aa4d620bccf4`.
- Cloudflare Workers URL: PASS — `https://moviestv-flix.jugentorba039.workers.dev`
- Deployed Expo web app and real catalog: PASS
- Static export verifier: PASS — included in the successful external `pnpm build:pwa` gate for `a36bf22`.
- Manifest: PASS — standalone display with 192×192 and 512×512 icons
- Service worker: PASS — versioned shell cache, sensitive route/query/header exclusions, and private/no-store response bypass
- Installability check on a physical device: PENDING
- Preview diagnostics: PENDING live QA — source checks manifest, service worker, runtime config, Nuvio/Cinemeta proxies, install mode, selected layout, network, and browser media capabilities
- Runtime account configuration: PENDING live QA — source now supports same-origin discovery plus validated in-app public Supabase setup
- Movie playback with a configured provider: PENDING live QA — web ranking prefers browser-safe H.264/HLS/MP4/MOV, skips unsupported DASH/MKV/AVI/FLV/WMV, gives header-advertised signed URLs a bounded direct Safari attempt, can fall back from hls.js startup failures to native Safari HLS, defers premature pre-metadata `NotSupportedError` failures, pauses/reloads HLS across real offline transitions, retries IMDb/TMDB plus catalog-native Stremio IDs, and abandons post-start stalls after bounded recovery
- Live TV playback with a configured provider: PENDING live QA — web playback uses the same compatibility filtering, signed-URL refresh and hls.js→native Safari startup fallback, proactively pauses HLS while offline, resumes after reconnect, plus bounded post-start failover across channel sources/provider variants; TV-browser player also supports ChannelUp/ChannelDown and Channel List remote keys
- Secret/static-output scan: PASS — deployed HTML, manifest, service worker, and 323,957-character production JavaScript bundle contained no privileged-key, private-key, credential-query, or fixture-stream markers

## Source-level checks already required before external builds

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

These source-level checks must run successfully on Codemagic (or another complete environment) before either native workflow publishes a preview artifact.

## 29 September release checkpoint

- Verified local source: `8ed147f3f975be2cfc99de4433e928aa789b7b9e`.
- Full `pnpm build:pwa`: PASS locally, including 159 suites / 1,754 tests, lint, web TypeScript, Expo export and artifact verification.
- Local PWA build identity: `bf074358fbdaf3a0`.
- Cloudflare check for `8ed147f`: SKIPPED, confirmed through GitHub check runs.
- This documentation-only checkpoint omits `[skip ci]` so the existing Cloudflare Git integration can run. All five GitHub Actions workflows remain `workflow_dispatch` only; no Actions run is requested.
- Direct live HTTP verification from the current environment returns 403; this alone does not establish that the site is unavailable to users.
- The new external build/deploy and real-device checks remain PENDING until their results are observed.


## 29 September account/backend lifecycle checkpoint

- Verified/deployed source: `4850911e8fb64c808cd3111a2135c9f0c2d15f7c`.
- Backend replacement disposes the old Supabase auth client on unmount/replacement, shutting down its auth refresh/listener lifecycle after switching synchronization projects.
- Provider deletion during an account handoff reads only identity-visible provider metadata, preventing a newly active account from reusing a hidden previous account's provider timestamp.
- Native download callbacks captured by a previous account are rejected after an identity change, and active-download deduplication is identity-scoped.
- In-flight Live TV guide save/remove completion paths are identity-guarded so a late operation from the previous account cannot replace the newly active account's guide UI state.
- Regression coverage exists for Supabase disposal, cross-account provider-delete metadata, stale native download callbacks and late guide-save completion.
- Cloudflare Pages and Workers both reported successful builds/deployments for this combined source. No GitHub Actions workflow was dispatched.
- Physical-device playback, installability/account-sync QA, and native preview artifacts remain PENDING.


## 30 September Android preview signing hardening

- The Android phone and Android TV Codemagic workflows no longer store their signing key under the dependency cache.
- Both workflows now require the encrypted Codemagic group `moviestv_preview_signing` with a base64-encoded `CM_KEYSTORE` plus `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, and `CM_KEY_PASSWORD`.
- The decoded keystore is created only inside the build workspace, removed after signing, and is not published as an artifact.
- Each Android preview publishes a non-secret `.apk.signing.txt` certificate report so the signer fingerprint can be compared between builds before testing an in-place update.
- Contract coverage rejects a return to generated/cache-backed preview keys and verifies both Android workflows use the persistent signing variables.
- A real Codemagic APK build and physical-device update remain PENDING; source inspection does not promote either item to PASS.


## 30 September combined signing/diagnostics verification request

- Source immediately before this checkpoint: `ff0dac4f7e9a5a84fd5b7c1bc67a4ee9b3813385`.
- Android preview signing now uses persistent encrypted Codemagic variables rather than an expiring dependency cache, publishes signer certificate reports, and accepts base64 values containing normal whitespace/line wrapping.
- Preview Diagnostics endpoint probes now use `cache: 'no-store'`, preventing stale browser-cache responses from masquerading as live route health.
- Regression coverage guards both changes.
- This checkpoint intentionally omits `[skip ci]` so the existing free Cloudflare Git integration can run the full `pnpm build:pwa` gate. GitHub Actions workflows remain manual-only.
- External result: PASS — source `82c47afd68b7180fdd90ff34ce39f2a2f30ba3a3` passed both Cloudflare deployment paths through the configured full `pnpm build:pwa` gate. Pages deployed preview `https://4dcce1f8.moviestv-flix.pages.dev`; Workers build `bfe4cde6-02d4-4e9c-a187-ed437f560529` published version `478d3579-41b1-4921-b78a-5a1c8cc38edf`. GitHub reported zero workflow runs for this commit.
