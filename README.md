# MoviesTv-Flix

Cross-device Expo foundation for iPhone, iPad, Android phones/tablets,
Android TV, and Apple TV. Touch devices use bottom navigation; TVs use a
focus-visible left rail designed for remote controls.

## Project status

For the dated, evidence-graded snapshot of implemented, partial, blocked and
planned work, see [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). Permanent
development rules for contributors and AI agents live in
[`AGENTS.md`](AGENTS.md).

## Requirements

- Node.js 22
- pnpm 11.25.0 through Corepack

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Keep Supabase credentials in `.env`; never commit them.

## Run

```bash
# Phone and tablet development server
pnpm --filter @moviestv/mobile-tv start

# Generate Android TV / Apple TV native projects
EXPO_TV=1 pnpm --filter @moviestv/mobile-tv exec expo prebuild
```

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Language system

MoviesTv-Flix keeps three language choices independent:

1. **App language** controls MoviesTv-Flix menus, settings, messages and other app-owned UI.
2. **Preferred audio languages** is an ordered list used to rank playback sources and audio metadata.
3. **Preferred subtitle languages** is a separate ordered list, with its own subtitles-enabled setting.

Changing the app language never rewrites audio or subtitle priorities. Signed-in users synchronize the ordered preferences across devices through the existing preference-sync layer. Choosing **Follow device language** keeps the app UI tied to each device locale; a manual app-language choice overrides that behavior until the user selects Follow device language again.

### App interface locales

The initial interface ships 42 locale packs:

`en`, `sq`, `fr`, `de`, `it`, `es`, `pt-BR`, `pt-PT`, `tr`, `nl`, `pl`, `ro`, `cs`, `sk`, `hu`, `sv`, `da`, `fi`, `no`, `el`, `bg`, `hr`, `bs`, `sr-Latn`, `sl`, `mk`, `ru`, `uk`, `ar`, `he`, `fa`, `hi`, `bn`, `ur`, `id`, `ms`, `vi`, `th`, `zh-Hans`, `zh-Hant`, `ja`, `ko`.

English is the final string fallback. RTL locales expose RTL direction metadata while media artwork and playback semantics remain unchanged.

### Audio and subtitle languages

Audio and subtitle pickers use the shared ISO 639-1 language registry rather than a short hand-written list. Provider aliases and common ISO 639-2 forms are normalized to canonical BCP 47 / ISO tags where recognized, for example `eng → en`, `fra/fre → fr`, `alb/sqi → sq`, and `zho/chi → zh`. Regional/script variants such as `pt-BR` and `zh-Hant` remain representable.

Users can select multiple languages, search the catalog, remove entries, and explicitly move each language up or down. The same controls are usable with touch, keyboard and TV remote focus.

Playback source ranking evaluates explicit audio-language priority before quality. A known original language can be used as a fallback bucket after explicit preferences. Equal-ranked streams preserve the resolver/provider order, and sources with unknown language metadata remain playable fallbacks. Selecting a preferred language cannot create an audio track, subtitle, or stream that the active provider did not supply.

## Current application state

MoviesTv-Flix now includes the working application layers that were originally
planned after the foundation phase:

- User-installed Movies and Series catalogs with real series/episode navigation.
- Automatic multi-provider stream resolution, language-aware ranking, manual
  source switching, playback fallback, watch progress and next-episode flow.
- Built-in native and PWA video surfaces, including HLS.js support on web.
- External and embedded subtitle selection with preferred-language ordering
  and automatic fallback when an external subtitle source fails.
- Separate management for user-installed catalogs, Movies/Series playback sources,
  and Live TV sources, with sensitive provider values kept device-local.
- IPTV-style Live TV with country/search filters, favorites, channel drawer,
  next/previous zapping, source switching and automatic provider fallback.
- Optional XMLTV programme guide with Now/Next and per-channel timeline.
- Library/My List, continue-watching progress and synchronized preferences.
- Phone, TV and wide tablet/desktop navigation.
- Installable PWA with versioned app-shell cache, offline shell fallback,
  sensitive-request/private-response cache bypasses, baseline Cloudflare
  security headers and iPhone Home Screen metadata.
- Email/password account UI and Supabase synchronization boundaries.

### Account and device synchronization

When Supabase is configured, preferences, My List, Live TV favorites,
watch progress and safe provider metadata synchronize by signed-in user.
Guest data is promoted into the first account that signs in on that device.
Local caches, provider metadata and provider secrets are identity-scoped so
switching accounts does not expose the previous account's state.

Provider passwords, tokens, debrid/API keys and private configured manifest
URLs are never synchronized to Supabase. Native apps keep them in the
on-device secure store, so they must be entered separately on each device.
In the PWA, these values are kept only in memory: reloading or closing the
web app clears them and requires re-entry. Public provider metadata can still
synchronize; it does not include the private values.

The PWA can receive the public Supabase URL and publishable key at build time
or through the same-origin Cloudflare runtime-config endpoint. Preview builds
on web, iOS, Android and TV can also save the same public URL/key from
**Settings → Account → Manual sync setup**, so account synchronization does not
require rebuilding the app. Never expose a Supabase service-role key to the client.

### Remaining release work

The largest remaining release task is real-device QA across the PWA and native
targets. Android phone, Android TV, iPhone/iPad and Apple TV preview artifacts
have all been produced and passed their independent artifact verifiers
(2 October 2026, `preview-latest`). The Apple builds are intentionally unsigned
and require external re-signing. Install, playback, in-place update and
re-signing checks on physical devices remain pending, as do the live Cloudflare
deployment and update-gateway checks.

The detailed build IDs, checksums and pending device checks live in
`docs/builds/preview-artifact-checklist.md`.

