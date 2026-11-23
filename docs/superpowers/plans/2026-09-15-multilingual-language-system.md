# Multilingual Language System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a broad multilingual app interface plus comprehensive, independently ordered audio and subtitle language preferences that work consistently across phone, tablet, TV and web, persist locally, synchronize across signed-in devices, and feed provider/playback ranking.

**Architecture:** Put language identity and normalization in `packages/core`, preference conflict/sync rules in `packages/sync`, and UI localization/pickers in `apps/mobile-tv`. The app boots with locally cached preferences so the sign-in screen can already use the chosen app language; after sign-in, the existing timestamp-based preference sync reconciles local and Supabase values field-by-field. Audio/subtitle language identity is shared with add-on normalization and playback ranking so providers, settings and the player never maintain separate language lists.

**Tech Stack:** TypeScript, React 19, React Native TV / Expo 56, AsyncStorage, Supabase, Jest, Testing Library, existing pnpm monorepo and GitHub Actions CI. No new localization framework is required; use a small typed in-repo i18n runtime and `Intl` APIs already available in the JS runtime.

**Spec:** `docs/superpowers/specs/2026-09-15-multilingual-language-system-design.md`

## Global Constraints

- App interface language, preferred audio languages and preferred subtitle languages are independent settings.
- The user can manually choose an app language regardless of the phone/TV language.
- Device locale is only the first-launch default while `appLocale === 'system'`.
- Persist canonical BCP 47 / ISO language tags, never translated display names.
- Audio/subtitle selectors expose the full ISO 639-1 language set and accept normalized BCP 47 variants returned by providers.
- Unknown-language sources remain playable fallback candidates.
- English is the final UI-string fallback.
- Ordered language arrays must preserve order through persistence and synchronization.
- Phone/tablet/web may support drag ordering later, but Move up / Move down controls are mandatory everywhere and are the primary TV interaction.
- RTL locales must expose correct direction metadata; artwork and transport controls must not be semantically reversed.
- No provider secrets or credentials are stored with language preferences.
- Existing `autoplay` behavior remains unchanged.

---

### Task 1: Shared language registry and canonical normalization

**Files:**
- Create: `packages/core/src/languages/language-data.ts`
- Create: `packages/core/src/languages/normalize.ts`
- Create: `packages/core/src/languages/display.ts`
- Create: `packages/core/src/languages/index.ts`
- Create: `packages/core/src/__tests__/languages.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `LanguageDefinition`, `LANGUAGE_DEFINITIONS`, `normalizeLanguageTag(input: string): string | null`, `languageDirection(tag: string): 'ltr' | 'rtl'`, `displayLanguageName(tag: string, locale: string): string`, `searchLanguages(query: string, locale: string): LanguageDefinition[]`.
- Consumers: settings pickers, provider stream normalization, playback ranking and locale UI.

- [ ] **Step 1: Write failing registry/normalization tests**

Add tests covering all required alias behavior and broad registry size:

```ts
import {
  LANGUAGE_DEFINITIONS,
  languageDirection,
  normalizeLanguageTag,
} from '../languages';

test('ships the complete ISO 639-1 catalog', () => {
  expect(LANGUAGE_DEFINITIONS.length).toBeGreaterThanOrEqual(180);
  expect(LANGUAGE_DEFINITIONS.some((language) => language.canonicalTag === 'sq')).toBe(true);
  expect(LANGUAGE_DEFINITIONS.some((language) => language.canonicalTag === 'zh')).toBe(true);
});

test.each([
  ['EN', 'en'],
  ['eng', 'en'],
  ['fre', 'fr'],
  ['fra', 'fr'],
  ['alb', 'sq'],
  ['sqi', 'sq'],
  ['chi', 'zh'],
  ['zho', 'zh'],
  ['pt_BR', 'pt-BR'],
  ['zh-hant', 'zh-Hant'],
])('normalizes %s to %s', (input, expected) => {
  expect(normalizeLanguageTag(input)).toBe(expected);
});

