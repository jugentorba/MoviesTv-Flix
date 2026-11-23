# APK + Re-signable IPA + PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a standalone Android phone APK, an unsigned/re-signable physical-device iOS IPA, and an installable PWA from the current MoviesTv-Flix source tree without depending on GitHub Actions.

**Architecture:** Keep `apps/mobile-tv` as the single Expo application. Add web-safe runtime adapters and PWA assets inside that app, add deterministic artifact-verification scripts, and add root `codemagic.yaml` workflows that prebuild native projects on demand. Cloudflare Pages consumes the same Expo single-page web export directly from GitHub.

**Tech Stack:** Expo SDK 56, React Native TVOS 0.85, React 19.2, pnpm 11.25, Node 22, Jest, TypeScript 5.9, Codemagic YAML, Xcode/CocoaPods, Android Gradle tooling, Expo web/Metro, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-09-18-platform-builds-pwa-design.md`

> **Execution adjustment (2026-09-18):** Preview artifacts now set `EXPO_PUBLIC_PREVIEW_MODE=1`. This intentionally bypasses Supabase authentication so the user can test the local/demo UI before cloud/profile work. The preview Codemagic and Cloudflare paths therefore do not require a Supabase environment group.

## Global Constraints

- Keep GitHub as the source of truth.
- Base this work on `codex/live-tv-provider-browser-20260917`.
- Do not merge or revive stale `feature/pwa-web-support` or `feature/ios-native-preview` branches.
- Android application ID: `com.jugentorba.moviestvflix`.
- iOS bundle ID: `com.jugentorba.moviestvflix`.
- Native preview builds use `EXPO_TV=0`.
- APK must contain `assets/index.android.bundle` and must not require Metro.
- iOS output must target physical devices and be intentionally unsigned/re-signable.
- Do not require App Store Connect or an Apple Developer team for the preview IPA workflow.
- PWA static output directory: `apps/mobile-tv/dist`.
- PWA must not persist provider secrets to localStorage, sessionStorage, IndexedDB, or service-worker caches.
- Service worker may cache only the first-party static app shell/assets; it must not cache provider/API/media requests.
- Preview builds set `EXPO_PUBLIC_PREVIEW_MODE=1` and require no Supabase credentials; later authenticated builds may use the public Supabase URL and publishable key.
- Never commit provider passwords/tokens, Apple/private signer credentials, Supabase service-role keys, or Google Play signing keys.
- Existing GitHub Actions workflows remain intact; Codemagic is an additional build path.
- Full artifact success claims require fresh verification of the produced APK/IPA/PWA, not only source-level tests.

---

### Task 1: Lock stable app IDs and install release/web build dependencies

**Files:**
- Modify: `apps/mobile-tv/app.config.ts`
- Modify: `apps/mobile-tv/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/mobile-tv/src/__tests__/app-config.test.ts`

**Interfaces:**
- Consumes: current Expo config and `babel.config.js`.
- Produces: Android package `com.jugentorba.moviestvflix`, unchanged iOS bundle ID, Expo web configuration, direct `babel-preset-expo` dependency, and Expo-compatible web dependencies.

- [ ] **Step 1: Write the failing app-config test**

Create `apps/mobile-tv/src/__tests__/app-config.test.ts`:

```ts
import appConfig from '../../app.config';

test('uses stable MoviesTv-Flix mobile identifiers', () => {
  expect(appConfig.expo.android?.package).toBe('com.jugentorba.moviestvflix');
  expect(appConfig.expo.ios?.bundleIdentifier).toBe('com.jugentorba.moviestvflix');
});

