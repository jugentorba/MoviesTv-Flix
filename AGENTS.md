# AGENTS.md — MoviesTv-Flix

Permanent working instructions for every AI/automation agent (OpenCode, ChatGPT,
Codex) and for human contributors. Read this file first, then
`docs/PROJECT_STATUS.md`.

## 1. What this project is

MoviesTv-Flix is a cross-device streaming client (iPhone, iPad, Android
phone/tablet, Android TV, Apple TV, installable PWA) for movies, series and
Live TV.

Product goals — treat them as goals, never as proof of implementation:

- Nuvio-style cinematic browsing UI
- Remote-first TV navigation, touch-first phone navigation
- User-installable streaming add-ons (Stremio-compatible + Nuvio catalog)
- Explicit source/server selection before playback
- Independent app language, ordered audio-language preference, ordered
  subtitle preference
- Resume playback, synchronized watch history, cross-device profiles

## 2. Source of truth

1. The Git repository and its commit history are authoritative.
2. `docs/PROJECT_STATUS.md` is a dated snapshot, not a specification. If it
   disagrees with the code, the code wins and the document must be corrected in
   the same session.
3. `docs/builds/preview-artifact-checklist.md` is the only authority for
   build/deploy evidence.
4. Specs and plans in `docs/superpowers/specs/` and `docs/superpowers/plans/`
   describe intent at a point in time. They do not override implemented
   behavior.
5. A feature counts as done only with an evidence class from §9.

## 3. Repository map

- `apps/mobile-tv/` — Expo app. `App.tsx` → `src/app/AppRoot.tsx` (provider
  stack).
  - `src/app/` platform detection, form factor, safe-area layout
  - `src/navigation/` `PhoneTabs.tsx`, `TVRail.tsx`, `AppNavigator.tsx`
  - `src/catalog/` gateways, catalog service wiring, details, episodes, search
  - `src/addons/` installation, secrets, secure stores, provider screens
  - `src/playback/` resolver, ranking, player surfaces, track choosers, downloads
  - `src/live-tv/` provider aggregation, guide, player, remote zapping
  - `src/downloads/` native vs web download managers and screens
  - `src/watch-progress/`, `src/preferences/`, `src/profiles/`, `src/auth/`
    identity-scoped sync layers
  - `src/i18n/` locale packs (`resources/`)
  - `src/updates/` native update gateway
  - `src/web/` PWA registration, service worker and TV remote helpers
- `packages/` — `core`, `catalog`, `addons`, `playback`, `live-tv`, `sync`,
  `auth`, `storage`, `ui`
- `worker/index.js` + `functions/api/[[path]].js` — Cloudflare runtime config,
  catalog proxies, update manifest
- `supabase/migrations/` — RLS-backed remote schema;
  `supabase/functions/catalog/` — TMDB edge function
- `docs/` — build evidence and planning artifacts

## 4. Commands

