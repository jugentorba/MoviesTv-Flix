# Android preview builds

MoviesTv-Flix uses Codemagic for standalone Android phone and Android TV previews while GitHub Actions is unavailable.

## One-time Codemagic setup

1. Sign in to Codemagic and add the GitHub repository `jugentorba/MoviesTv-Flix`.
2. Select branch `main`.
3. Ask Codemagic to check/rescan the repository-root `codemagic.yaml`.
4. Create one encrypted environment-variable group named `moviestv_preview_signing`. Add `CM_KEYSTORE` (the preview keystore encoded as base64), `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, and `CM_KEY_PASSWORD`. Use the same group for both Android workflows so phone and TV previews keep a stable signer across future builds.
5. Keep an offline/private backup of the preview keystore and its passwords. The workflow deliberately does not generate or cache a signing key because dependency caches can expire or be cleared.
6. The workflow sets `EXPO_PUBLIC_PREVIEW_MODE=1`, so the app opens directly in guest mode without a Supabase sign-in gate. If no public Supabase values were embedded, **Settings → Account → Manual sync setup** can save a public Supabase URL/key on the device and enable the normal sign-in/create-account flow without rebuilding. No catalog is bundled by default; users add catalog manifests through Settings → Sources → Catalogs. Demo fixtures are only enabled with `EXPO_PUBLIC_DEMO_CATALOG=1`.
7. Do not add a Supabase service-role key, provider token, Apple credential, or Google Play production signing credential.

## Build

For an Android phone, start:

`android-preview`

For Android TV, start:

`android-tv-preview`

Both workflows:

- install pnpm 11.25.0 with Node 22,
- run lint, typecheck, and tests,
- run a clean Expo prebuild with the correct form factor:
  - phone: `EXPO_TV=0`
  - Android TV: `EXPO_TV=1`,
- build a Release APK,
- zip-align it,
- decode the encrypted preview-only keystore only for the build,
- sign it with the persistent preview identity,
- publish a non-secret signing-certificate report for fingerprint comparison,
- remove the decoded keystore before artifact publication,
- verify the APK signature,
- verify package `com.jugentorba.moviestvflix`,
- verify `assets/index.android.bundle` is embedded.

The Android TV prebuild now explicitly sets the TV config plugin to TV mode
with Android TV required. The verifier therefore requires a Leanback launcher,
requires the `android.software.leanback` feature (not merely optional TV
support), and requires both touchscreen and faketouch hardware to be marked
not required.
Preview launcher artwork is checked in and wired through the TV config plugin:
the APK verifier requires both the compiled app icon and Android TV banner
references. Final store artwork polish and real-remote QA remain separate
release checks.

Successful artifacts:

- phone: `MoviesTv-Flix-android-phone-preview.apk`
- phone checksum: `MoviesTv-Flix-android-phone-preview.apk.sha256`
- phone signing certificate report: `MoviesTv-Flix-android-phone-preview.apk.signing.txt`
- Android TV: `MoviesTv-Flix-android-tv-preview.apk`
- Android TV checksum: `MoviesTv-Flix-android-tv-preview.apk.sha256`
- Android TV signing certificate report: `MoviesTv-Flix-android-tv-preview.apk.signing.txt`

## Device QA

Every preview build exposes **Settings → Preview diagnostics**.

On an Android phone, confirm:

- Platform reports `android`.
- Layout is `phone` or `tablet` as appropriate for the device.
- Native runtime reports available.
- **Build revision** shows the 12-character Git revision stamped by Codemagic; record it with screenshots.
- Movies/Series playback, preferred audio/subtitles, background/foreground recovery, and account setup behave normally.

On Android TV, confirm:

- Platform reports `android`.
- Layout reports `tv`.
- D-pad focus, Back, player/channel drawer, previous/next zapping, favorites, and Live TV playback work with the physical remote.

Diagnostics are source/runtime checks only. The APK signature, embedded bundle,
Leanback manifest, icon/banner, and install-without-Metro items must still be
verified from the built artifact.

## Installing

Download the APK from the completed Codemagic build and sideload it on the matching Android phone or Android TV device.

Both Android workflows use the same persistent preview signing identity from the encrypted `moviestv_preview_signing` group. Before installing an update, compare the certificate fingerprint in the new `.apk.signing.txt` artifact with the previous build. Matching fingerprints are required for Android to accept an in-place update.

If the preview keystore is intentionally replaced, Android will reject the new APK as an update to the old preview. Uninstall the old preview once before installing the newly signed build.

The preview key is **not** the future Google Play upload/app-signing key. Store signing will be configured separately before Play Store publication.