test('marks RTL languages without reversing unrelated media semantics', () => {
  expect(languageDirection('ar')).toBe('rtl');
  expect(languageDirection('he')).toBe('rtl');
  expect(languageDirection('en')).toBe('ltr');
});
```

- [ ] **Step 2: Run the core language tests and verify they fail**

Run:

```bash
corepack pnpm --filter @moviestv/core exec jest src/__tests__/languages.test.ts --runInBand
```

Expected: FAIL because `../languages` does not exist.

- [ ] **Step 3: Implement the language data and normalizer**

`language-data.ts` contains one checked-in definition for every ISO 639-1 code (184 current two-letter language codes), including English name, native name when stable, ISO 639-2/B/T aliases, and direction. Preserve specific provider BCP 47 variants rather than collapsing `pt-BR`, `zh-Hans` or `zh-Hant` to their base tag.

Core shape:

```ts
export interface LanguageDefinition {
  canonicalTag: string;
  iso6391?: string;
  iso6392: string[];
  englishName: string;
  nativeName?: string;
  aliases: string[];
  direction: 'ltr' | 'rtl';
}
```

`normalizeLanguageTag` must:

```ts
export function normalizeLanguageTag(input: string): string | null {
  const cleaned = input.trim().replaceAll('_', '-');
  if (!cleaned) return null;
  const alias = ALIAS_TO_CANONICAL.get(cleaned.toLowerCase());
  if (alias) return alias;
  try {
    return Intl.getCanonicalLocales(cleaned)[0] ?? null;
  } catch {
    return null;
  }
}
```

`displayLanguageName` first uses `Intl.DisplayNames`, then native name, then English name, then canonical tag. `searchLanguages` matches localized display name, English name, native name and aliases with case/diacritic-insensitive normalization.

- [ ] **Step 4: Run core tests and typecheck**

```bash
corepack pnpm --filter @moviestv/core exec jest --runInBand
corepack pnpm --filter @moviestv/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/languages packages/core/src/__tests__/languages.test.ts packages/core/src/index.ts
git commit -m "feat: add comprehensive language registry"
```

---

### Task 2: Upgrade user preferences with backward-compatible language fields

**Files:**
- Modify: `packages/core/src/user.ts`
- Modify: `packages/core/src/__tests__/user.test.ts`
- Modify: `packages/sync/src/PreferenceSyncService.ts`
- Modify: `packages/sync/src/__tests__/conflicts.test.ts`
- Create: `packages/sync/src/__tests__/language-preferences.test.ts`

**Interfaces:**
- Produces: `UserPreferences.appLocale`, `preferredAudioLanguages`, `preferredSubtitleLanguages`, `subtitlesEnabled`, plus existing `autoplay`.
- Produces: `migrateUserPreferences(value: unknown): UserPreferences` and timestamped sync fields with preserved array ordering.

- [ ] **Step 1: Add failing preference migration tests**

Required defaults and legacy conversion:

```ts
expect(defaultUserPreferences()).toEqual({
  appLocale: 'system',
  preferredAudioLanguages: [],
  preferredSubtitleLanguages: [],
  subtitlesEnabled: true,
  autoplay: true,
});