pnpm 11.25.0 through Corepack, Node 22.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint          # eslint, zero warnings allowed
pnpm typecheck     # every workspace package
pnpm test          # every workspace package
pnpm build:pwa     # lint + check:pwa + web tsc + expo export + export verifier
```

- Never change the lockfile unless the task requires a dependency change.
- Never commit `node_modules`, build output, `dist/`, generated native projects,
  or secrets.
- Web-only checks must not use native module resolution; the PWA gate is
  `build:pwa`, not the workspace typecheck alone.

## 5. Architecture invariants — do not break

### Provider stack

`AppRoot.tsx` composes providers in a fixed order: i18n → account/auth →
profiles → preferences → catalog → addons/runtime → playback → downloads →
watch progress → navigation. A provider that depends on identity must resolve
identity before reading storage. Never reorder providers to "fix" a render
error; fix the dependency.

### Identity scoping

- Guest and signed-in data are separate lanes. The main profile, extra profiles
  and guest data must not read each other's storage keys.
- Profile scoping goes through `profiles/profileRuntimeScope.ts`. Do not invent
  new identity strings.
- On sign-in, guest progress promotion is explicit
  (`promoteGuestProgress`); never silently merge lanes.

### Secrets — hard rule

Provider passwords, tokens, debrid/API keys, credentialed manifest URLs and
private request headers:

- NEVER written to preference or add-on sync payloads, Supabase rows, logs,
  error messages, or exported artifacts.
- Native: SecureStore only. Web: in-memory only — never localStorage,
  IndexedDB or the service worker cache.
- `apps/mobile-tv/scripts/verify-web-export.mjs` blocks credential patterns. Do
  not weaken it.

### Playback

- Source resolution goes through the `@moviestv/addons` resolver and
  `@moviestv/playback` ranking. Never bypass ranking to "pick the first stream".
- Audio and subtitle preference order is user-defined and independent of app
  language.
- Resume position is owned by `WatchProgressController`; the player reports
  progress, it does not persist it directly.
- Native and web surfaces are separate files (`.native.tsx` / `.web.tsx`). Keep
  behavior parity documented when they diverge.

### Live TV

- Providers are aggregated with deterministic ordering and explicit fallback; a
  failing provider must not blank the channel list.
- TV interaction is remote-first: channel up/down zap, OK opens the drawer, Back
  closes overlays. Do not add permanent on-screen buttons to TV fullscreen.

### Catalog

- Catalog data comes from installed add-ons plus the Cloudflare proxies
  (`/api/cinemeta`, `/api/nuvio-catalog`).
- Bounded fetches only (`CatalogJsonLoader`). Never parse unbounded upstream
  JSON.
- Do not add a second catalog abstraction; extend the existing gateway
  interface.

### Backend

- Every remote table is RLS-scoped to `auth.uid()`. New tables need a policy and
  explicit grants.
- Migrations are append-only. Never edit an applied migration; add a new
  timestamped file.
- Sync writes are timestamp-guarded (stale-write protection). Preserve that
  contract.

### Updates and PWA

- Update manifest URLs and build numbers are validated numerically; no silent
  truncation of fractional or unsafe values.
- Android install and iOS "save IPA to Files" paths are native-only. The web
  build has no installer.
- The service worker caches the app shell only; never cache `/api/*` or media.

## 6. Platform matrix

| Concern | Web/PWA | Android | iOS/iPadOS | Android TV | tvOS |
| --- | --- | --- | --- | --- | --- |
| Navigation | tabs + responsive rail | `PhoneTabs` | `PhoneTabs` | `TVRail` | `TVRail` |
| Downloads | browser handoff, no pause/resume | real files | real files | N/A | N/A |
| Updates | reload prompt | APK install | re-signable IPA | APK install | re-signable IPA |
| Secrets | memory only | SecureStore | SecureStore | SecureStore | SecureStore |
| Cleartext HTTP media | browser policy | enabled (intentional) | ATS media exception (intentional) | enabled | exception |

The cleartext (`android:usesCleartextTraffic`) and ATS
(`NSAllowsArbitraryLoadsForMedia`) exceptions are deliberate IPTV compatibility
decisions recorded in `plugins/withNativeHttpMedia.js`. Do not remove them
without an explicit product decision logged in `docs/PROJECT_STATUS.md`.

## 7. Testing rules

- Bug fix ⇒ failing test first, then the fix. No fix without a regression test.
- Pure logic belongs in `packages/*` with unit tests; screens get component
  tests.
- Keep suites deterministic: no real network, no unfaked timers, no snapshot
  sprawl.
- Never delete or skip a test to make a gate pass. If a test is wrong, fix the
  assertion and say why.
- Existing React `act(...)` warnings are known. Do not add new ones.
- Before claiming completion, run `pnpm lint && pnpm typecheck && pnpm test` and
  record the counts.

## 8. Git and PR rules

- `main` is trunk. Never force-push `main`.
- Do not merge the historical stacked branches (`feature/*`, `codex/*`, PRs
  #1–#30) individually. They are superseded; new work starts from `main` unless
  it explicitly belongs to `ui-redesign-v2`.
- PR #34 (`ui-redesign-v2`) is an unmerged draft. Treat it as pending work, not
  as shipped code, and do not merge it without a dedicated safety review.
- One concern per commit. Conventional prefixes: `feat:`, `fix:`, `test:`,
  `ci:`, `docs:`, `refactor:`.
- Every PR states: what changed, evidence class (§9), and what remains
  unverified.
- CI runs automatically on `pull_request` for changes under `apps/`, `packages/`,
  `worker/`, `functions/`, `supabase/`, `scripts/`, the workspace manifests and
  `ci.yml` itself, and can still be dispatched manually. Docs-only PRs stay off
  the metered Actions minutes. A PR whose latest commit has no CI run — because
  it touched no code path or Actions is unavailable — has no verified CI status.

## 9. Evidence classes — mandatory vocabulary

Use exactly these labels in reports, PRs and `docs/PROJECT_STATUS.md`:

- **Verified now** — a command or external run executed in this session, with
  output or run ID.
- **Verified earlier** — externally confirmed before, with a commit SHA and
  date.
- **Source-implemented, unverified** — code exists and tests pass, but there is
  no real device, account or deploy proof.
- **Partial** — implemented for some platforms, locales or providers only; state
  the limit.
- **Blocked** — cannot progress without a named external prerequisite.
- **Not implemented** — no code path exists.

Never promote `PENDING` to `PASS` without an artifact, run URL or device
evidence. Never describe a drafted branch feature as available in the app.

## 10. Documentation protocol

Every development session ends with a `docs/PROJECT_STATUS.md` update:

1. Refresh the snapshot header: UTC date, branch, commit SHA, gates run.
2. Update only the rows affected by the change; keep evidence classes honest.
3. Add decisions to the decision log (date, decision, reason, commit).
4. Rewrite "Next tasks" (maximum 8, ordered by priority).
5. Append one entry to the session log (newest first, three lines maximum).
6. Commit as `docs(status): <area> <date>` on the working branch and merge to
   `main` the same day.
7. Change `AGENTS.md` only when a rule changes, in a separate `docs(agents):`
   commit.
8. Update `docs/builds/preview-artifact-checklist.md` only with real external
   evidence.

## 11. Do not

- Do not add Lovable, Hercules, or any prototype runtime as a dependency.
- Do not present XalaFlix, FMovies, or any website as a working source without a
  reproducible end-to-end test (issue #36).
- Do not store credentials in plain storage, logs, error messages, or sync
  payloads.
- Do not widen catalog or proxy allowlists, body limits, or URL policies without
  a security note.
- Do not edit generated native projects (`android/`, `ios/`) by hand; change
  config plugins.
- Do not commit build artifacts; publish them through the release workflow.

## 12. Starting a session

1. `git status` — if the tree is dirty, ask before touching anything.
2. Read the `docs/PROJECT_STATUS.md` snapshot and next tasks.
3. Confirm the branch and whether the task belongs on `main` or
   `ui-redesign-v2`.
4. Run the gates before changing code so you know the baseline.
5. Ask before adding dependencies, changing schema, or altering security policy.
