# iOS re-signable preview build

MoviesTv-Flix uses Codemagic to compile an **unsigned physical-device iPhone build** without App Store Connect or an official Apple Developer team.

## One-time Codemagic setup

Use the same repository described for Android:

- repository: `jugentorba/MoviesTv-Flix`
- branch: `main`
- no Supabase environment group is required for this preview

The workflow sets `EXPO_PUBLIC_PREVIEW_MODE=1`, so the re-signable IPA opens directly in guest mode after it is externally signed. If no public Supabase values were embedded, **Settings → Account → Manual sync setup** can save a public Supabase URL/key on the iPhone and enable the normal sign-in/create-account flow without rebuilding. No catalog is bundled by default; users add catalog manifests through Settings → Sources → Catalogs. Demo fixtures require `EXPO_PUBLIC_DEMO_CATALOG=1`. No Apple certificate, provisioning profile, App Store Connect key, third-party signer credential, or provider secret is required by this workflow.

## Build

Start the workflow:

`ios-resignable-preview`

The workflow:

- installs pnpm 11.25.0 with Node 22 and uses Xcode 26.5,
- runs lint, typecheck, and tests,
- runs a clean Expo iOS prebuild with `EXPO_TV=0` and guest-first preview mode enabled,
- installs CocoaPods,
- builds Release for `iphoneos` / generic physical iOS device,
- disables Xcode code signing,
- packages the resulting app under `Payload/MoviesTv-Flix.app`,
- verifies bundle ID `com.jugentorba.moviestvflix`,
- verifies the executable contains ARM64,
- verifies no `embedded.mobileprovision` is present,
- verifies no `_CodeSignature` directory is present.

Successful artifacts:

- `MoviesTv-Flix-ios-resignable-preview.ipa`
- `MoviesTv-Flix-ios-resignable-preview.ipa.sha256`

## Device QA after external signing

The preview app exposes **Settings → Preview diagnostics**. On the physical
iPhone/iPad, confirm:

- Platform reports `ios`.
- Layout reports `phone` or `tablet` as appropriate.
- Native runtime is detected.
- **Build revision** shows the 12-character Git revision stamped by Codemagic; record it with screenshots.
- Account sync reports either guest mode or the expected configured/signed-in state.
- Movie/series HLS playback exposes the preferred late-arriving audio/subtitle tracks.
- Backgrounding pauses native playback and foregrounding resumes only when playback was active.
- Provider failures show safe generic diagnostics rather than signed URLs/tokens.

These runtime checks do not replace the IPA verifier or external signing proof.

## Installation

This IPA is intentionally **unsigned** and is **not expected to install directly** on an iPhone.

Pass the IPA to the third-party IPA signer/certificate service you already use. That service is responsible for injecting the certificate/signature and provisioning profile accepted by your phone.

The MoviesTv-Flix build workflow does not receive or store that signer certificate/private key.

## What this workflow does not do

- no TestFlight upload,
- no App Store upload,
- no App Store Connect authentication,
- no Apple Developer team provisioning,
- no automatic device registration.

If the external signer rejects the IPA or its certificate/profile expires, that is a signing-service issue rather than an app compilation issue. The original re-signable IPA can be rebuilt from `main`.
