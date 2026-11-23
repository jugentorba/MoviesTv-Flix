# MoviesTv-Flix Multilingual Language System Design

**Date:** 2026-09-15

## Goal

MoviesTv-Flix must be usable by people from many countries without tying language behavior to the device language. The app needs three independent language systems:

1. **App interface language** — controls MoviesTv-Flix menus, labels, errors, settings and player UI.
2. **Preferred audio languages** — an ordered list used when ranking streams/audio tracks.
3. **Preferred subtitle languages** — an ordered list used when ranking subtitle tracks.

Changing one must never silently change the others.

## Core principles

- The user can always choose a language manually inside MoviesTv-Flix, even when that language is not the current phone/TV language.
- Device language is only the first-launch default for the app interface when a matching translation pack exists.
- Audio and subtitle language catalogs are much broader than the set of translated UI languages.
- Audio and subtitle preferences support multiple selections with explicit priority ordering.
- Language identifiers use normalized BCP 47 / ISO language codes rather than English display names as persisted identity.
- Unknown or missing provider language metadata must remain playable rather than being discarded.
- English is the final UI fallback when a translated string is missing.

## 1. App interface language

### Behavior

Settings contains **App language**. Opening it shows a searchable full-screen/modal language picker appropriate to the device form factor.

The picker is independent of the OS language picker. A user can therefore run the phone in French and MoviesTv-Flix in Chinese, Albanian, Turkish, Arabic or another supported language.

At first launch:

1. inspect the device locale;
2. use the closest MoviesTv-Flix translation pack if available;
3. otherwise use English;
4. once the user manually chooses an app language, persist that choice and stop following future device-language changes unless the user selects **Follow device language** again.

### Translation coverage

The localization architecture must support a large and expandable set of BCP 47 locales rather than hard-coding two or three languages.

Initial implementation should include a broad set of real translation packs covering major world languages and the project's priority languages, including at minimum Albanian, English, French, German, Italian, Spanish, Portuguese, Turkish, Chinese, Japanese, Korean, Arabic and other widely used European/Asian languages. Additional packs can be added without changing application code.

A language must not be presented as a fully translated app language if no translation pack exists. Missing individual keys inside a real pack fall back to English.

### Locale variants

The system supports regional/script variants where materially different, for example:

- `zh-Hans` — Simplified Chinese
- `zh-Hant` — Traditional Chinese
- `pt-BR` / `pt-PT`
- `es-ES` / future regional Spanish packs when useful

The locale resolver falls back from a specific locale to its parent where appropriate, then to English.

### RTL

Arabic, Hebrew, Persian and other right-to-left interface languages require RTL-aware layout. Navigation, text alignment and row direction must be tested without reversing media artwork or playback controls incorrectly.

## 2. Audio language catalog

### Coverage

The audio selector should expose as many real languages as provider/player metadata can identify. It must not be a short hand-written list.

Use a comprehensive language registry based on standard BCP 47 / ISO language identifiers, with normalization for common provider aliases and legacy codes. Examples include:

- `en`, `eng` -> English
- `fr`, `fra`, `fre` -> French
- `sq`, `sqi`, `alb` -> Albanian
- `zh`, `zho`, `chi` -> Chinese
- region/script tags such as `pt-BR`, `zh-Hant` remain representable

The registry should support the common ISO 639-1 / ISO 639-2 language space used by streaming metadata, while remaining able to preserve more specific BCP 47 tags supplied by providers.

### Preference UI

Settings contains **Preferred audio languages**.

Opening it shows a searchable language window. The user can select any number of languages. Selected languages appear in a separate ordered section.

Example:

1. Albanian
2. French
3. English
4. German
5. Italian

Phone/tablet/web can support drag-to-reorder plus accessible move controls. TV must always provide explicit **Move up** and **Move down** actions usable by remote control.

### Playback ranking

When sources or audio tracks have language metadata, preference order is evaluated before quality/provider tie breakers.

For example, with `Albanian -> French -> English`:

- an Albanian source is preferred over a French source;
- a French source is preferred over an English source;
- within the same language preference bucket, quality and provider/source priority decide the order.

Unknown-language sources remain eligible as fallback.

Special non-language choices are modeled separately from real languages:

- **Original language** — prefer the title's known original language when available;
- **Any language** — accept any source after explicit priorities;
- **Unknown** is metadata state, not a selectable language preference.

## 3. Subtitle language catalog

Settings contains **Preferred subtitle languages** and uses the same comprehensive searchable language registry and ordered-selection interaction as audio.

Subtitle preference order is independent from audio preference order.

The user may therefore choose, for example:

- Audio: Albanian -> French -> English
- Subtitles: Albanian -> English -> French

