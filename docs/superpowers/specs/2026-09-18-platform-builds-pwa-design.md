# APK + Re-signable IPA + PWA Build Architecture

**Date:** 2026-09-18  
**Branch:** `codex/platform-builds-pwa-20260918`  
**Base:** `codex/live-tv-provider-browser-20260917`

## Purpose

Create one modern build path for the current MoviesTv-Flix app that produces:

1. an installable Android APK for phone testing,
2. an unsigned/re-signable iPhone IPA that can be signed by the user's existing third-party signer/certificate service,
3. an installable PWA built from the same current codebase.

This slice must not revive the stale historical PWA/iOS branches and must not depend on GitHub Actions while the repository/account runner quota is unavailable.

## Existing State

The current app is Expo SDK 56 + React Native TVOS with:

- Android/iOS app configuration in `apps/mobile-tv/app.config.ts`,
- movie playback and series/episode work in the modern architecture,
- provider/add-on runtime,
- Supabase authentication/preferences,
- Live TV work stacked immediately below this branch,
- a GitHub TestFlight workflow that assumes an official Apple Developer/App Store Connect account,
- a separate Android standalone-release draft PR that is still blocked by GitHub-hosted runner availability.

The current iOS TestFlight workflow is not the correct test path for the user's signing setup. The old PWA and iOS-preview feature branches are too stale/diverged to merge safely.

## Goals

- Keep GitHub as the source of truth.
- Produce APK, IPA, and PWA from the same modern source tree.
- Avoid GitHub Actions for primary preview builds.
- Keep Android phone and Android TV behavior controlled by `EXPO_TV`.
- Preserve existing app/provider/catalog/playback architecture.
- Make the APK installable without Metro.
- Make the iOS artifact a real device build packaged as an IPA but intentionally unsigned, so an external signer can re-sign it.
- Make the PWA installable and safe for browser use.
- Keep provider stream URLs and provider secrets out of build artifacts and static web caches.
- Prepare stable application identifiers before any store publication.

## Non-Goals

This slice does not:

- publish to Google Play,
- publish to TestFlight or the App Store,
- create App Store Connect records,
- create Google Play Console records,
- add store billing,
- add Apple TV packaging,
- add direct M3U/Xtream inputs,
- migrate the old PWA or iOS-preview branch,
- add a permanent browser vault for secret provider credentials,
- merge draft PRs whose hosted verification is still unavailable.

## Architecture

### 1. One Source Tree

All three outputs use the same current app:

`apps/mobile-tv`

Platform differences are handled through:

- Expo app configuration,
- platform-specific adapters,
- environment variables,
- build/deploy configuration.

There is no separate web app and no duplicate TV/movie codebase.

### 2. Stable Application IDs

Before public distribution, use the same owned namespace on both mobile platforms:

- Android package: `com.jugentorba.moviestvflix`
- iOS bundle identifier: `com.jugentorba.moviestvflix`

The Android identifier should be changed now, before any Google Play release, because changing a published Android application ID later creates a different Play Store app.

The iOS identifier remains unchanged.

### 3. Build Providers

#### Codemagic

Codemagic is the primary preview builder for native artifacts because it can connect directly to GitHub and does not consume GitHub Actions minutes.

The repository will contain a root `codemagic.yaml` with two explicit workflows:

- `android-preview`
- `ios-resignable-preview`

Each workflow starts from a clean checkout and runs the relevant validation before packaging. Preview workflows set `EXPO_PUBLIC_PREVIEW_MODE=1` so the user can test the local/demo application before cloud accounts and synchronization are implemented.

#### Cloudflare Pages

Cloudflare Pages hosts the PWA directly from the GitHub repository.

The user does not need the ChatGPT Cloudflare connector. The repository will be connected from the Cloudflare dashboard when deployment is ready.

## Android Preview Design

### Output

`MoviesTv-Flix-android-phone-preview.apk`

A separate Android TV artifact may be added using the same workflow with `EXPO_TV=1`, but the immediate phone test artifact is the required first output.

### Build Flow

1. Checkout repository.
2. Install pnpm 11.25 and Node 22.
3. `pnpm install --frozen-lockfile`.
4. Run lint, typecheck, and tests.
5. Set:
   - `NODE_ENV=production`
   - `EXPO_TV=0`