test('exports web as a Metro single-page app', () => {
  expect(appConfig.expo.web).toEqual(expect.objectContaining({
    bundler: 'metro',
    output: 'single',
  }));
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/__tests__/app-config.test.ts
```

Expected: FAIL because Android still uses `com.anonymous.moviestvflix` and `expo.web` is absent.

- [ ] **Step 3: Update `app.config.ts` minimally**

Use:

```ts
export default {
  expo: {
    name: 'MoviesTv-Flix',
    slug: 'moviestv-flix',
    scheme: 'moviestvflix',
    android: {
      package: 'com.jugentorba.moviestvflix',
    },
    ios: {
      bundleIdentifier: 'com.jugentorba.moviestvflix',
      supportsTablet: true,
    },
    web: {
      bundler: 'metro',
      output: 'single',
    },
    plugins: process.env.EXPO_TV === '1' ? ['@react-native-tvos/config-tv'] : [],
  },
};
```

- [ ] **Step 4: Install Expo-compatible web dependencies and the release Babel preset**

Run from repository root:

```bash
pnpm --filter @moviestv/mobile-tv exec expo install react-dom react-native-web @expo/metro-runtime --pnpm
pnpm --filter @moviestv/mobile-tv add -D babel-preset-expo@56.0.20
```

Then confirm `apps/mobile-tv/package.json` contains:
- `react-dom`
- `react-native-web`
- `@expo/metro-runtime`
- devDependency `babel-preset-expo: "56.0.20"`

The Expo install command chooses SDK-56-compatible versions for the web packages and updates `pnpm-lock.yaml`.

- [ ] **Step 5: Add explicit web scripts**

Add to `apps/mobile-tv/package.json` scripts:

```json
{
  "export:web": "expo export --platform web --output-dir dist",
  "verify:web": "node scripts/verify-web-export.mjs dist"
}
```

Keep existing `start`, `test`, and `typecheck` scripts unchanged.

- [ ] **Step 6: Run the focused test and typecheck**

Run:

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/__tests__/app-config.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add apps/mobile-tv/app.config.ts apps/mobile-tv/package.json apps/mobile-tv/src/__tests__/app-config.test.ts pnpm-lock.yaml
git commit -m "build: prepare modern Expo platform targets"
```

---

### Task 2: Add web-only ephemeral provider-secret storage

**Files:**
- Create: `apps/mobile-tv/src/addons/createAddonSecretAdapter.ts`
- Create: `apps/mobile-tv/src/addons/__tests__/create-addon-secret-adapter.test.ts`
- Modify: `apps/mobile-tv/src/app/AppRoot.tsx`

**Interfaces:**
- Consumes: `SecureStoreAdapter` and native Expo SecureStore.
- Produces: `createAddonSecretAdapter(platform: string, nativeStore: SecureStoreAdapter): SecureStoreAdapter`.
- Web implementation stores secrets only in an in-memory `Map<string, string>` for the page lifetime.
- Native implementation returns the passed SecureStore adapter unchanged.

- [ ] **Step 1: Write failing storage-selection tests**

Create:

```ts
import type { SecureStoreAdapter } from '../SecureAddonSecretStore';
import { createAddonSecretAdapter } from '../createAddonSecretAdapter';

function memoryNative(): SecureStoreAdapter {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

test('native platforms use the supplied secure store', async () => {
  const native = memoryNative();
  const selected = createAddonSecretAdapter('ios', native);
  expect(selected).toBe(native);
});

test('web secrets stay in memory and do not use native storage', async () => {
  const native: SecureStoreAdapter = {
    getItemAsync: jest.fn(async () => null),
    setItemAsync: jest.fn(async () => undefined),
    deleteItemAsync: jest.fn(async () => undefined),
  };
  const web = createAddonSecretAdapter('web', native);

  await web.setItemAsync('token', 'secret');
  expect(await web.getItemAsync('token')).toBe('secret');
  await web.deleteItemAsync('token');
  expect(await web.getItemAsync('token')).toBeNull();

  expect(native.setItemAsync).not.toHaveBeenCalled();
  expect(native.getItemAsync).not.toHaveBeenCalled();
  expect(native.deleteItemAsync).not.toHaveBeenCalled();
});

test('separate web adapter instances do not persist values', async () => {
  const native = memoryNative();
  const first = createAddonSecretAdapter('web', native);
  await first.setItemAsync('token', 'secret');

  const second = createAddonSecretAdapter('web', native);
  expect(await second.getItemAsync('token')).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/addons/__tests__/create-addon-secret-adapter.test.ts
```

Expected: FAIL because `createAddonSecretAdapter` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Create `createAddonSecretAdapter.ts`:

```ts
import type { SecureStoreAdapter } from './SecureAddonSecretStore';

function ephemeralMemoryStore(): SecureStoreAdapter {
  const values = new Map<string, string>();
  return {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

export function createAddonSecretAdapter(
  platform: string,
  nativeStore: SecureStoreAdapter,
): SecureStoreAdapter {
  return platform === 'web' ? ephemeralMemoryStore() : nativeStore;
}
```

- [ ] **Step 4: Wire the selected adapter into `AppRoot`**

Import `Platform` from `react-native` and `createAddonSecretAdapter`.

Inside `ConfiguredApp` create:

```ts
const addonSecretStore = useMemo(
  () => createAddonSecretAdapter(Platform.OS, SecureStore),
  [],
);
```

Pass:

```tsx
<AddonRuntimeProvider
  metadataStore={preferenceStore}
  secureStore={addonSecretStore}
  supabase={supabase}
  userId={auth.session.userId}
>
```

Do not change preference or Supabase auth storage in this task.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/addons/__tests__/create-addon-secret-adapter.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/mobile-tv/src/addons/createAddonSecretAdapter.ts apps/mobile-tv/src/addons/__tests__/create-addon-secret-adapter.test.ts apps/mobile-tv/src/app/AppRoot.tsx
git commit -m "feat: keep web provider secrets ephemeral"
```

---

### Task 3: Add PWA manifest, service worker, and safe registration

**Files:**
- Create: `apps/mobile-tv/src/web/registerPwa.ts`
- Create: `apps/mobile-tv/src/web/__tests__/register-pwa.test.ts`
- Modify: `apps/mobile-tv/App.tsx`
- Create: `apps/mobile-tv/public/manifest.webmanifest`
- Create: `apps/mobile-tv/public/service-worker.js`
- Create: `apps/mobile-tv/public/icon-192.png`
- Create: `apps/mobile-tv/public/icon-512.png`

**Interfaces:**
- Produces: `registerPwa(environment?: { document?: Document; navigator?: Navigator }): void`.
- Registration adds one manifest link and one theme-color meta tag, then registers `/service-worker.js` when service workers are available.
- Service worker cache name is versioned and stores only same-origin app-shell/static destinations.

- [ ] **Step 1: Write failing registration tests**

Create a jsdom-compatible test that injects a minimal fake document/navigator rather than relying on a real browser:

```ts
import { registerPwa } from '../registerPwa';

test('registers manifest metadata and service worker once', () => {
  const appended: Array<{ rel?: string; href?: string; name?: string; content?: string }> = [];
  const register = jest.fn(async () => undefined);
  const document = {
    head: { appendChild: (node: unknown) => { appended.push(node as never); } },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => null,
  } as unknown as Document;
  const navigator = { serviceWorker: { register } } as unknown as Navigator;

  registerPwa({ document, navigator });

  expect(appended.some((item) => item.rel === 'manifest' && item.href === '/manifest.webmanifest')).toBe(true);
  expect(register).toHaveBeenCalledWith('/service-worker.js');
});

test('is a no-op when browser globals are unavailable', () => {
  expect(() => registerPwa({})).not.toThrow();
});
```

The implementation may use a small typed helper around `createElement` so the fake test object remains minimal.

- [ ] **Step 2: Run the test and confirm RED**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/web/__tests__/register-pwa.test.ts
```

Expected: FAIL because `registerPwa` does not exist.

- [ ] **Step 3: Implement browser registration**

`registerPwa.ts` must:
- return immediately without a document,
- append `<link rel="manifest" href="/manifest.webmanifest">` only if no manifest link exists,
- append `<meta name="theme-color" content="#09090b">` only if absent,
- call `navigator.serviceWorker.register('/service-worker.js')` when available,
- catch registration failure so PWA registration never crashes the React app.

- [ ] **Step 4: Register from the existing Expo entry**

Change `App.tsx` to:

```ts
import { Platform } from 'react-native';
import AppRoot from './src/app/AppRoot';
import { registerPwa } from './src/web/registerPwa';

if (Platform.OS === 'web') registerPwa();

export default AppRoot;
```

- [ ] **Step 5: Add the web manifest**

Create `public/manifest.webmanifest`:

```json
{
  "name": "MoviesTv-Flix",
  "short_name": "MoviesTv-Flix",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#09090b",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Generate deterministic 192×192 and 512×512 PNG preview icons from the same simple MoviesTv-Flix monogram. They are temporary product assets for installation/testing, not a final branding redesign.

- [ ] **Step 6: Add a static-only service worker**

Create `public/service-worker.js` with:

```js
const CACHE = 'moviestv-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('moviestv-shell-') && key !== CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const cacheableDestination = ['script', 'style', 'image', 'font'].includes(request.destination);
  if (!cacheableDestination) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response.ok) return response;
      const copy = response.clone();
      void caches.open(CACHE).then((cache) => cache.put(request, copy));
      return response;
    })),
  );
});
```

Do not add fetch interception for `document`, `video`, empty destination/XHR/fetch, or cross-origin requests.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand src/web/__tests__/register-pwa.test.ts
pnpm --filter @moviestv/mobile-tv typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/mobile-tv/App.tsx apps/mobile-tv/src/web apps/mobile-tv/public
git commit -m "feat: add safe PWA shell"
```

