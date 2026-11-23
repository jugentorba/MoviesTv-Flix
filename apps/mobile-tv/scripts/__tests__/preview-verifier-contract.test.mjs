import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function source(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

execFileSync('python3', [
  join(repoRoot, 'scripts/verify-android-preview-assets.py'),
], { stdio: 'pipe' });

for (const path of [
  'scripts/verify-android-preview.sh',
  'scripts/package-ios-resignable.sh',
  'scripts/verify-ios-resignable.sh',
  'scripts/verify-tvos-resignable.sh',
]) {
  execFileSync('bash', [
    '-n',
    join(repoRoot, path),
  ], { stdio: 'pipe' });
}

const android = source('scripts/verify-android-preview.sh');
const packager = source('scripts/package-ios-resignable.sh');
const ios = source('scripts/verify-ios-resignable.sh');
const tvos = source('scripts/verify-tvos-resignable.sh');
const codemagic = source('codemagic.yaml');
const githubCi = source('.github/workflows/ci.yml');
const githubAndroid = source('.github/workflows/android-preview.yml');
const githubIos = source('.github/workflows/ios-resignable-preview.yml');
const githubTvos = source('.github/workflows/tvos-resignable-preview.yml');
const githubTestflight = source('.github/workflows/ios-testflight.yml');
const mobileTvAppConfig = source('apps/mobile-tv/app.config.ts');
const appUpdate = source('apps/mobile-tv/src/updates/appUpdate.ts');
const updateManifestWriter = source('apps/mobile-tv/scripts/write-update-manifest.mjs');
const updateManifest = JSON.parse(source('apps/mobile-tv/public/updates/latest.json'));

assert.match(android, /android\.permission\.INTERNET/);
assert.match(android, /TARGET.*phone/);
assert.match(android, /leanback-launchable-activity/);
assert.match(android, /feature_state android\.software\.leanback true/);
assert.match(android, /feature_state android\.hardware\.touchscreen false/);
assert.match(android, /feature_state android\.hardware\.faketouch false/);
// A phone APK must not require TV hardware. Optional leanback (required=false)
// is allowed: @lunarr/vlc-player declares it and the APK still installs on a phone.
assert.match(android, /feature_state android\.software\.leanback absent 2>\/dev\/null/);
assert.match(android, /feature_state android\.software\.leanback false 2>\/dev\/null/);
assert.match(android, /Android phone preview requires Android TV hardware/);
assert.match(android, /aapt" dump xmltree/);
assert.match(android, /android:icon/);
assert.match(android, /android:banner/);
assert.match(android, /Unexpected Leanback launcher in Android phone preview/);
assert.doesNotMatch(
  android,
  /unzip\s+-l\s+"\$APK"\s*\|\s*grep\s+-q/,
);
assert.match(android, /APK_ENTRIES=.*unzip -Z1/);
assert.match(android, /test -x "\$BUILD_TOOLS\/zipalign"/);
assert.match(android, /zipalign" -c -P 16 4 "\$APK"/);
assert.match(android, /EXPECTED_SIGNER_SHA256/);
assert.match(android, /EXPECTED_VERSION_CODE/);
assert.match(android, /NORMALIZED_SIGNER_REPORT/);
assert.match(android, /apksigner" verify --print-certs/);

assert.match(packager, /rm -f "\$OUT_ABS"/);
assert.match(packager, /codesign --remove-signature/);
assert.match(packager, /embedded\.mobileprovision/);
assert.match(packager, /_CodeSignature/);
assert.match(packager, /-name '\*\.framework'/);
assert.match(packager, /-name '\*\.appex'/);
assert.match(packager, /-name '\*\.xpc'/);
assert.match(packager, /-name '\*\.dylib'/);
assert.match(packager, /-print0/);
assert.match(packager, /\/usr\/bin\/zip -qry -y/);
assert.ok(
  packager.indexOf('rm -f "$OUT_ABS"')
    < packager.indexOf('/usr/bin/zip -qry -y'),
);
assert.ok(
  packager.indexOf('codesign --remove-signature')
    < packager.indexOf('/usr/bin/zip -qry -y'),
);

assert.match(ios, /DEVICE_FAMILY/);
assert.match(ios, /MINIMUM_OS/);
assert.match(ios, /16\.4/);
assert.match(ios, /grep -q '1'/);
assert.match(ios, /grep -q '2'/);
assert.match(ios, /Unexpected Apple TV device family/);
assert.match(ios, /codesign/);

assert.match(tvos, /DEVICE_FAMILY/);
assert.match(tvos, /MINIMUM_OS/);
assert.match(tvos, /16\.4/);
assert.match(tvos, /grep -q '3'/);
assert.match(tvos, /Unexpected iPhone\/iPad device family in tvOS preview/);
assert.match(tvos, /codesign/);
for (const verifier of [ios, tvos]) {
  assert.doesNotMatch(verifier, /printf[^\n]*\|\s*grep/);
  assert.doesNotMatch(verifier, /lipo[^\n]*\|\s*grep/);
  assert.match(verifier, /ARCH_INFO=.*lipo -info/);
}

assert.equal(
  (codemagic.match(/expo prebuild --platform android --clean --no-install/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/expo prebuild --platform ios --clean --no-install/g) ?? []).length,
  2,
);
assert.match(codemagic, /android-preview:[\s\S]*EXPO_TV: "0"/);
assert.match(codemagic, /android-tv-preview:[\s\S]*EXPO_TV: "1"/);
assert.match(codemagic, /ios-resignable-preview:[\s\S]*EXPO_TV: "0"/);
assert.match(codemagic, /tvos-resignable-preview:[\s\S]*EXPO_TV: "1"/);
assert.equal((codemagic.match(/sha256sum/g) ?? []).length, 0);
assert.equal((codemagic.match(/shasum -a 256/g) ?? []).length, 4);
assert.match(codemagic, /MoviesTv-Flix-android-phone-preview\.apk\.sha256/);
assert.match(codemagic, /MoviesTv-Flix-android-tv-preview\.apk\.sha256/);
assert.match(codemagic, /MoviesTv-Flix-ios-resignable-preview\.ipa\.sha256/);
assert.match(codemagic, /MoviesTv-Flix-tvos-resignable-preview\.ipa\.sha256/);



/* Android preview workflows use the planned mac_mini_m2 instance. */
const androidPhoneWorkflow = codemagic.match(
  /android-preview:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/,
)?.[0] ?? '';
const androidTvWorkflow = codemagic.match(
  /android-tv-preview:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/,
)?.[0] ?? '';
assert.match(androidPhoneWorkflow, /instance_type:\s*mac_mini_m2/);
assert.match(androidTvWorkflow, /instance_type:\s*mac_mini_m2/);


/* macOS Android workflows avoid GNU-only sort -V. */
assert.doesNotMatch(android, /sort -V/);
assert.doesNotMatch(codemagic, /sort -V/);
assert.match(android, /python3/);
assert.match(codemagic, /python3/);


/* preview workflows cache dependencies, never the Android signing key. */
assert.equal((codemagic.match(/cache_paths:/g) ?? []).length, 4);
assert.equal(
  (codemagic.match(/pnpm config set store-dir "\$HOME\/\.pnpm-store"/g) ?? []).length,
  4,
);
assert.equal((codemagic.match(/\$HOME\/\.gradle\/caches/g) ?? []).length, 2);
assert.equal(
  (codemagic.match(/^\s*- \$HOME\/\.moviestv-preview$/gm) ?? []).length,
  0,
);
assert.equal(
  (codemagic.match(/^        - moviestv_preview_signing$/gm) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/KEYSTORE="\$CM_BUILD_DIR\/\.moviestv-preview-signing\.jks"/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/trap 'rm -f "\$ALIGNED" "\$KEYSTORE"' EXIT/g) ?? []).length,
  2,
);
assert.equal((codemagic.match(/base64\.b64decode/g) ?? []).length, 2);
assert.equal(
  (codemagic.match(/os\.environ\["CM_KEYSTORE"\]\.split\(\)/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/Missing CM_KEYSTORE in moviestv_preview_signing/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/Missing CM_KEYSTORE_PASSWORD in moviestv_preview_signing/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/Missing CM_KEY_ALIAS in moviestv_preview_signing/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/Missing CM_KEY_PASSWORD in moviestv_preview_signing/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/--ks-key-alias "\$CM_KEY_ALIAS"/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/--ks-pass "pass:\$CM_KEYSTORE_PASSWORD"/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/--key-pass "pass:\$CM_KEY_PASSWORD"/g) ?? []).length,
  2,
);
assert.equal((codemagic.match(/keytool -genkeypair/g) ?? []).length, 0);
assert.equal((codemagic.match(/previewpass/g) ?? []).length, 0);
assert.doesNotMatch(codemagic, /artifacts\/[^\n]*preview-signing\.jks/);
assert.match(codemagic, /MoviesTv-Flix-android-phone-preview\.apk\.signing\.txt/);
assert.match(codemagic, /MoviesTv-Flix-android-tv-preview\.apk\.signing\.txt/);
assert.equal(
  (codemagic.match(/\$APKSIGNER" verify --print-certs "\$FINAL"/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/\$HOME\/Library\/Caches\/CocoaPods/g) ?? []).length,
  2,
);


/* embedded Codemagic helper scripts remain inside YAML block scalars. */
assert.doesNotMatch(codemagic, /^import os$/m);
assert.doesNotMatch(codemagic, /^root = sys\.argv\[1\]$/m);


/* native preview builds stamp the source revision into the app bundle. */
assert.equal(
  (codemagic.match(/EXPO_PUBLIC_BUILD_SHA="\$\(git rev-parse --short=12 HEAD\)"/g) ?? []).length,
  4,
);


console.log('PASS native preview verifier contracts');


/* native preview workflows stay manual-only so pushes do not spend Actions minutes. */
for (const workflow of [githubAndroid, githubIos, githubTvos, githubTestflight]) {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s{2}push:/);
  assert.doesNotMatch(workflow, /\n\s{2}pull_request:/);
}

console.log('PASS native preview workflows are manual-only');

/*
 * Continuous integration runs on pull requests that touch runtime code, so an
 * unverified change cannot reach main. The path filter keeps docs-only PRs off
 * the metered Actions minutes the previous manual-only rule protected.
 */
assert.match(githubCi, /workflow_dispatch:/);
assert.match(githubCi, /\n\s{2}pull_request:/);
assert.match(githubCi, /\n\s+paths:/);
for (const path of ["'apps/**'", "'packages/**'", "'pnpm-lock.yaml'"]) {
  assert.ok(githubCi.includes(path), `ci.yml should filter on ${path}`);
}
assert.doesNotMatch(githubCi, /\n\s{2}push:/);
assert.match(githubCi, /cancel-in-progress:\s*true/);

console.log('PASS CI verifies pull requests that touch runtime code');

/* Apple preview validation runs on Linux before consuming macOS build minutes. */
for (const workflow of [githubIos, githubTvos]) {
  assert.match(workflow, /verify:\s*\n\s*name: Verify Apple preview source/);
  assert.match(workflow, /verify:[\s\S]*runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /build:[\s\S]*needs:\s*\[verify, metadata\][\s\S]*runs-on:\s*macos-26/);
}
console.log('PASS Apple preview workflows gate macOS builds behind Linux verification');


/* GitHub Android previews stay update-compatible across builds. */
assert.match(
  githubAndroid,
  /KEYSTORE="\$GITHUB_WORKSPACE\/\.github\/keys\/moviestv-preview\.jks"/,
);
assert.doesNotMatch(githubAndroid, /keytool -genkeypair/);
assert.match(
  githubAndroid,
  /ANDROID_VERSION_CODE:\s*\$\{\{ needs\.metadata\.outputs\.build_number \}\}/,
);
assert.match(
  githubAndroid,
  /0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D/,
);
assert.match(githubAndroid, /\$APKSIGNER" verify --print-certs "\$FINAL"/);
assert.match(githubAndroid, /preview\.apk\.signing\.txt/);
assert.match(mobileTvAppConfig, /versionCode:\s*androidVersionCode/);
assert.match(mobileTvAppConfig, /ANDROID_VERSION_CODE/);

console.log('PASS GitHub Android previews keep a stable signer and increasing version code');

for (const workflow of [githubAndroid, githubIos, githubTvos]) {
  assert.match(workflow, /name: Resolve native build number/);
  assert.match(workflow, /date -u \+%s/);
  assert.match(workflow, /1700000000/);
  assert.match(workflow, /2100000000/);
  assert.match(workflow, /needs\.metadata\.outputs\.build_number/);
  assert.match(workflow, /--build "\$BUILD_NUMBER"/);
}
console.log('PASS native workflows use one monotonic build-number scheme');

const androidPackageId = 'com.jugentorba.moviestvflix';
const androidSigner =
  '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D';
assert.match(
  mobileTvAppConfig,
  /package:\s*['"]com\.jugentorba\.moviestvflix['"]/,
);
assert.match(android, /package: name='com\.jugentorba\.moviestvflix'/);
assert.match(appUpdate, new RegExp(androidSigner));
assert.match(updateManifestWriter, new RegExp(androidSigner));
assert.equal(updateManifest.android?.signingCertificateSha256, androidSigner);
assert.equal(updateManifest.androidTv?.signingCertificateSha256, androidSigner);
assert.equal(updateManifest.android?.packageName, androidPackageId);
assert.equal(updateManifest.androidTv?.packageName, androidPackageId);
assert.equal(updateManifest.ios?.bundleIdentifier, androidPackageId);
assert.equal(updateManifest.tvos?.bundleIdentifier, androidPackageId);
assert.match(appUpdate, /entry\.build > currentBuild/);
assert.match(appUpdate, /nativeUpdateIdentityMatches/);
assert.match(mobileTvAppConfig, /GITHUB_RUN_NUMBER/);

console.log('PASS in-app updater uses the same native identity contract');

for (const workflow of [githubAndroid, githubIos, githubTvos]) {
  assert.match(workflow, /preview-latest/);
  assert.match(workflow, /MoviesTv-Flix-update-manifest\.json/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /moviestv-preview-release-publish/);
  assert.match(workflow, /gh release create "\$TAG"[\s\S]*--verify-tag/);
  assert.doesNotMatch(workflow, /git tag -f/);
  assert.doesNotMatch(workflow, /git push origin "refs\/tags\/\$TAG"/);
}
assert.match(githubAndroid, /api\/app-update\/android\.apk/);
assert.match(githubAndroid, /api\/app-update\/android-tv\.apk/);
assert.match(githubIos, /api\/app-update\/ios\.ipa/);
assert.match(githubTvos, /api\/app-update\/tvos\.ipa/);

console.log('PASS native preview workflows publish the persistent update channel');

for (const workflow of [githubAndroid, githubIos, githubTvos]) {
  assert.match(
    workflow,
    /sync-update-manifest-to-main\.sh/,
  );
}

console.log('PASS native publishers sync the fallback manifest back to main');

assert.match(githubAndroid, /target:\s*\n\s*description: Android preview target/);
assert.match(githubAndroid, /- all/);
assert.match(githubAndroid, /- phone/);
assert.match(githubAndroid, /- android-tv/);
assert.match(
  githubAndroid,
  /matrix:\s*\n\s*variant:\s*\$\{\{ fromJSON\(inputs\.target/,
);

assert.match(
  githubAndroid,
  /group:\s*android-preview-\$\{\{ github\.ref \}\}-\$\{\{ inputs\.target \|\| ['"]all['"] \}\}/,
);
console.log('PASS Android phone and TV previews use separate concurrency groups');

console.log('PASS GitHub Android preview workflow supports targeted phone and TV builds');
assert.match(
  githubAndroid,
  /Verify generated Android TV manifest[\s\S]*verify-android-tv-manifest\.py/,
);






/* native preview verifiers enforce HTTP media policy. */
assert.match(android, /android:usesCleartextTraffic/);
assert.match(android, /0xffffffff/);
assert.match(ios, /NSAllowsArbitraryLoadsForMedia/);
assert.match(tvos, /NSAllowsArbitraryLoadsForMedia/);


/* all preview artifacts stamp the Git revision into the Expo bundle. */
assert.equal(
  (codemagic.match(/EXPO_PUBLIC_BUILD_SHA="\$\(git rev-parse --short=12 HEAD\)"/g) ?? []).length,
  4,
);

/* artifact verifiers require the same Git revision to be embedded. */
assert.equal(
  (codemagic.match(/verify-(?:android-preview|ios-resignable|tvos-resignable)\.sh[\s\S]*?"\$\(git rev-parse --short=12 HEAD\)"/g) ?? []).length,
  4,
);
for (const workflow of [githubAndroid, githubIos, githubTvos]) {
  assert.match(
    workflow,
    /verify-(?:android-preview|ios-resignable|tvos-resignable)\.sh[\s\S]*?"\$\(git rev-parse --short=12 HEAD\)"/,
  );
}
for (const verifier of [android, ios, tvos]) {
  assert.match(verifier, /EXPECTED_BUILD_SHA/);
  assert.match(verifier, /grep -aFq "\$EXPECTED_BUILD_SHA"/);
}


/* Apple preview workflows pin the supported Xcode 26.5 image. */
assert.equal((codemagic.match(/xcode:\s*26\.5/g) ?? []).length, 2);
assert.equal((codemagic.match(/xcode:\s*26\.4/g) ?? []).length, 0);


/* Apple re-signable verifiers reject nested provisioning and signature bundles. */
for (const verifier of [ios, tvos]) {
  assert.match(verifier, /find "\$APP" -name 'embedded\.mobileprovision'/);
  assert.match(verifier, /find "\$APP" -type d -name '_CodeSignature'/);
  assert.match(verifier, /find "\$APP" -type f -name 'main\.jsbundle'/);
  assert.match(verifier, /test -s "\$JS_BUNDLE"/);
  assert.match(verifier, /-mindepth 1/);
  assert.match(verifier, /-name '\*\.framework'/);
  assert.match(verifier, /-name '\*\.appex'/);
  assert.match(verifier, /-name '\*\.xpc'/);
  assert.match(verifier, /-name '\*\.dylib'/);
  assert.match(verifier, /-print0/);
  assert.match(verifier, /Unexpected nested code signature/);
}


/* Apple preview workflows resolve the app shared scheme from the generated project. */
assert.equal(
  (codemagic.match(/xcshareddata\/xcschemes/g) ?? []).length,
  2,
);
assert.equal(
  (codemagic.match(/xcodebuild -workspace "\$WORKSPACE" -list -json/g) ?? []).length,
  0,
);


/* manual GitHub Apple build commands remain explicit multiline shell. */
assert.match(
  githubIos,
  /xcodebuild \\\n\s+-workspace "\$WORKSPACE"/,
);
assert.match(
  githubIos,
  /bash scripts\/package-ios-resignable\.sh \\\n\s+"\$APP"/,
);

/* TestFlight uses the same pinned Xcode toolchain as preview builds. */
assert.match(githubTestflight, /runs-on:\s*macos-26/);
assert.match(
  githubTestflight,
  /xcode-select -s "\/Applications\/Xcode_26\.5\.app\/Contents\/Developer"/,
);
assert.match(
  githubTestflight,
  /CURRENT_PROJECT_VERSION="\$GITHUB_RUN_NUMBER\.\$GITHUB_RUN_ATTEMPT"/,
);
assert.match(
  githubTestflight,
  /EXPO_PUBLIC_SUPABASE_URL:\s*\$\{\{ vars\.EXPO_PUBLIC_SUPABASE_URL \}\}/,
);
assert.match(
  githubTestflight,
  /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{ vars\.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY \}\}/,
);
assert.match(
  githubTestflight,
  /EXPO_PUBLIC_BUILD_SHA="\$\(git rev-parse --short=12 HEAD\)"/,
);

assert.match(
  githubTestflight,
  /verify:\s*\n\s*name: Verify iOS release source and secrets[\s\S]*runs-on:\s*ubuntu-latest/,
);
assert.match(
  githubTestflight,
  /build-and-upload:[\s\S]*needs:\s*verify[\s\S]*runs-on:\s*macos-26/,
);


/* manual GitHub Apple previews also use the app shared scheme. */
for (const workflow of [githubIos, githubTvos]) {
  assert.match(workflow, /xcshareddata\/xcschemes/);
  assert.doesNotMatch(
    workflow,
    /xcodebuild -workspace "\$WORKSPACE" -list -json/,
  );
}


/* manual preview workflows stamp revisions and publish checksums. */
for (const workflow of [githubAndroid, githubIos, githubTvos]) {
  assert.match(
    workflow,
    /EXPO_PUBLIC_BUILD_SHA="\$\(git rev-parse --short=12 HEAD\)"/,
  );
  assert.match(workflow, /shasum -a 256|sha256sum/);
  assert.match(workflow, /\.sha256/);
}


/* manual GitHub Apple previews run on macOS 26 with Xcode 26.5. */
for (const workflow of [githubIos, githubTvos]) {
  assert.match(workflow, /runs-on:\s*macos-26/);
  assert.match(
    workflow,
    /xcode-select -s "\/Applications\/Xcode_26\.5\.app\/Contents\/Developer"/,
  );
  assert.doesNotMatch(workflow, /runs-on:\s*macos-15/);
}


/* Apple Codemagic previews pin Xcode 26.5 to match manual GitHub previews. */
const iosWorkflow = codemagic.match(
  /ios-resignable-preview:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/,
)?.[0] ?? '';
const tvosWorkflow = codemagic.match(
  /tvos-resignable-preview:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/,
)?.[0] ?? '';
for (const workflow of [iosWorkflow, tvosWorkflow]) {
  assert.match(workflow, /xcode:\s*26\.5/);
  assert.doesNotMatch(workflow, /xcode:\s*latest/);
}
