# MoviesTv-Flix Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working MoviesTv-Flix cross-device application shell with shared mobile/TV navigation, testable auth and sync boundaries, Supabase integration adapters, local persistence, and CI.

**Architecture:** Use a pnpm workspace monorepo with one Expo SDK 56 application in `apps/mobile-tv` and focused TypeScript packages under `packages/*`. The app uses the React Native TV fork (`react-native-tvos@0.85-stable`) so the same JavaScript architecture can target iPhone/iPad/Android phones/tablets plus Apple TV/Android TV; TV native generation is controlled through `@react-native-tvos/config-tv`. Domain, auth, storage, and sync logic remain platform-agnostic and are dependency-injected so they can be unit-tested without Supabase or React Native.

**Tech Stack:** TypeScript, pnpm 11.25.0 workspaces, Expo SDK 56, React Native via `npm:react-native-tvos@0.85-stable`, React Navigation, Supabase JS, AsyncStorage, Jest, React Native Testing Library, ESLint, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-foundation-design.md`

## Global Constraints

- One product architecture must support iPhone, iPad, Android phones/tablets, Android TV, and Apple TV.
- Phone/tablet navigation uses a fixed bottom tab model; TV navigation uses a fixed left-side rail with visible focus state and deterministic D-pad traversal.
- Start with email/password authentication only.
- Never commit Supabase credentials or provider secrets.
- Cached local state must remain usable when the backend is unavailable.
- Foundation does not implement final catalogs, stream resolution, M3U playback, or production video playback.
- Provider and Live TV support must remain limited to user-configured, authorized, legal, or public sources.
- Core packages may not import platform UI internals.

---

## Planned file structure

```text
.github/workflows/ci.yml
.env.example
.gitignore
package.json
pnpm-workspace.yaml
tsconfig.base.json
apps/mobile-tv/
  App.tsx
  app.config.ts
  babel.config.js
  jest.config.js
  package.json
  src/app/AppRoot.tsx
  src/app/platform.ts
  src/auth/AuthScreen.tsx
  src/auth/useAuthSession.ts
  src/navigation/AppNavigator.tsx
  src/navigation/PhoneTabs.tsx
  src/navigation/TVRail.tsx
  src/screens/PlaceholderScreen.tsx
  src/screens/SettingsScreen.tsx
  src/services/runtime.ts
  src/services/supabase.ts
  src/theme/index.ts
  src/__tests__/navigation.test.tsx
packages/core/src/index.ts
packages/core/src/media.ts
packages/core/src/providers.ts
packages/core/src/user.ts
packages/core/src/__tests__/user.test.ts
packages/storage/src/index.ts
packages/storage/src/KeyValueStore.ts
packages/storage/src/MemoryStore.ts
packages/storage/src/AsyncStorageStore.ts
packages/storage/src/__tests__/storage.test.ts
packages/auth/src/index.ts
packages/auth/src/AuthClient.ts
packages/auth/src/AuthController.ts
packages/auth/src/__tests__/auth.test.ts
packages/sync/src/index.ts
packages/sync/src/conflicts.ts
packages/sync/src/PreferenceSyncService.ts
packages/sync/src/__tests__/conflicts.test.ts
packages/ui/src/index.ts
packages/ui/src/tokens.ts
packages/catalog/src/index.ts
packages/playback/src/index.ts
packages/addons/src/index.ts
packages/live-tv/src/index.ts
```

### Task 1: Workspace, domain contracts, and module boundaries

**Files:**
- Create root workspace/config files.
- Create `packages/core/src/{media,providers,user,index}.ts`.
- Create placeholder public contracts in `catalog`, `playback`, `addons`, and `live-tv`.
- Test: `packages/core/src/__tests__/user.test.ts`.

**Interfaces:**
- Produces `UserPreferences`, `PlaybackProgress`, `MediaItem`, `StreamSource`, `ProviderDescriptor`, `CatalogAdapter`, `PlaybackRequest`, `AddonAdapter`, and `LiveTvProvider`.
- Later tasks consume `UserPreferences` and `PlaybackProgress` without importing React Native.

- [x] **Step 1: Write the failing core test**

```ts
import { defaultUserPreferences, completedFromProgress } from '../user';

test('default preferences are stable and progress completion uses the threshold', () => {
  expect(defaultUserPreferences().subtitleLanguage).toBe('auto');
  expect(completedFromProgress({ positionMs: 9_100, durationMs: 10_000 }, 0.9)).toBe(true);
});
```

- [x] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @moviestv/core test`
Expected: FAIL because workspace/package and functions do not yet exist.

- [x] **Step 3: Implement the smallest domain contracts and workspace config**

Implement `defaultUserPreferences(): UserPreferences` and `completedFromProgress(progress: PlaybackProgress, threshold?: number): boolean`; add only interface-only placeholders for later feature packages.