---

### Task 4: Add web-export verification

**Files:**
- Create: `apps/mobile-tv/scripts/verify-web-export.mjs`
- Create: `apps/mobile-tv/scripts/__tests__/verify-web-export.test.mjs`
- Modify: `apps/mobile-tv/package.json` only if Task 1 did not already add `verify:web`.

**Interfaces:**
- Produces: CLI `node scripts/verify-web-export.mjs <dist-dir>`.
- Exit 0 only when required PWA files exist and forbidden secret/stream markers are absent.
- Export verifier must not attempt network access.

- [ ] **Step 1: Write a failing verifier test**

The test creates a temporary directory with:
- `index.html`,
- `manifest.webmanifest`,
- `service-worker.js`,
- at least one JS asset.

Test these behaviors:
1. valid fixture exits successfully,
2. missing manifest fails,
3. generated file containing `SUPABASE_SERVICE_ROLE_KEY` fails,
4. generated file containing a known fixture stream URL such as `https://secret-stream.invalid/live.m3u8` fails.

Use Node `assert`, `fs.mkdtempSync`, and `child_process.spawnSync`; no Jest dependency is required for this script-level test.

- [ ] **Step 2: Run the script test and confirm RED**

```bash
node apps/mobile-tv/scripts/__tests__/verify-web-export.test.mjs
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement `verify-web-export.mjs`**

The verifier must:
- require `index.html`, `manifest.webmanifest`, `service-worker.js`, `_redirects`,
- parse the manifest as JSON,
- assert `display === 'standalone'`,
- assert 192 and 512 icon entries,
- walk generated text files (`.html`, `.js`, `.json`, `.css`, `.map` if present),
- reject exact forbidden markers:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `BEGIN PRIVATE KEY`
  - `APPLE_TEAM_ID`
  - `secret-stream.invalid`
- print a concise verification summary and exit 0.

Do not reject the legitimate public variable names `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

