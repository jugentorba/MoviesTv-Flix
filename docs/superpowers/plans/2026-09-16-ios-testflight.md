# iOS TestFlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and upload the current MoviesTv-Flix iOS app to TestFlight from GitHub Actions.

**Architecture:** Keep the Expo app source shared with Android. Add a stable iOS bundle identifier in Expo config and a manual `macos-26` GitHub Actions workflow that verifies the workspace, generates native iOS source, installs CocoaPods, archives with Xcode 26+ automatic signing, exports a signed IPA, and uploads it to App Store Connect using an API key stored only in GitHub secrets.

**Tech Stack:** Expo SDK 56, React Native TVOS fork, Xcode 26+, macOS 26 GitHub runner, CocoaPods, GitHub Actions, App Store Connect API key.

**Spec:** `docs/superpowers/specs/2026-09-16-ios-testflight-design.md`

## Global Constraints

- iOS bundle identifier: `com.jugentorba.moviestvflix`.
- Do not change Android package identity or Android workflows.
- Do not commit Apple credentials, certificates, or private keys.
- TestFlight workflow is manual-only.
- Build number is `GITHUB_RUN_NUMBER`.
- App Store uploads use Xcode 26 or later.

---

### Task 1: Stable iOS application identity

**Files:**
- Modify: `apps/mobile-tv/src/__tests__/runtime.test.tsx`
- Modify: `apps/mobile-tv/app.config.ts`

**Interfaces:**
- Produces: Expo config with `expo.ios.bundleIdentifier === 'com.jugentorba.moviestvflix'` and `supportsTablet === true`.

- [x] **Step 1: Write the failing identity assertion**

```ts
import appConfig from '../../app.config';

test('declares the stable iOS application identity', () => {
  expect(appConfig.expo.ios).toEqual(
    expect.objectContaining({
      bundleIdentifier: 'com.jugentorba.moviestvflix',
      supportsTablet: true,
    }),
  );
});
```

- [x] **Step 2: Verify RED**

Expected failure: TypeScript reports that `ios` does not exist on the Expo config.

- [x] **Step 3: Add the iOS config**

```ts
ios: {
  bundleIdentifier: 'com.jugentorba.moviestvflix',
  supportsTablet: true,
},
```

- [x] **Step 4: Run full checks**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

### Task 2: Manual TestFlight workflow

**Files:**
- Create: `.github/workflows/ios-testflight.yml`

**Interfaces:**
- Consumes GitHub secrets: `APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8_BASE64`.
- Produces: signed IPA artifact and uploaded App Store Connect build.

- [x] **Step 1: Add manual macOS 26 workflow**

Use `workflow_dispatch` on `macos-26`. Run frozen install/lint/typecheck/tests, then `expo prebuild --platform ios --no-install` with `EXPO_TV=0`. Run `pod install --repo-update` in `apps/mobile-tv/ios` to create the CocoaPods workspace. Decode the API key with Python into a temporary `.p8` file, discover the generated workspace/scheme, and archive with `CODE_SIGN_STYLE=Automatic`, `DEVELOPMENT_TEAM`, `CURRENT_PROJECT_VERSION=${GITHUB_RUN_NUMBER}`, `MARKETING_VERSION=1.0.0`, `-allowProvisioningUpdates`, and App Store Connect API-key authentication arguments.

- [x] **Step 2: Export signed IPA**

Generate `ExportOptions.plist` with method `app-store-connect`, destination `export`, automatic signing, and the configured team ID. Run `xcodebuild -exportArchive` with the same API-key authentication arguments and upload the resulting IPA as a GitHub artifact.

- [x] **Step 3: Upload to TestFlight**

Generate a second export options plist with destination `upload` and run `xcodebuild -exportArchive` from the same archive. The job fails if App Store Connect upload fails.

- [x] **Step 4: Verify normal CI**

Repository CI passes, and the new iOS workflow remains manual-only until explicitly dispatched.

### Task 3: Signed build handoff

**Files:** none unless build diagnostics require a targeted fix.

- [ ] **Step 1: Configure Apple secrets in GitHub**
- [ ] **Step 2: Ensure App Store Connect has an app record for `com.jugentorba.moviestvflix`**
- [ ] **Step 3: Manually dispatch `iOS TestFlight`**
- [ ] **Step 4: Verify archive, IPA export, and App Store Connect upload all succeed**
- [ ] **Step 5: Confirm the build appears in TestFlight and provide the user the installation path**