- [x] **Step 4: Run core test and typecheck**

Run: `pnpm --filter @moviestv/core test && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages
 git commit -m "feat: establish workspace domain boundaries"
```

### Task 2: Local persistence abstraction

**Files:**
- Create `packages/storage/src/KeyValueStore.ts`.
- Create `packages/storage/src/MemoryStore.ts`.
- Create `packages/storage/src/AsyncStorageStore.ts`.
- Test: `packages/storage/src/__tests__/storage.test.ts`.

**Interfaces:**
- Produces `KeyValueStore` with `get<T>(key): Promise<T | null>`, `set<T>(key, value): Promise<void>`, `remove(key): Promise<void>`.
- Produces `MemoryStore` for tests and `AsyncStorageStore` for the app runtime.

- [x] **Step 1: Write failing storage tests**

```ts
const store = new MemoryStore();
await store.set('prefs', { audioLanguage: 'en' });
expect(await store.get('prefs')).toEqual({ audioLanguage: 'en' });
await store.remove('prefs');
expect(await store.get('prefs')).toBeNull();
```

- [x] **Step 2: Run storage tests and verify failure**

Run: `pnpm --filter @moviestv/storage test`
Expected: FAIL because `MemoryStore` is missing.

- [x] **Step 3: Implement `KeyValueStore`, `MemoryStore`, and the AsyncStorage adapter**

Serialize values as JSON in `AsyncStorageStore`; invalid stored JSON returns `null` and is removed so corrupted cache cannot block startup.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @moviestv/storage test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/storage
 git commit -m "feat: add local persistence abstraction"
```

### Task 3: Authentication state and session restoration

**Files:**
- Create `packages/auth/src/AuthClient.ts`.
- Create `packages/auth/src/AuthController.ts`.
- Test: `packages/auth/src/__tests__/auth.test.ts`.

**Interfaces:**
- `AuthClient.signIn(email, password): Promise<AuthSession>`
- `AuthClient.signUp(email, password): Promise<AuthSession | null>`
- `AuthClient.restoreSession(): Promise<AuthSession | null>`
- `AuthClient.signOut(): Promise<void>`
- `AuthController` exposes immutable state `{ status: 'restoring' | 'signedOut' | 'signedIn' | 'error'; session: AuthSession | null; message?: string }`.

- [x] **Step 1: Write failing auth state tests**

```ts
const client = new FakeAuthClient({ restore: { userId: 'u1', accessToken: 'token' } });
const auth = new AuthController(client);
await auth.restore();
expect(auth.getState()).toMatchObject({ status: 'signedIn', session: { userId: 'u1' } });
```

Also test failed sign-in returns `error` without discarding a previously restored session until an explicit sign-out.

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @moviestv/auth test`
Expected: FAIL because controller/client contracts are missing.

- [x] **Step 3: Implement controller with injected client**

No Supabase imports are allowed in this package.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @moviestv/auth test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/auth
 git commit -m "feat: add testable auth state controller"
```

### Task 4: Preference synchronization and conflict handling

**Files:**
- Create `packages/sync/src/conflicts.ts`.
- Create `packages/sync/src/PreferenceSyncService.ts`.
- Test: `packages/sync/src/__tests__/conflicts.test.ts`.

**Interfaces:**
- `Timestamped<T> = { value: T; updatedAt: string }`.
- `chooseLatest<T>(local, remote): Timestamped<T>` chooses the newest valid timestamp.
- `mergeProgress(local, remote, restarted): Timestamped<PlaybackProgress>` never moves progress backward unless `restarted` is true.
- `PreferenceRemoteStore.read(userId)` and `.write(userId, state)` are injected into `PreferenceSyncService`.

- [x] **Step 1: Write failing conflict tests**

```ts
expect(chooseLatest(
  { value: 'fr', updatedAt: '2026-09-06T10:00:00Z' },
  { value: 'en', updatedAt: '2026-09-06T09:00:00Z' }
).value).toBe('fr');

expect(mergeProgress(
  { value: { positionMs: 90, durationMs: 100 }, updatedAt: '2026-09-06T09:00:00Z' },
  { value: { positionMs: 20, durationMs: 100 }, updatedAt: '2026-09-06T10:00:00Z' },
  false
).value.positionMs).toBe(90);
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @moviestv/sync test`
Expected: FAIL because merge functions are missing.

- [x] **Step 3: Implement merge logic and preference sync service**

Service sequence: read cached state immediately, fetch remote when signed in, merge field-by-field, update cache, then write merged remote state only when it differs.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @moviestv/sync test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/sync
 git commit -m "feat: add preference sync conflict handling"
```

### Task 5: Shared design tokens and cross-device navigation shell