6. Run Expo Android prebuild.
7. Build Release APK.
8. Sign the preview APK with an ephemeral/local preview keystore created inside the build job.
9. Verify:
   - APK exists,
   - `assets/index.android.bundle` exists inside the APK,
   - APK signature verifies,
   - package ID is `com.jugentorba.moviestvflix`.
10. Publish APK as a Codemagic artifact.

### Signing

The preview APK uses a preview/test signing key only.

That key is not the future Google Play upload/app-signing key. Store signing is a separate later slice.

### Failure Rule

The workflow must fail if the JavaScript bundle is absent. This protects against repeating the earlier Metro-dependent debug APK problem.

## iOS Re-signable IPA Design

### Output

`MoviesTv-Flix-ios-resignable-preview.ipa`

### Build Target

The app must be compiled for a physical iPhone device (`iphoneos`), not the simulator.

### Build Flow

1. Checkout repository on a macOS Codemagic worker.
2. Install Node/pnpm dependencies.
3. Run lint, typecheck, and tests.
4. Set `EXPO_TV=0`.
5. Run Expo iOS prebuild.
6. Install CocoaPods.
7. Build Release for generic iOS device with code signing disabled:
   - `CODE_SIGNING_ALLOWED=NO`
   - `CODE_SIGNING_REQUIRED=NO`
   - no Apple team/App Store Connect API key.
8. Locate the resulting `.app`.
9. Validate:
   - bundle identifier,
   - executable exists,
   - app was built for device architecture,
   - no embedded provisioning profile is required.
10. Package:
   - `Payload/MoviesTv-Flix.app`
   - zip as `.ipa`.
11. Publish the IPA as a Codemagic artifact.

### Expected Installation Path

The generated IPA is not expected to install directly.

The user will pass it through the third-party IPA signer they already use. That signer is responsible for injecting the signing identity/provisioning profile needed by the phone.

### TestFlight

The existing TestFlight workflow remains in the repository for a future official Apple Developer account, but it is not used by this preview path.

## PWA Design

### Web Runtime Dependencies

The modern Expo app will add the standard current web dependencies required by Expo web, including:

- `react-dom`,
- `react-native-web`,
- `@expo/metro-runtime`.

The Expo web build uses Metro in `single` output mode and exports a single-page application to `apps/mobile-tv/dist`.

### Web App Configuration

`app.config.ts` gains a web section using Metro with `output: 'single'`, which matches the current React Navigation/App.tsx architecture while preserving native configuration.

The app remains a single Expo entry point.

### PWA Manifest

The web export must contain:

- app name and short name,
- `display: standalone`,
- start URL,
- background/theme colors,
- install icons,
- stable scope.

### Service Worker

A small first-party service worker is registered only on web. Its cache name is versioned per build, and activation removes obsolete app-shell caches so deployments update cleanly.

It may cache:

- the static app shell,
- hashed JS/CSS/assets,
- app icons.

It must not cache:

- provider manifest responses,
- catalog responses,
- resolved playback stream URLs,
- request headers,
- cookies/tokens,
- Supabase auth responses,
- Live TV stream responses.

Dynamic provider/media network traffic stays network-driven.

### Browser Secret Storage

Native currently uses Expo SecureStore for provider secret configuration.

For the first PWA slice:

- non-secret provider metadata/config continues to use the existing normal storage/sync path,
- secret provider fields use a web-only in-memory adapter,
- secret provider values are not written to localStorage, sessionStorage, IndexedDB, the service worker cache, or static assets,
- reloading or closing the web app requires entering secret provider credentials again.

This is intentionally conservative. A persistent encrypted browser vault is a later feature.

### Web Media Behavior

Movie/series/Live TV playback continues to use `expo-video` where supported.

Provider-side browser restrictions such as CORS remain external constraints. The app must show a normal unavailable/error state rather than bypass browser security policy.

## Cloudflare Pages Deployment

Cloudflare Pages connects directly to the GitHub repository. Because this is a single-page application, `public/_redirects` supplies `/* /index.html 200` so deep links resolve to the app instead of returning 404.

Recommended configuration:

- project root: repository root,
- install: `pnpm install --frozen-lockfile`,
- build command: app web export script,
- output directory: `apps/mobile-tv/dist`,
- `EXPO_TV=0`,
- `EXPO_PUBLIC_PREVIEW_MODE=1`.