expect(migrateUserPreferences({
  audioLanguages: ['en', 'fr', 'de'],
  subtitleLanguage: 'auto',
  autoplay: false,
})).toEqual({
  appLocale: 'system',
  preferredAudioLanguages: ['en', 'fr', 'de'],
  preferredSubtitleLanguages: [],
  subtitlesEnabled: true,
  autoplay: false,
});
```

Also test that explicit ordered arrays remain ordered after migration.

- [ ] **Step 2: Run core/sync tests to confirm failure**

```bash
corepack pnpm --filter @moviestv/core exec jest src/__tests__/user.test.ts --runInBand
corepack pnpm --filter @moviestv/sync exec jest --runInBand
```

- [ ] **Step 3: Replace the legacy preference shape**

Use:

```ts
export interface UserPreferences {
  appLocale: string | 'system';
  preferredAudioLanguages: string[];
  preferredSubtitleLanguages: string[];
  subtitlesEnabled: boolean;
  autoplay: boolean;
}
```

`migrateUserPreferences` must accept both the old `{ audioLanguages, subtitleLanguage, autoplay }` cache shape and the new shape. Normalize every language tag through `normalizeLanguageTag`, remove duplicates while preserving first occurrence, and never throw on malformed persisted data.

- [ ] **Step 4: Expand timestamped synchronization field-by-field**

`TimestampedPreferences` becomes:

```ts
export interface TimestampedPreferences {
  appLocale: Timestamped<string>;
  preferredAudioLanguages: Timestamped<string[]>;
  preferredSubtitleLanguages: Timestamped<string[]>;
  subtitlesEnabled: Timestamped<boolean>;
  autoplay: Timestamped<boolean>;
}
```

Keep `chooseLatest` field-by-field so an app-language change on one device cannot overwrite a newer subtitle-order change from another device. Tests must explicitly verify array order survives local/remote reconciliation.

- [ ] **Step 5: Run tests/typechecks and commit**

```bash
corepack pnpm --filter @moviestv/core exec jest --runInBand
corepack pnpm --filter @moviestv/sync exec jest --runInBand
corepack pnpm --filter @moviestv/core typecheck
corepack pnpm --filter @moviestv/sync typecheck
git add packages/core/src/user.ts packages/core/src/__tests__/user.test.ts packages/sync/src
git commit -m "feat: add multilingual preference model"
```

---

### Task 3: Add local preference bootstrapping and Supabase language preference sync

**Files:**
- Create: `apps/mobile-tv/src/preferences/PreferencesProvider.tsx`
- Create: `apps/mobile-tv/src/preferences/usePreferences.ts`
- Create: `apps/mobile-tv/src/preferences/SupabasePreferenceRemoteStore.ts`
- Create: `apps/mobile-tv/src/preferences/__tests__/preferences-provider.test.tsx`
- Create: `apps/mobile-tv/src/preferences/__tests__/supabase-preferences.test.ts`
- Modify: `apps/mobile-tv/src/services/supabase.ts`
- Modify: `apps/mobile-tv/src/app/AppRoot.tsx`
- Create: `supabase/migrations/20260915095000_user_preferences_v2.sql`

**Interfaces:**
- Produces: `usePreferences(): { preferences, setAppLocale, setPreferredAudioLanguages, setPreferredSubtitleLanguages, setSubtitlesEnabled, setAutoplay }`.
- Consumes: existing `PreferenceSyncService`, `AsyncStorageStore`, authenticated `userId`, shared Supabase client.

- [ ] **Step 1: Write failing provider bootstrap tests**

Cover:

```ts
test('cached app locale is available before remote sync finishes', async () => { /* render provider with cache */ });
test('signed-in remote sync preserves newer ordered audio list', async () => { /* remote newer timestamp */ });
test('preference updates write cache immediately', async () => { /* call setter */ });
```

The first test is critical: the sign-in screen must be localizable before cloud sync.

- [ ] **Step 2: Add the Supabase schema with RLS**

Create one row per user:

```sql
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_locale text not null default 'system',
  app_locale_updated_at timestamptz not null default now(),
  preferred_audio_languages jsonb not null default '[]'::jsonb,
  preferred_audio_languages_updated_at timestamptz not null default now(),
  preferred_subtitle_languages jsonb not null default '[]'::jsonb,
  preferred_subtitle_languages_updated_at timestamptz not null default now(),
  subtitles_enabled boolean not null default true,
  subtitles_enabled_updated_at timestamptz not null default now(),
  autoplay boolean not null default true,
  autoplay_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can read own preferences"
on public.user_preferences for select
using (auth.uid() = user_id);

create policy "Users can insert own preferences"
on public.user_preferences for insert
with check (auth.uid() = user_id);

create policy "Users can update own preferences"
on public.user_preferences for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

- [ ] **Step 3: Expose one shared Supabase client**