The player should still allow a one-time manual subtitle/audio override without rewriting the saved global order unless the user explicitly chooses to save it.

A separate **Subtitles off** preference remains available.

## 4. Language registry

Create one shared language metadata module rather than duplicating language lists across settings, providers and playback.

Each language entry should contain stable machine identity and display metadata, for example:

```ts
interface LanguageDefinition {
  canonicalTag: string;
  iso6391?: string;
  iso6392?: string[];
  englishName: string;
  nativeName?: string;
  aliases: string[];
  direction: 'ltr' | 'rtl';
}
```

Persist canonical tags only. Display labels are generated from the currently selected app locale when possible, with native-name/English fallbacks.

Normalization must be case-insensitive and tolerant of provider strings such as `EN`, `eng`, `English`, `fra`, or full BCP 47 tags when recognized.

## 5. Persistence and account sync

User preferences gain independent fields for:

```ts
interface LanguagePreferences {
  appLocale: string | 'system';
  preferredAudioLanguages: string[];
  preferredSubtitleLanguages: string[];
  subtitlesEnabled: boolean;
}
```

The arrays are ordered priorities, not sets.

These preferences are safe non-secret data and should synchronize across signed-in devices through the existing preference-sync layer.

Device-specific behavior:

- app language syncs across devices once explicitly selected;
- `system` means each device follows its own OS locale;
- audio/subtitle priority order syncs identically across devices.

Conflict resolution follows the existing timestamp-based preference merge rules.

## 6. UI requirements

All language pickers must support:

- search by localized name, English name and common language name;
- native language label where available;
- selected/unselected state;
- large TV focus targets;
- keyboard/touch/remote operation;
- fast rendering for a large language catalog;
- clear ordered numbering for selected audio/subtitle languages;
- move up/down controls on TV;
- remove from preference list without removing the language from the master catalog.

The app-language picker is single-select. Audio and subtitle pickers are multi-select plus reorder.

## 7. Provider and player integration

Provider adapters normalize any declared source language to canonical tags before returning candidates.

Playback source ranking uses:

1. explicit audio language preference rank;
2. known source quality;
3. configured provider priority;
4. original stable source order.

Track-level player selection should reuse the same normalizer when a container exposes multiple audio or subtitle tracks.

A source is never rejected only because its language is unknown or not selected; language preference is ranking, not censorship.

## 8. Translation architecture

UI strings are keyed resources, not inline translated literals in components.

Recommended shape:

```text
apps/mobile-tv/src/i18n/
  index.ts
  locale.ts
  resources/
    en.json
    fr.json
    sq.json
    de.json
    zh-Hans.json
    zh-Hant.json
    ...
```

English is the canonical key-completeness baseline. CI should verify that translation JSON is valid and that no locale contains unknown/duplicate keys. Missing keys are allowed during expansion but visibly fall back to English in development diagnostics.

Catalog titles, movie descriptions and provider metadata are content data and should not be confused with app UI translations.

## 9. Accessibility and formatting

The selected app locale also controls locale-sensitive presentation where practical:

- dates;
- numbers;
- durations;
- language display names.

Do not translate provider names, movie titles or person names unless the catalog provider supplies localized metadata.

Search matching should be Unicode-safe and diacritic-tolerant where feasible.

## 10. Testing

The implementation needs automated coverage for:

- device-locale first-launch selection;
- manual app-language override and persistence;
- fallback to English for missing UI strings;
- BCP 47 parent fallback;
- RTL locale detection;
- language alias normalization (`eng/en`, `fra/fre/fr`, `sqi/alb/sq`, `zho/chi/zh`);
- audio priority ordering;
- subtitle priority ordering;
- unknown-language playback fallback;
- preference synchronization preserving array order;
- TV move-up/move-down ordering;
- app-language choice remaining independent from audio/subtitle choices.

## 11. Scope boundaries

This subsystem defines language identity, UI localization and preference ordering. It does not promise that every external stream contains every requested audio/subtitle language. MoviesTv-Flix can only rank/select tracks and sources that providers actually return.

Likewise, the architecture can support a very large number of app locales, but a locale should appear as a translated UI language only when a corresponding translation pack exists. The system is deliberately structured so new translation packs require data additions rather than component rewrites.

## Approved product behavior captured from discussion

- App interface language must support many languages, not only English/French.
- The app language can be selected manually regardless of the phone/TV language.
- Chinese and other major world languages are first-class interface targets.
- Audio language selection uses a very large standards-based language catalog.
- Subtitle language selection uses the same broad catalog.
- Audio and subtitle languages can be selected in multiples and manually ordered by preference.
- App, audio and subtitle language settings remain independent.