- [ ] **Step 4: Run the verifier unit test**

```bash
node apps/mobile-tv/scripts/__tests__/verify-web-export.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run a real Expo web export**

With non-secret test public configuration:

```bash
EXPO_TV=0 EXPO_PUBLIC_PREVIEW_MODE=1 pnpm --filter @moviestv/mobile-tv export:web
pnpm --filter @moviestv/mobile-tv verify:web
```

Expected:
- `apps/mobile-tv/dist/index.html` exists,
- manifest/service worker/icons are copied,
- verifier exits 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/mobile-tv/scripts apps/mobile-tv/package.json
git commit -m "test: verify static PWA export"
```

Do not commit `apps/mobile-tv/dist`.

---

### Task 5: Add Android standalone preview workflow and APK verifier

**Files:**
- Create: `scripts/verify-android-preview.sh`
- Create/Modify: `codemagic.yaml`
- Create: `docs/builds/android-preview.md`

**Interfaces:**
- Produces: Codemagic workflow ID `android-preview`.
- Produces artifact `artifacts/android/MoviesTv-Flix-android-phone-preview.apk`.
- Produces verifier CLI `scripts/verify-android-preview.sh <apk>`.

- [ ] **Step 1: Write the APK verifier first**

Create `scripts/verify-android-preview.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

APK="${1:?usage: verify-android-preview.sh <apk>}"
test -f "$APK"
test -n "${ANDROID_SDK_ROOT:-}"
BUILD_TOOLS="$(find "$ANDROID_SDK_ROOT/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
test -x "$BUILD_TOOLS/apksigner"
test -x "$BUILD_TOOLS/aapt"

unzip -t "$APK" >/dev/null
unzip -l "$APK" | grep -q 'assets/index.android.bundle'
"$BUILD_TOOLS/apksigner" verify --verbose "$APK" >/dev/null

BADGING="$("$BUILD_TOOLS/aapt" dump badging "$APK")"
grep -q "package: name='com.jugentorba.moviestvflix'" <<<"$BADGING"

echo "Android preview verified: $APK"
```