Refactor `apps/mobile-tv/src/services/supabase.ts` so `ConfiguredApp` creates one `SupabaseClient`, then passes it to both `SupabaseAuthClient` and `SupabasePreferenceRemoteStore`; do not create two independently persisted auth clients.

- [ ] **Step 4: Implement PreferencesProvider**

Cache key: `user-preferences`. On first run seed every field with one timestamp from `Date.now()` and `defaultUserPreferences()`. When `userId` becomes available, call `PreferenceSyncService.sync(userId, setCachedPreferences)`. Setter functions canonicalize/dedupe language arrays, update only that field timestamp, write cache immediately, then trigger remote reconciliation without blocking the UI.

- [ ] **Step 5: Wire provider around auth and app content**

`AppRoot` must load local preferences before choosing localized auth/app copy. Keep the existing missing-Supabase-config behavior intact.

- [ ] **Step 6: Run focused app tests and commit**

```bash
corepack pnpm --filter @moviestv/mobile-tv exec jest src/preferences --runInBand
corepack pnpm --filter @moviestv/mobile-tv typecheck
git add apps/mobile-tv/src/preferences apps/mobile-tv/src/services/supabase.ts apps/mobile-tv/src/app/AppRoot.tsx supabase/migrations/20260915095000_user_preferences_v2.sql
git commit -m "feat: persist and sync language preferences"
```

---

### Task 4: Build the app-interface localization runtime and broad translation-pack set

**Files:**
- Create: `apps/mobile-tv/src/i18n/types.ts`
- Create: `apps/mobile-tv/src/i18n/locale.ts`
- Create: `apps/mobile-tv/src/i18n/I18nProvider.tsx`
- Create: `apps/mobile-tv/src/i18n/useI18n.ts`
- Create: `apps/mobile-tv/src/i18n/resources/index.ts`
- Create: `apps/mobile-tv/src/i18n/resources/*.json`
- Create: `apps/mobile-tv/src/i18n/__tests__/locale.test.ts`
- Create: `apps/mobile-tv/src/i18n/__tests__/resources.test.ts`
- Modify: `apps/mobile-tv/src/app/AppRoot.tsx`

**Interfaces:**
- Produces: `useI18n(): { locale, direction, t, formatNumber, formatDate, languageName }`.
- Consumes: `preferences.appLocale` and shared core language registry.

- [ ] **Step 1: Write failing locale-resolution/resource tests**

Cover exact fallback behavior:

```ts
expect(resolveAppLocale('zh-TW', SUPPORTED_APP_LOCALES)).toBe('zh-Hant');
expect(resolveAppLocale('zh-CN', SUPPORTED_APP_LOCALES)).toBe('zh-Hans');
expect(resolveAppLocale('fr-CA', SUPPORTED_APP_LOCALES)).toBe('fr');
expect(resolveAppLocale('xx-ZZ', SUPPORTED_APP_LOCALES)).toBe('en');
expect(directionForLocale('ar')).toBe('rtl');
```

Resource tests require every locale JSON to contain every key present in `en.json`; no locale with missing baseline keys is exposed in the app-language picker.

- [ ] **Step 2: Define the canonical UI-key baseline**

Initial English resources must cover every currently visible string in auth, navigation, catalog/search/details, settings, loading/error/empty states and TMDB attribution. Use nested keys such as:

```json
{
  "nav": { "home": "Home", "movies": "Movies", "series": "Series", "liveTv": "Live TV", "search": "Search", "settings": "Settings" },
  "settings": { "title": "Settings", "appLanguage": "App language", "audioLanguages": "Preferred audio languages", "subtitleLanguages": "Preferred subtitle languages", "moveUp": "Move up", "moveDown": "Move down", "remove": "Remove" },
  "common": { "back": "Back", "retry": "Retry", "search": "Search", "loading": "Loading…" }
}
```

- [ ] **Step 3: Add the initial broad locale set**

Ship complete baseline packs for these 42 app locales in the first pass:

`en`, `sq`, `fr`, `de`, `it`, `es`, `pt-BR`, `pt-PT`, `tr`, `nl`, `pl`, `ro`, `cs`, `sk`, `hu`, `sv`, `da`, `fi`, `no`, `el`, `bg`, `hr`, `bs`, `sr-Latn`, `sl`, `mk`, `ru`, `uk`, `ar`, `he`, `fa`, `hi`, `bn`, `ur`, `id`, `ms`, `vi`, `th`, `zh-Hans`, `zh-Hant`, `ja`, `ko`.

A locale only appears in `SUPPORTED_APP_LOCALES` when its file passes the key-completeness test. Translation content is checked in as data, not embedded in components.

- [ ] **Step 4: Implement local locale detection without a new runtime dependency**

When `appLocale === 'system'`, obtain the runtime locale from:

```ts
Intl.DateTimeFormat().resolvedOptions().locale
```

Then resolve specific -> parent -> English. Special-case Chinese script/region mapping before parent fallback. Manual selection bypasses device locale entirely.

- [ ] **Step 5: Implement I18nProvider and wrap AppRoot**

`t(key)` resolves selected pack, then English fallback. `languageName(tag)` delegates to shared `displayLanguageName(tag, locale)`. Expose `direction` for screen/layout components.

- [ ] **Step 6: Run i18n tests/typecheck and commit**

```bash
corepack pnpm --filter @moviestv/mobile-tv exec jest src/i18n --runInBand
corepack pnpm --filter @moviestv/mobile-tv typecheck
git add apps/mobile-tv/src/i18n apps/mobile-tv/src/app/AppRoot.tsx
git commit -m "feat: add broad app localization runtime"
```

---

### Task 5: Add searchable App / Audio / Subtitle language settings UI

**Files:**
- Create: `apps/mobile-tv/src/languages/LanguageSearchList.tsx`
- Create: `apps/mobile-tv/src/languages/AppLanguageScreen.tsx`
- Create: `apps/mobile-tv/src/languages/OrderedLanguageScreen.tsx`
- Create: `apps/mobile-tv/src/languages/language-view-model.ts`
- Create: `apps/mobile-tv/src/languages/__tests__/language-view-model.test.ts`
- Create: `apps/mobile-tv/src/languages/__tests__/language-settings.test.tsx`
- Modify: `apps/mobile-tv/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile-tv/src/navigation/PhoneTabs.tsx`
- Modify: `apps/mobile-tv/src/navigation/TVRail.tsx`

**Interfaces:**
- `AppLanguageScreen` is single-select over real translation packs plus `system`.
- `OrderedLanguageScreen` receives `kind: 'audio' | 'subtitle'`, the full core language registry, selected ordered tags, and callbacks from `usePreferences`.

- [ ] **Step 1: Write failing view-model tests for filtering and ordering**

```ts
expect(moveLanguage(['sq', 'fr', 'en'], 'en', -1)).toEqual(['sq', 'en', 'fr']);
expect(removeLanguage(['sq', 'fr', 'en'], 'fr')).toEqual(['sq', 'en']);
expect(addLanguage(['sq', 'fr'], 'sq')).toEqual(['sq', 'fr']);
```

Search tests must match English/localized/native names and `alb` -> Albanian through aliases.

- [ ] **Step 2: Build the reusable searchable list**

Use `FlatList`, stable canonical-tag keys, search input, localized label plus native name, and large focusable rows. Do not render 180+ entries as an unvirtualized `ScrollView`.

- [ ] **Step 3: Build AppLanguageScreen**

Include a first row for `Follow device language`, then only locales present in `SUPPORTED_APP_LOCALES`. Selection immediately calls `setAppLocale` and updates the interface without changing audio/subtitle lists.

- [ ] **Step 4: Build OrderedLanguageScreen**

The selected section is numbered and always offers explicit `Move up`, `Move down`, and `Remove` buttons. The available section contains the complete registry. Audio screen also exposes `Original language` as a semantic preference token handled by the playback ranker; `Any language` remains fallback behavior rather than a stored fake language tag. Subtitle screen includes the independent `Subtitles enabled` toggle.

