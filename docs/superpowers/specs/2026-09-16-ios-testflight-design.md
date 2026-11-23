# iOS TestFlight Delivery Design

## Goal
Ship the current MoviesTv-Flix mobile app to the user's iPhone through TestFlight without changing Android behavior.

## Approach
Use the existing Expo/React Native app and GitHub Actions. Add a stable iOS bundle identifier (`com.jugentorba.moviestvflix`) and a manual `workflow_dispatch` workflow on a `macos-26` runner so App Store uploads are built with Xcode 26 or later. The workflow verifies the workspace, runs `expo prebuild --platform ios --no-install`, runs CocoaPods explicitly to create the workspace, archives with Xcode automatic signing, exports a signed App Store Connect IPA, and uploads the archive to App Store Connect/TestFlight.

## Apple credentials
No Apple secret is committed to the repository. The workflow reads these GitHub Actions secrets:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`

The App Store Connect API key must be authorized for the app and provisioning/upload operations. The app record in App Store Connect must use bundle ID `com.jugentorba.moviestvflix`.

## Build behavior
- iOS app name remains `MoviesTv-Flix`.
- iPhone/iPad use the regular React Native app, not the TV plugin.
- Build number comes from `GITHUB_RUN_NUMBER` so every TestFlight upload is unique.
- Release version remains `1.0.0` until product versioning is intentionally introduced.
- The workflow is manual-only so missing Apple secrets never break normal CI.
- CocoaPods runs after Expo prebuild because `--no-install` intentionally skips native dependency installation.
- The `.p8` secret is decoded with Python so the workflow is portable on the macOS runner.
- A signed IPA is exported as a GitHub artifact before upload for diagnostics.

## Verification
Before archive: frozen dependency install, lint, TypeScript, and full tests must pass. Archive/export/upload must each complete successfully before the workflow is considered green.
