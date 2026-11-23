# MoviesTv-Flix — Foundation Design

Date: 2026-09-05
Status: Ready for user review

## 1. Product goal

MoviesTv-Flix is a cross-device media application for phones, tablets, Android TV, and Apple TV. A user signs into one account and keeps preferences, watch state, enabled add-ons/providers, favorites, and continue-watching synchronized across devices.

The product is split into independent subsystems so catalog browsing, playback, add-ons, sync, and live TV can evolve without becoming tightly coupled.

## 2. Scope decomposition

The full product is too large for one implementation pass, so it will be built as separate sub-projects with stable interfaces between them:

1. Foundation + account sync shell
2. Catalog + search + detail pages
3. Playback engine + source selection
4. Add-on/provider framework
5. Live TV + playlist/EPG support
6. Cross-device polish, offline behavior, TV remote UX, release automation

This document defines the overall boundaries and the exact scope of sub-project 1.

## 3. Recommended architecture

### Client stack

Use React Native with TypeScript and the react-native-tvos ecosystem so the same product architecture can target:

- iPhone
- iPad
- Android phones/tablets
- Android TV
- Apple TV

Avoid a web-first shell as the primary architecture because TV focus/remote behavior and native media playback need first-class support.

### Repository structure

Use a monorepo:

```text
apps/
  mobile-tv/
packages/
  core/
  ui/
  auth/
  sync/
  catalog/
  playback/
  addons/
  live-tv/
  storage/
docs/
```

Each package exposes a small public interface and must not reach into another package's internals.

### Backend

Use Supabase initially for:

- email/password authentication
- user profile data
- synchronized preferences
- watch progress
- favorites/watchlist
- enabled provider/add-on configuration

Reason: it supports the required account sync with a free starting tier and avoids building a custom server before the client architecture is stable.

Start with email/password only. Google and Apple sign-in can be added later after native app identifiers and store configuration exist.

## 4. Core domain boundaries

### `core`

Owns shared domain types and application-level contracts. It must not import UI or platform-specific code.

Examples:

- MediaItem
- Movie
- Series
- Episode
- Channel
- StreamSource
- SubtitleTrack
- AudioTrack
- PlaybackProgress
- ProviderDescriptor

### `ui`

Owns shared visual primitives, spacing, typography, cards, rows, focus states, loading states, and responsive layout tokens.

UI must support both touch and remote/focus navigation from day one.

### `auth`

Owns sign-up, sign-in, sign-out, session restoration, and auth state.

### `sync`

Owns cloud persistence and conflict handling for user data.

Initial synchronized data:

- profile
- preferences
- watch progress
- continue-watching
- favorites
- watchlist
- enabled providers/add-ons
- selected live-TV countries/providers

### `catalog`

Owns browse/search/detail data. The first metadata adapter should be TMDB-compatible, behind an interface so another catalog source can be swapped in later.

### `playback`

Owns playback state, source switching, subtitle/audio selection, resume position, and player lifecycle. It receives already-resolved sources and does not know how providers found them.

### `addons`

Owns provider/add-on registration and source resolution interfaces. It should support app-native providers and Stremio-compatible manifests through adapters.

Only user-configured or otherwise authorized/legal providers should be supported. The app should not scrape for unauthorized streams.

### `live-tv`

Owns channels, provider playlists, M3U parsing, EPG mapping, channel health checks, favorites, and country filters.

Live-TV discovery is limited to configured provider endpoints or legal/public sources; the app should not search the web for unauthorized channel streams.

## 5. Data flow

### App startup

1. Restore local session.
2. Load local cached preferences immediately.
3. If authenticated, fetch synchronized user state.
4. Merge server state with newer local changes.
5. Render the home shell without waiting for every remote request.

### Watch progress

1. Player emits progress updates locally.
2. Local state updates immediately.
3. Progress sync is debounced to the backend.
4. Final progress is written when playback stops or the app backgrounds.
5. Another device restores the latest confirmed position.

### Provider/add-on settings

1. User enables/configures a provider.
2. Sensitive secrets stay in secure device storage when possible.
3. Only safe configuration metadata is synchronized.
4. Provider adapters expose normalized catalog/source results to the rest of the app.

## 6. Conflict handling

Use timestamp-based last-write-wins for simple settings.

For watch progress:

- prefer the update with the newest server timestamp
- do not move progress backwards unless the user explicitly restarts the title
- mark content completed at a configurable percentage threshold

For favorites/watchlist:

- use item-level upserts/deletes rather than replacing the whole collection

## 7. Foundation UI shell

Sub-project 1 includes only the application shell, not final catalog or playback screens.

Screens:

- Splash/session restore
- Sign in
- Create account
- Main shell
- Home placeholder
- Movies placeholder
- Series placeholder
- Live TV placeholder
- Search placeholder
- Settings
- Account

Phone/tablet navigation:

- fixed bottom tab navigation
- touch-first interactions
- tablet layouts may widen content but keep the same primary tab model

TV navigation:

- fixed left-side navigation rail
- visible focus state
- deterministic D-pad traversal
- Back/Menu behavior mapped to navigation stack

## 8. Sub-project 1 exact deliverables

The first implementation pass should create:

- React Native TypeScript project capable of mobile and TV targets
- monorepo/package boundaries
- shared design tokens and basic dark UI shell
- responsive phone/tablet/TV navigation
- Supabase client abstraction
- email/password sign-up and sign-in
- session restoration
- local persistence abstraction
- synchronized user preferences skeleton
- placeholder feature routes for Movies, Series, Live TV, Search, and Settings
- automated unit tests for core/auth/sync logic
- basic navigation smoke tests
- CI workflow for lint, typecheck, and tests

It should not yet implement final movie catalogs, stream resolution, M3U playback, or production video playback.

## 9. Error handling

The app should distinguish:

- offline state
- authentication failure
- backend unavailable
- provider unavailable
- malformed provider response
- playback failure

Foundation behavior:

- never block the entire UI because one remote service failed
- show cached local state when available
- expose retry actions
- log technical details in development while showing simple user-facing messages

## 10. Security

- never commit API keys or secrets
- use environment-based configuration
- store auth/session tokens with platform secure storage
- keep provider credentials out of cloud sync unless specifically designed for encrypted storage
- validate external provider manifests and URLs before use

## 11. Testing strategy

Foundation tests:

- domain type/utility unit tests
- auth state transition tests
- sync conflict tests
- local persistence tests
- navigation tests for phone and TV layouts
- session restoration tests

Later sub-projects add contract tests for catalog, provider, playback, and Live TV adapters.

## 12. Definition of done for foundation

Foundation is complete when:

- the same repository builds a phone/tablet app and TV-targeted app shell
- a user can create an account, sign in, sign out, and restore a session
- a basic preference change synchronizes between two signed-in devices
- phone touch navigation works
- TV remote focus navigation works
- CI passes lint, typecheck, and tests
- the remaining feature modules have stable interfaces but no premature implementation

## 13. Follow-on specs

After foundation is working, create separate reviewed specs in this order:

1. Catalog/search/details
2. Playback/source selection
3. Add-on/provider system
4. Live TV/EPG
5. Multi-device release and platform polish