- [ ] **Step 2: Confirm verifier fails on an invalid fixture**

```bash
tmp="$(mktemp)"
printf 'not-an-apk' > "$tmp"
if scripts/verify-android-preview.sh "$tmp"; then
  echo "verifier unexpectedly accepted invalid APK" >&2
  exit 1
fi
rm -f "$tmp"
```

Expected: the verifier rejects the file.

- [ ] **Step 3: Add `android-preview` to root `codemagic.yaml`**

Use a free-compatible `mac_mini_m2` worker so the configuration does not depend on paid Linux instance types.

Workflow structure:

```yaml
workflows:
  android-preview:
    name: Android phone preview APK
    instance_type: mac_mini_m2
    max_build_duration: 90
    environment:
      node: 22
      java: 17
      vars:
        EXPO_TV: "0"
        EXPO_PUBLIC_PREVIEW_MODE: "1"
    scripts:
      - name: Enable pnpm
        script: |
          corepack enable
          corepack prepare pnpm@11.25.0 --activate
      - name: Install dependencies
        script: pnpm install --frozen-lockfile
      - name: Verify source
        script: |
          pnpm lint
          pnpm typecheck
          pnpm test
      - name: Generate Android project
        script: pnpm --filter @moviestv/mobile-tv exec expo prebuild --platform android --no-install
      - name: Configure Android SDK
        script: echo "sdk.dir=$ANDROID_SDK_ROOT" > apps/mobile-tv/android/local.properties
      - name: Build release APK
        script: |
          cd apps/mobile-tv/android
          ./gradlew assembleRelease --no-daemon
      - name: Name and verify APK
        script: |
          mkdir -p artifacts/android
          cp apps/mobile-tv/android/app/build/outputs/apk/release/app-release.apk             artifacts/android/MoviesTv-Flix-android-phone-preview.apk
          scripts/verify-android-preview.sh artifacts/android/MoviesTv-Flix-android-phone-preview.apk
    artifacts:
      - artifacts/android/MoviesTv-Flix-android-phone-preview.apk
```

If Codemagic's image already supplies Java and rejects `java: 17` as an environment key, remove only that YAML key and verify `java -version` in a script; do not change Gradle source to work around the image.

- [ ] **Step 4: Document the Codemagic Android setup**

`docs/builds/android-preview.md` must state:
- connect `jugentorba/MoviesTv-Flix` in Codemagic,
- select the branch,
- rescan `codemagic.yaml`,
- no Codemagic environment group is required for the cloudless preview workflows,
- run `android-preview`,
- download `MoviesTv-Flix-android-phone-preview.apk`,
- this preview key is not the future Play Store signing key,
- each preview build uses a fresh temporary key, so an older preview may need to be uninstalled before installing a newly built APK.

- [ ] **Step 5: Validate YAML structure locally**

Use a YAML parser available in the environment, for example:

```bash
python3 - <<'PY'
import yaml
with open('codemagic.yaml', encoding='utf-8') as f:
    data = yaml.safe_load(f)
assert 'android-preview' in data['workflows']
PY
```

If PyYAML is unavailable, use Ruby's standard YAML parser:

```bash
ruby -e 'require "yaml"; x=YAML.load_file("codemagic.yaml"); abort unless x.dig("workflows","android-preview")'
```

- [ ] **Step 6: Commit Task 5**

```bash
git add codemagic.yaml scripts/verify-android-preview.sh docs/builds/android-preview.md
git commit -m "build: add Codemagic Android preview"
```

The task is source-complete here, but the APK is not declared successful until Codemagic runs and the verifier passes on the produced artifact.

---

### Task 6: Add unsigned physical-device iOS IPA workflow and verifier

**Files:**
- Modify: `codemagic.yaml`
- Create: `scripts/package-ios-resignable.sh`
- Create: `scripts/verify-ios-resignable.sh`
- Create: `docs/builds/ios-resignable-preview.md`

**Interfaces:**
- Produces Codemagic workflow ID `ios-resignable-preview`.
- Produces `artifacts/ios/MoviesTv-Flix-ios-resignable-preview.ipa`.
- `package-ios-resignable.sh <app-path> <output-ipa>` packages exactly one app under `Payload/`.
- `verify-ios-resignable.sh <ipa>` validates structure/bundle/executable/no provisioning profile.

