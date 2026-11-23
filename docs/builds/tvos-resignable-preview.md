# tvOS re-signable preview build

MoviesTv-Flix can build an **unsigned physical-device Apple TV preview** through Codemagic without App Store Connect or an official Apple Developer team.

## One-time Codemagic setup

Use the same repository as the Android and iOS preview workflows:

- repository: `jugentorba/MoviesTv-Flix`
- branch: `main`
- no Supabase environment group is required for this preview

The workflow sets `EXPO_TV=1` and `EXPO_PUBLIC_PREVIEW_MODE=1`. It uses the React Native TV configuration during Expo prebuild and opens in guest-first preview mode after external signing. If no public Supabase values were embedded, the Account settings can save a public Supabase URL/key on-device so sign-in and synchronization can be enabled without rebuilding.

## Build

Start the workflow:

`tvos-resignable-preview`

The workflow:

- installs pnpm 11.25.0 with Node 22 and uses Xcode 26.5,
- runs lint, typecheck, and tests,
- runs a clean Expo iOS prebuild with the TV configuration enabled,
- installs CocoaPods,
- selects the application Xcode scheme rather than a `Pods-*` scheme,
- builds Release for `appletvos` / generic physical tvOS device,
- disables Xcode code signing,
- packages the resulting app under `Payload/MoviesTv-Flix.app`,
- verifies bundle ID `com.jugentorba.moviestvflix`,
- verifies tvOS platform metadata, the 16.4 minimum deployment target, and Apple TV device family,
- verifies the executable contains ARM64,
- verifies no `embedded.mobileprovision` is present,
- verifies no `_CodeSignature` directory is present.

Successful artifacts:

- `MoviesTv-Flix-tvos-resignable-preview.ipa`
- `MoviesTv-Flix-tvos-resignable-preview.ipa.sha256`

## Installation

The IPA is intentionally unsigned and must be re-signed with credentials and a provisioning profile that are valid for the target Apple TV before installation.

The MoviesTv-Flix repository does not store the external signing certificate, private key, provisioning profile, or signer credentials.

## What remains after a successful build

A produced artifact still needs real Apple TV verification. Open
**Settings → Preview diagnostics** first and confirm:

- Platform reports `ios`/the React Native Apple platform runtime.
- Layout reports `tv`.
- Native runtime is detected.
- **Build revision** shows the 12-character Git revision stamped by Codemagic; record it with screenshots.
- Account sync reports the expected guest/configured/signed-in state.

Then verify with the physical Siri Remote:

- launch without Metro,
- D-pad/focus navigation and Back behavior,
- Live TV channel drawer and wrapping previous/next zapping,
- built-in movie/series and Live TV playback,
- preferred audio/subtitle selection,
- account sign-in/synchronization when public Supabase configuration is supplied.

Diagnostics are a runtime aid; the tvOS verifier and real remote/playback tests
remain required evidence.