- [ ] **Step 5: Wire Settings navigation for touch and TV**

Settings presents three distinct entries: `App language`, `Preferred audio languages`, `Preferred subtitle languages`. Navigation must be reachable with touch, keyboard and TV remote focus.

- [ ] **Step 6: Run UI tests and commit**

```bash
corepack pnpm --filter @moviestv/mobile-tv exec jest src/languages --runInBand
corepack pnpm --filter @moviestv/mobile-tv typecheck
git add apps/mobile-tv/src/languages apps/mobile-tv/src/screens/SettingsScreen.tsx apps/mobile-tv/src/navigation
git commit -m "feat: add language selection and ordering UI"
```

---

### Task 6: Localize current application surfaces and apply direction-aware layout

**Files:**
- Modify: `apps/mobile-tv/src/auth/AuthScreen.tsx`
- Modify: `apps/mobile-tv/src/navigation/PhoneTabs.tsx`
- Modify: `apps/mobile-tv/src/navigation/TVRail.tsx`
- Modify: `apps/mobile-tv/src/catalog/CatalogScreen.tsx`
- Modify: `apps/mobile-tv/src/catalog/SearchScreen.tsx`
- Modify: `apps/mobile-tv/src/catalog/MediaDetailsScreen.tsx`
- Modify: `apps/mobile-tv/src/screens/PlaceholderScreen.tsx`
- Modify: `apps/mobile-tv/src/screens/SettingsScreen.tsx`
- Modify: corresponding tests under `apps/mobile-tv/src/**/__tests__`

**Interfaces:**
- Consumes: `useI18n()` only. Catalog title/overview/person/provider data remains provider content and is not run through `t()`.

- [ ] **Step 1: Add a regression test that switches app locale without changing content preferences**

Render with `appLocale='fr'`, `preferredAudioLanguages=['sq','en']`, `preferredSubtitleLanguages=['fr']`; assert navigation/settings copy becomes French while the two ordered preference arrays remain unchanged.

- [ ] **Step 2: Replace current inline UI literals with translation keys**

Do not translate movie titles, actor names, provider names or raw catalog metadata. Translate navigation, buttons, field labels, loading/error/empty states and app-owned explanatory text.

- [ ] **Step 3: Apply direction metadata**

For `direction === 'rtl'`, set text `writingDirection`/alignment and semantic row direction where appropriate. Keep poster artwork, progress direction and media transport meanings unchanged. Add one Arabic rendering smoke test and one English LTR regression test.

- [ ] **Step 4: Run full mobile-tv tests/typecheck and commit**

```bash
corepack pnpm --filter @moviestv/mobile-tv exec jest --runInBand
corepack pnpm --filter @moviestv/mobile-tv typecheck
git add apps/mobile-tv/src
git commit -m "feat: localize current app surfaces"
```

---

### Task 7: Normalize provider language metadata and add deterministic language-aware playback ranking

**Files:**
- Modify: `packages/addons/src/streams.ts`
- Modify: `packages/addons/src/__tests__/resolver.test.ts`
- Create: `packages/playback/src/source-ranking.ts`
- Create: `packages/playback/src/__tests__/source-ranking.test.ts`
- Modify: `packages/playback/src/index.ts`

**Interfaces:**
- Produces: `rankSources(sources: StreamSource[], preferences: { preferredAudioLanguages: string[]; originalLanguage?: string }): StreamSource[]`.
- Consumes: `normalizeLanguageTag` from core and existing provider/source priority order from resolver output.

- [ ] **Step 1: Write failing playback ranking tests**