- [ ] **Step 1: Write the package and verifier scripts before the workflow**

`package-ios-resignable.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
APP="${1:?usage: package-ios-resignable.sh <app> <output-ipa>}"
OUT="${2:?usage: package-ios-resignable.sh <app> <output-ipa>}"

test -d "$APP"
OUT_ABS="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/Payload" "$(dirname "$OUT_ABS")"
cp -R "$APP" "$WORK/Payload/MoviesTv-Flix.app"
(
  cd "$WORK"
  /usr/bin/zip -qry "$OUT_ABS" Payload
)
```

`verify-ios-resignable.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
IPA="${1:?usage: verify-ios-resignable.sh <ipa>}"
test -f "$IPA"
unzip -t "$IPA" >/dev/null

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$IPA" -d "$WORK"

APP_COUNT="$(find "$WORK/Payload" -maxdepth 1 -type d -name '*.app' | wc -l | tr -d ' ')"
test "$APP_COUNT" -eq 1
APP="$(find "$WORK/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
test "$BUNDLE_ID" = 'com.jugentorba.moviestvflix'
test -x "$APP/$EXECUTABLE"
lipo -info "$APP/$EXECUTABLE" | grep -q 'arm64'
test ! -e "$APP/embedded.mobileprovision"
test ! -d "$APP/_CodeSignature"

echo "iOS re-signable IPA verified: $IPA"
```

- [ ] **Step 2: Verify the scripts reject invalid fixtures**

Run on macOS/Codemagic-capable shell:

```bash
tmp="$(mktemp)"
printf 'not-an-ipa' > "$tmp"
if scripts/verify-ios-resignable.sh "$tmp"; then
  echo "verifier unexpectedly accepted invalid IPA" >&2
  exit 1
fi
rm -f "$tmp"
```

Expected: failure.

- [ ] **Step 3: Add `ios-resignable-preview` to `codemagic.yaml`**

Use:

```yaml
  ios-resignable-preview:
    name: iOS re-signable preview IPA
    instance_type: mac_mini_m2
    max_build_duration: 120
    environment:
      node: 22
      xcode: latest
      cocoapods: default
      vars:
        EXPO_TV: "0"
        EXPO_PUBLIC_PREVIEW_MODE: "1"
    scripts:
      - name: Enable pnpm
        script: |
          corepack enable
          corepack prepare pnpm@11.25.0 --activate
      - name: Install dependencies
        script: pnpm install --frozen-lockfile
      - name: Verify source
        script: |
          pnpm lint
          pnpm typecheck
          pnpm test
      - name: Generate iOS project
        script: pnpm --filter @moviestv/mobile-tv exec expo prebuild --platform ios --no-install
      - name: Install CocoaPods
        script: |
          cd apps/mobile-tv/ios
          pod install
      - name: Build unsigned device app
        script: |
          set -euo pipefail
          IOS_DIR="$CM_BUILD_DIR/apps/mobile-tv/ios"
          WORKSPACE="$(find "$IOS_DIR" -maxdepth 1 -name '*.xcworkspace' -print -quit)"
          test -n "$WORKSPACE"
          SCHEME="$(xcodebuild -workspace "$WORKSPACE" -list -json |             python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("workspace",{}).get("schemes",[""])[0])')"
          test -n "$SCHEME"
          DERIVED="$CM_BUILD_DIR/artifacts/ios-derived"
          xcodebuild             -workspace "$WORKSPACE"             -scheme "$SCHEME"             -configuration Release             -sdk iphoneos             -destination 'generic/platform=iOS'             -derivedDataPath "$DERIVED"             CODE_SIGNING_ALLOWED=NO             CODE_SIGNING_REQUIRED=NO             CODE_SIGN_IDENTITY=""             build
          APP="$(find "$DERIVED/Build/Products/Release-iphoneos" -maxdepth 1 -type d -name '*.app' -print -quit)"
          test -n "$APP"
          mkdir -p artifacts/ios
          scripts/package-ios-resignable.sh "$APP" artifacts/ios/MoviesTv-Flix-ios-resignable-preview.ipa
          scripts/verify-ios-resignable.sh artifacts/ios/MoviesTv-Flix-ios-resignable-preview.ipa
    artifacts:
      - artifacts/ios/MoviesTv-Flix-ios-resignable-preview.ipa
      - /tmp/xcodebuild_logs/*.log
```