**Files:**
- Create `packages/ui/src/tokens.ts` and `index.ts`.
- Create Expo application files under `apps/mobile-tv`.
- Create `PhoneTabs.tsx`, `TVRail.tsx`, `AppNavigator.tsx`, placeholder screens, and settings/account screens.
- Test: `apps/mobile-tv/src/__tests__/navigation.test.tsx`.

**Interfaces:**
- `AppNavigator({ formFactor }: { formFactor: 'phone' | 'tablet' | 'tv' })`.
- Shared routes: `Home`, `Movies`, `Series`, `LiveTV`, `Search`, `Settings`.
- `TVRail` exposes explicit focusable pressables with visible focus styling.

- [x] **Step 1: Write failing navigation smoke tests**

```tsx
render(<AppNavigator formFactor="phone" />);
expect(screen.getByText('Home')).toBeTruthy();
expect(screen.getByText('Live TV')).toBeTruthy();

render(<AppNavigator formFactor="tv" />);
expect(screen.getByTestId('tv-nav-rail')).toBeTruthy();
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @moviestv/mobile-tv test`
Expected: FAIL because the app shell does not exist.

- [x] **Step 3: Implement the Expo SDK 56 app shell**

Use `react-native: npm:react-native-tvos@0.85-stable`, `@react-native-tvos/config-tv`, React Navigation, a dark token set, bottom tabs on phone/tablet, and a left rail on TV. Keep screen content to placeholders except Settings and Account.

- [x] **Step 4: Run app tests and typecheck**

Run: `pnpm --filter @moviestv/mobile-tv test && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/mobile-tv packages/ui
 git commit -m "feat: add mobile and tv application shell"
```

### Task 6: Supabase runtime adapters and auth UI

**Files:**
- Create `.env.example`.
- Create `apps/mobile-tv/src/services/supabase.ts` and `runtime.ts`.
- Create `apps/mobile-tv/src/auth/AuthScreen.tsx` and `useAuthSession.ts`.
- Update `AppRoot.tsx` and Settings/Account screens.

**Interfaces:**
- App runtime reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `SupabaseAuthClient` implements the `AuthClient` package contract.
- When configuration is absent, runtime returns a typed `backend-not-configured` condition instead of crashing.

- [x] **Step 1: Write failing adapter/config tests**

```ts
expect(readSupabaseConfig({})).toEqual({ ok: false, reason: 'backend-not-configured' });
```

Add auth-screen smoke coverage proving a missing backend shows a retry/configuration message rather than a blank screen.

- [x] **Step 2: Run and verify failure**

Run: `pnpm --filter @moviestv/mobile-tv test`
Expected: FAIL because runtime config/auth UI is missing.

- [x] **Step 3: Implement Supabase adapter and email/password screens**

Use Supabase session persistence through the storage adapter accepted by `supabase-js`, with `autoRefreshToken: true`, `persistSession: true`, and `detectSessionInUrl: false`. Do not put real credentials in source control.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @moviestv/mobile-tv test && pnpm typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .env.example apps/mobile-tv
 git commit -m "feat: connect auth shell to supabase adapter"
```

### Task 7: CI, project documentation, and final foundation verification

**Files:**
- Create `.github/workflows/ci.yml`.
- Update `README.md` with workspace commands and mobile/TV build modes.
- Update this plan by checking completed tasks only after verification.

**Interfaces:**
- CI runs install, lint, typecheck, and tests on every push and pull request.
- TV configuration is generated with `EXPO_TV=1`; phone mode uses the same project without that flag.

- [x] **Step 1: Add CI workflow**

Workflow uses Node.js 22, Corepack, pnpm 11.25.0, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.

- [x] **Step 2: Add README commands**

Document:

```bash
pnpm install
pnpm --filter @moviestv/mobile-tv start
EXPO_TV=1 pnpm --filter @moviestv/mobile-tv prebuild
pnpm lint
pnpm typecheck
pnpm test
```

- [x] **Step 3: Run complete verification**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`
Expected: all commands exit 0.

- [x] **Step 4: Verify CI status on the resulting commit**

Expected: GitHub Actions workflow reaches success. If it fails, inspect the failing job logs and fix the cause before claiming completion.

- [x] **Step 5: Commit**

```bash
git add .github README.md docs/superpowers/plans/2026-09-06-foundation-implementation.md
 git commit -m "ci: verify MoviesTv-Flix foundation"
```

## Self-review

- Spec coverage: workspace boundaries, mobile/TV shell, auth, session restoration, persistence, preference sync, placeholder routes, tests, CI, security constraints, and offline-safe startup are all mapped to tasks.
- Deliberately excluded by spec: final catalogs, stream resolution, M3U/EPG playback, and production video playback.
- No production secret is required in source control; `.env.example` only defines variable names.
- All cross-package interfaces used by later tasks are defined before they are consumed.