```ts
const ranked = rankSources([
  { id: 'fr-4k', url: 'a', providerId: 'p1', language: 'fra', quality: '2160p' },
  { id: 'sq-1080', url: 'b', providerId: 'p1', language: 'alb', quality: '1080p' },
  { id: 'en-4k', url: 'c', providerId: 'p1', language: 'eng', quality: '2160p' },
  { id: 'unknown', url: 'd', providerId: 'p1', quality: '2160p' },
], { preferredAudioLanguages: ['sq', 'fr', 'en'] });

expect(ranked.map((source) => source.id)).toEqual(['sq-1080', 'fr-4k', 'en-4k', 'unknown']);
```

Also test same-language quality order, stable ties, original-language semantic preference and unknown fallback.

- [ ] **Step 2: Normalize add-on source language on ingestion**

Any provider alias such as `eng`, `fra`, `alb`, `zho` must leave the add-on normalization boundary as canonical language tags when recognized. Preserve the raw/unknown value only when it cannot be normalized; never discard the source.

- [ ] **Step 3: Implement deterministic source ranking**

Sort key priority:

1. explicit audio preference index;
2. original-language preference token when configured;
3. known quality score (`2160p/4K > 1080p > 720p > 480p > unknown`);
4. original resolver order.

The ranking function must not mutate the input array.

- [ ] **Step 4: Run add-on/playback tests/typechecks and commit**

```bash
corepack pnpm --filter @moviestv/addons exec jest --runInBand
corepack pnpm --filter @moviestv/playback exec jest --runInBand
corepack pnpm --filter @moviestv/addons typecheck
corepack pnpm --filter @moviestv/playback typecheck
git add packages/addons/src packages/playback/src
git commit -m "feat: rank playback sources by language preference"
```

---

### Task 8: Full verification, documentation and merge checkpoint

**Files:**
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml` only if a dedicated translation-resource validation command is added; otherwise keep CI workflow unchanged.
- Create: `docs/superpowers/plans/2026-09-15-multilingual-language-system-completion.md`

**Interfaces:**
- Documents the exact supported app-locale set, broad audio/subtitle registry behavior, fallback rules and known boundary that provider availability determines actual tracks/sources.

- [ ] **Step 1: Add README language behavior**

Document the three independent language settings, the initial 42 app-interface locales, the complete ISO 639-1 audio/subtitle catalog, device-language fallback, RTL behavior and the fact that selecting a language cannot manufacture a stream/track that a provider does not supply.

- [ ] **Step 2: Run exact full-repository verification**

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

Expected: all four commands exit 0.

- [ ] **Step 3: Verify no regression in existing foundation flows**

The final app test set must still cover: missing Supabase config, session restoration/sign-in, phone navigation, TV rail focusability, catalog browsing/search/details, provider-core tests and preference conflict handling.

- [ ] **Step 4: Write completion record with exact test counts and CI run**

Record the final commit SHA and GitHub Actions run only after the exact implementation head passes CI; do not copy counts from earlier runs.

- [ ] **Step 5: Commit and open PR against `main`**

```bash
git add README.md docs/superpowers/plans/2026-09-15-multilingual-language-system-completion.md
git commit -m "docs: record multilingual language system completion"
```

PR summary must explicitly state that app locale, audio priorities and subtitle priorities are independent and that the provider/player uses canonical language tags.

---

## Self-review against the approved spec

- **App-language independence:** Tasks 3-6.
- **Broad app-language coverage:** Task 4 ships 42 real baseline translation packs and keeps resources extensible.
- **Broad audio/subtitle catalog:** Task 1 ships the full ISO 639-1 registry plus ISO 639-2/provider aliases and BCP 47 variants.
- **Search and ordering UI:** Task 5.
- **TV move-up/move-down controls:** Task 5.
- **Device-locale first launch and manual override:** Tasks 3-4.
- **English fallback:** Task 4.
- **Regional/script variants:** Tasks 1 and 4.
- **RTL:** Tasks 1, 4 and 6.
- **Persistence and account sync:** Tasks 2-3.
- **Provider/player integration:** Task 7.
- **Unknown-language fallback:** Tasks 1 and 7.
- **Formatting/display names:** Task 4.
- **Regression and full CI verification:** Task 8.

No application-code implementation begins until this plan is accepted for execution.