No `ios_signing`, App Store Connect integration, team ID, provisioning profile, certificate, or `-allowProvisioningUpdates` is allowed in this workflow.

- [ ] **Step 4: Document the re-signing contract**

`docs/builds/ios-resignable-preview.md` must state:
- the IPA is compiled for physical iPhone,
- it is intentionally unsigned,
- it cannot be installed directly,
- pass it to the user's existing IPA signer,
- no TestFlight/App Store upload occurs,
- signer/certificate failures are external to this build workflow.

- [ ] **Step 5: Re-parse `codemagic.yaml` and confirm both workflows**

```bash
ruby -e 'require "yaml"; x=YAML.load_file("codemagic.yaml"); %w[android-preview ios-resignable-preview].each { |k| abort "missing #{k}" unless x.dig("workflows",k) }'
```

Expected: exit 0.

- [ ] **Step 6: Commit Task 6**

```bash
git add codemagic.yaml scripts/package-ios-resignable.sh scripts/verify-ios-resignable.sh docs/builds/ios-resignable-preview.md
git commit -m "build: add re-signable iOS preview"
```

The task is not artifact-complete until the macOS Codemagic build produces and verifies the IPA.

---

### Task 7: Add Cloudflare Pages deployment instructions, SPA routing, and web security headers

**Files:**
- Create: `apps/mobile-tv/public/_headers`
- Create: `apps/mobile-tv/public/_redirects`
- Create: `docs/builds/pwa-cloudflare-pages.md`
- Modify: `apps/mobile-tv/scripts/verify-web-export.mjs`

**Interfaces:**
- Cloudflare build command: `pnpm --filter @moviestv/mobile-tv export:web && pnpm --filter @moviestv/mobile-tv verify:web`.
- Output directory: `apps/mobile-tv/dist`.
- Public environment values: exactly the two Supabase client variables.

- [ ] **Step 1: Extend the web verifier test for `_headers`**

Add a valid fixture `_headers` and assert the verifier fails without it.

Expected required routes:

```text
/service-worker.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: no-cache
```

- [ ] **Step 2: Confirm RED**

```bash
node apps/mobile-tv/scripts/__tests__/verify-web-export.test.mjs
```

Expected: FAIL because `_headers` is not yet required/present.

- [ ] **Step 3: Add `public/_headers` and verifier requirement**

Create:

```text
/service-worker.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: no-cache
```

Update verifier required files to include `_headers` and `_redirects`.

Create `public/_redirects` with:

```text
/* /index.html 200
```

- [ ] **Step 4: Document Cloudflare Pages setup**

`docs/builds/pwa-cloudflare-pages.md` must give exact UI values:
- Git provider: GitHub
- repo: `jugentorba/MoviesTv-Flix`
- branch during testing: `codex/platform-builds-pwa-20260918`
- framework preset: None
- root directory: leave blank so Pages starts from the repository root
- build command: `pnpm --filter @moviestv/mobile-tv export:web && pnpm --filter @moviestv/mobile-tv verify:web`
- output directory: `apps/mobile-tv/dist`
- environment: `EXPO_TV=0`, `EXPO_PUBLIC_PREVIEW_MODE=1`, `NODE_VERSION=22`, `PNPM_VERSION=11.25.0`
- no Supabase variables are required for the preview deployment
- dependency installation is handled automatically by Cloudflare Pages before the build command; there is no separate install-command field in the Pages Git setup
- no provider secrets/signing credentials.

State that the ChatGPT Cloudflare connector is not required.

- [ ] **Step 5: Re-run real web export and verifier**

```bash
rm -rf apps/mobile-tv/dist
EXPO_TV=0 EXPO_PUBLIC_PREVIEW_MODE=1 pnpm --filter @moviestv/mobile-tv export:web
pnpm --filter @moviestv/mobile-tv verify:web
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add apps/mobile-tv/public/_headers apps/mobile-tv/scripts/verify-web-export.mjs apps/mobile-tv/scripts/__tests__/verify-web-export.test.mjs docs/builds/pwa-cloudflare-pages.md
git commit -m "docs: prepare Cloudflare PWA deployment"
```

---

### Task 8: Full regression verification, Codemagic artifact checks, and review preparation

