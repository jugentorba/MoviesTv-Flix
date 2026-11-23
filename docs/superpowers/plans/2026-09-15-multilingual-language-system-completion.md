# Multilingual Language System Completion Record

**Date:** 2026-09-15  
**Branch:** `codex/multilingual-language-system-plan`  
**Base branch:** `main`

## Verified implementation checkpoint

The exact implementation head verified before this completion-record-only documentation change is:

- Commit: `4e9c6aad5cc758c584ed85fc3d7ebeca0c199c0e`
- GitHub Actions run: `34960258675`
- Workflow: `CI`
- Result: `success`

The run completed all repository gates successfully:

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Test results at that exact implementation head were **34 test suites passed / 146 tests passed / 0 failed**:

| Workspace | Suites | Tests |
| --- | ---: | ---: |
| `apps/mobile-tv` | 17 | 51 |
| `packages/addons` | 6 | 39 |
| `packages/auth` | 1 | 2 |
| `packages/catalog` | 3 | 15 |
| `packages/core` | 2 | 18 |
| `packages/playback` | 2 | 13 |
| `packages/storage` | 1 | 3 |
| `packages/sync` | 2 | 5 |
| **Total** | **34** | **146** |

## Completed behavior

The app now treats interface, audio and subtitle languages as three independent systems. App-language selection can follow the device or be manually overridden without changing content-language priorities. Ordered audio/subtitle preferences persist locally and synchronize field-by-field for signed-in users while preserving order.

The app interface has 42 initial locale packs with English fallback, locale-aware display helpers, and RTL direction support. The audio/subtitle selectors use the shared comprehensive ISO 639-1 registry, canonical BCP 47 / ISO identities, searchable display names and explicit Move up / Move down controls suitable for TV remotes as well as touch/keyboard use.

Provider stream normalization now canonicalizes recognized aliases such as `eng`, `fra`, `alb` and `zho` while keeping genuinely unknown language metadata playable. Playback source ranking consumes the user's ordered audio priorities, supports a known original-language fallback bucket, considers quality within a language tier, preserves resolver/provider order for equal-ranked sources, and never rejects a source solely because its language is unknown.

The playback package also includes a dependency-free session controller with resolving, ready, no-source and error states, automatic best-source selection, manual source switching, subscriber notifications, reset behavior and protection against stale overlapping resolver requests.

## Regression coverage retained

The successful full-repository run includes coverage for the existing foundation flows as well as the new language system: missing Supabase runtime configuration, authentication/session behavior, phone navigation, TV focusable navigation, catalog browsing/search/details, provider resolution and partial failures, preference conflict handling/synchronization, language normalization, localized/RTL surfaces, ordered-language UI, provider metadata normalization, playback ranking and playback-session state transitions.

## Scope boundary

Language preferences are ranking preferences, not content generators. A selected language cannot manufacture an audio track, subtitle or stream that an enabled provider does not return. Provider credentials/secrets remain outside the language preference data.

Native video rendering, full provider-management UI, complete series/episode playback, watch progress/history, Live TV, PWA/native release packaging and device testing remain separate application phases.

## Final branch verification

This completion record and README are documentation-only changes after the verified implementation checkpoint above. The branch must still pass CI at the documentation-complete head before a pull request is treated as ready to integrate.