No Supabase configuration is required for the preview deployment. Authenticated/cloud builds later use the public Supabase URL and publishable client key. No provider secret or private signing credential is placed in Cloudflare public environment variables.

## Build Configuration Files

Expected implementation changes include:

- create `codemagic.yaml`,
- update `apps/mobile-tv/package.json`,
- update `apps/mobile-tv/app.config.ts`,
- add web/PWA bootstrap/service-worker files,
- add platform-specific secret-store adapter,
- add PWA/build tests and verification scripts,
- update lockfile,
- add concise build documentation.

The existing GitHub workflows are not deleted. Codemagic is an additional build path.

## Environment Variables

### Native Preview Builds

Native preview workflows set:

- `EXPO_PUBLIC_PREVIEW_MODE=1`
- `EXPO_TV=0`

Preview mode bypasses Supabase authentication and uses the local/demo catalog plus locally installed providers, allowing APK/IPA UI testing before cloud/account work. Authenticated production builds later use `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

### Forbidden Build Inputs

Do not place in repository or public build variables:

- Supabase service-role key,
- Apple private signing keys for this unsigned IPA flow,
- third-party signer certificate/private key,
- provider passwords/tokens,
- Google Play signing key.

## Verification

### Shared Verification

Before packaging native or web outputs:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

### Android Artifact Verification

Verify:

- file exists,
- ZIP structure is valid,
- `assets/index.android.bundle` is present,
- APK signature verifies,
- application ID is correct.

### iOS Artifact Verification

Verify:

- IPA is a valid ZIP,
- exactly one expected app exists under `Payload/`,
- bundle identifier is correct,
- main executable exists,
- no accidental development provisioning profile is bundled,
- the artifact is explicitly labeled unsigned/re-signable.

### PWA Verification

Verify:

- static export succeeds,
- `index.html` exists,
- manifest is valid,
- service worker is included and registered,
- static assets are referenced correctly,
- no provider secret/stream URL appears in generated static files,
- browser tests cover web secret-store behavior,
- basic installability metadata is present.

## Branch/PR Strategy

This branch is stacked on:

`codex/live-tv-provider-browser-20260917`

The chain is:

1. series/episode PR,
2. Live TV PR #29,
3. platform-build/PWA PR from this branch.

The platform-build PR stays draft until:

- its base feature PRs are integrated or rebased,
- full tests can run on Codemagic/local CI,
- Android artifact verification succeeds,
- unsigned IPA packaging verification succeeds,
- PWA export verification succeeds.

The build branch must not merge the stale historical PWA/iOS branches.

## Error Handling

### Codemagic

A workflow fails immediately when:

- dependency install fails,
- tests/lint/typecheck fail,
- Expo prebuild fails,
- native compilation fails,
- artifact verification fails.

No artifact is published from a failed packaging verification.

### PWA

If the browser lacks a native capability:

- fall back to supported web behavior,
- show a clear app-level error when playback/provider access is unavailable,
- never bypass browser security constraints.

### External Deployment/Signing

Failures in the user's third-party signer or Cloudflare account connection are external to the app build.

The repository will keep reproducible artifacts/config so the build can be rerun after those external issues are corrected.

## Security

- No signing key committed to GitHub.
- No provider secret committed to GitHub.
- No provider secret cached by the PWA service worker.
- No resolved playback URLs stored in PWA static assets.
- Native provider secrets continue to use SecureStore.
- Web provider secret persistence is deliberately limited to session memory in this first slice.

## Acceptance Criteria

The slice is ready for user testing only when all of the following are true:

1. Codemagic can build an installable Android phone APK.
2. The APK includes the production JS bundle and installs without Metro.
3. Codemagic can build an unsigned/re-signable physical-device IPA.
4. The IPA can be handed to an external signer without App Store Connect.
5. Expo web SPA export succeeds from the same branch.
6. The PWA has manifest + service worker + install metadata.
7. Cloudflare Pages can use the repository output without GitHub Actions.
8. Existing movie/series/episode/Live TV behavior remains covered by tests.
9. No provider secret, signing secret, or stream URL is embedded into static build assets.
10. The generated artifact names clearly distinguish Android phone, iOS re-signable, and PWA outputs.
11. Preview APK, re-signed IPA, and PWA open into the local/demo application without requiring Supabase sign-in.