**Files:**
- Modify only files required by a proven failing test/build/review finding.
- Create: `docs/builds/preview-artifact-checklist.md`.

**Interfaces:**
- Consumes all Tasks 1–7.
- Produces a reviewable stacked branch and, once external builds run, three verified preview outputs.

- [ ] **Step 1: Run full source verification locally or on Codemagic**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

Expected: PASS with no warnings/errors.

- [ ] **Step 2: Run real PWA export verification**

```bash
rm -rf apps/mobile-tv/dist
EXPO_TV=0 EXPO_PUBLIC_PREVIEW_MODE=1 pnpm --filter @moviestv/mobile-tv export:web
pnpm --filter @moviestv/mobile-tv verify:web
```

Expected: PASS.

- [ ] **Step 3: Re-run movie/series/Live TV regressions**

```bash
pnpm --filter @moviestv/mobile-tv test -- --runInBand   src/playback/__tests__/playback-provider.test.tsx   src/catalog/__tests__/series-episode-browser.test.tsx   src/catalog/__tests__/media-details-playback.test.tsx   src/live-tv
```

Expected: PASS.

- [ ] **Step 4: Run Codemagic `android-preview` exactly once after source gates are green**

Download the artifact and run:

```bash
scripts/verify-android-preview.sh MoviesTv-Flix-android-phone-preview.apk
```

Record:
- Codemagic build ID,
- artifact SHA-256,
- package ID,
- embedded JS bundle verification result.

Do not give the APK to the user before this step passes.

- [ ] **Step 5: Run Codemagic `ios-resignable-preview` exactly once after source gates are green**

Download the artifact on macOS and run:

```bash
scripts/verify-ios-resignable.sh MoviesTv-Flix-ios-resignable-preview.ipa
shasum -a 256 MoviesTv-Flix-ios-resignable-preview.ipa
```

Record:
- Codemagic build ID,
- artifact SHA-256,
- bundle ID,
- no-provisioning-profile result.

Do not call it installable directly; label it re-signable/unsigned.

- [ ] **Step 6: Deploy the PWA through Cloudflare Pages**

Use the documented Git integration configuration.

After deploy verify:
- page loads,
- manifest URL returns 200,
- service worker URL returns 200,
- app can be added to home screen where browser/platform supports it,
- no private provider value appears in generated static assets.

Record the public test URL only after deployment succeeds.

- [ ] **Step 7: Create artifact checklist**

`docs/builds/preview-artifact-checklist.md`:

```md
# Preview artifact checklist

## Android phone
- Codemagic build:
- SHA-256:
- Package: com.jugentorba.moviestvflix
- Embedded JS bundle: PASS
- APK signature: PASS

## iOS re-signable
- Codemagic build:
- SHA-256:
- Bundle: com.jugentorba.moviestvflix
- Physical-device build: PASS
- Embedded provisioning profile: NONE
- Requires external re-signing: YES

## PWA
- Cloudflare Pages URL:
- Static export verifier: PASS
- Manifest: PASS
- Service worker: PASS
- Secret scan: PASS
```

Fill actual values only from successful external runs.

- [ ] **Step 8: Compare branch scope against the Live TV base**

```bash
git diff --name-only codex/live-tv-provider-browser-20260917...HEAD
```

Allowed scope:
- `apps/mobile-tv` platform/PWA/config/tests,
- `codemagic.yaml`,
- `scripts` artifact verifiers/packaging,
- `docs/builds`,
- this spec/plan,
- `pnpm-lock.yaml`.

Reject generated `android/`, `ios/`, `dist/`, signing material, or unrelated feature changes.

- [ ] **Step 9: Request code review**

Review the full stacked diff from `codex/live-tv-provider-browser-20260917` to HEAD.

Fix every Critical/Important issue using TDD before moving the PR out of draft.

- [ ] **Step 10: Open a draft stacked PR**

Base:
`codex/live-tv-provider-browser-20260917`

Head:
`codex/platform-builds-pwa-20260918`

PR must state:
- it is stacked on Live TV PR #29,
- Codemagic replaces GitHub Actions only for preview build execution,
- the iOS artifact is intentionally unsigned/re-signable,
- Cloudflare Pages deployment does not need the ChatGPT Cloudflare connector,
- no store publishing occurs in this PR.

Keep the PR draft until the external artifact checklist is fully populated.
