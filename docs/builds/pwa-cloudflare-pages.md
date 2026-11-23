# MoviesTv-Flix PWA on Cloudflare

MoviesTv-Flix supports two Cloudflare Git deployment paths from the same `main` branch:

1. **Cloudflare Pages** with the repository-root `functions/api/[[path]].js` compatibility route.
2. **Cloudflare Workers Builds** with `wrangler.jsonc`, `worker/index.js`, and Workers Static Assets.

Both paths serve the Expo PWA from `apps/mobile-tv/dist`. Both can expose the same-origin runtime account configuration and catalog proxy routes under `/api/*`.

## Shared build settings

Repository:

`jugentorba/MoviesTv-Flix`

Production branch:

`main`

Build command:

```bash
pnpm build:pwa
```

The build runs lint and the full workspace test suite, then a web-targeted TypeScript check covering the app entry and generic/web source tree, Expo export, and the static-output verifier. The web typecheck resolves `.web` modules before generic modules and excludes native-only roots; the general workspace typecheck remains separate because native platform resolution is not a valid Cloudflare PWA gate.

Build environment:

```text
EXPO_TV=0
EXPO_PUBLIC_PREVIEW_MODE=1
NODE_VERSION=22
PNPM_VERSION=11.25.0
```

Preview mode remains usable without Supabase configuration. Production starts with no bundled catalog; users add their own catalog manifest. Demo fixtures require the explicit `EXPO_PUBLIC_DEMO_CATALOG=1` development flag.

### TV browser layout fallback

The PWA auto-detects common Android TV, Google TV, Fire TV, Tizen, webOS,
Bravia and Chromecast TV browser user agents. Some television browsers expose a
generic Android/Chromium user agent, so **Settings → App → TV interface on this
browser** provides a device-local override. If the remote cannot reach Settings
before TV navigation is active, open the PWA once with `?tv=1`; that explicit
bootstrap is persisted to the same device-local override. The switch is stored
only in that browser and is not synchronized with the user's phone/tablet
preferences.

### Git deployment trigger policy

The checked-in GitHub Actions workflows are manual-only (`workflow_dispatch`), so
normal source commits do not spend GitHub Actions minutes. Do **not** prefix normal
source commits with `[skip ci]` while the Cloudflare Git integration is being used
as the PWA verification path: Cloudflare Pages interprets that marker as an explicit
request to skip its build/deployment too. Reserve skip markers for commits that are
intentionally not meant to deploy.

## Option A: existing Cloudflare Pages project

Keep the current Pages Git project if it is already connected.

Use:

- framework preset: **None**
- root directory: repository root / blank
- build command: `pnpm build:pwa`
- build output directory: `apps/mobile-tv/dist`

The repository-root Pages Function:

`functions/api/[[path]].js`

reuses `worker/index.js` for the supported API routes. The exported `_routes.json` limits Pages Functions to:

`/api/*`

Static app requests continue through normal Pages serving. Pages automatically treats a project without a top-level `404.html` as an SPA and routes unmatched static paths to the root app, so no catch-all `_redirects` rewrite is required.

## Option B: Cloudflare Workers Builds

A Workers Git deployment can use the repository's `wrangler.jsonc` directly.

The Worker configuration provides:

- `main: ./worker/index.js`
- static assets from `./apps/mobile-tv/dist`
- SPA fallback through `not_found_handling: single-page-application`
- Worker-first execution for `/api/*`
- the `ASSETS` binding for all other static PWA requests

In Workers Builds, use `pnpm build:pwa` as the build command. The normal deploy command can remain Wrangler deploy so the checked-in Worker and static-assets configuration are published together.

## Account sign-in and synchronization

To activate account sign-in and cross-device synchronization, configure the public Supabase client values:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<public publishable key>
```

They can be embedded at build time. When build-time values are absent, the web app requests:

`/api/runtime-config`

and upgrades from guest mode when both valid public values are available.

For runtime configuration, set the same two **public** values in the Cloudflare project's runtime Variables/Secrets area so the Worker or Pages Function can read them.

If those Cloudflare values are not configured yet, the deployed PWA also exposes
**Settings → Account → Manual sync setup**. The app validates the public Supabase
URL/key, rejects secret/service-role credentials, stores only the public client
configuration locally, and activates the normal sign-in/create-account flow
without a rebuild. **Change synchronization setup** signs out first when needed
and removes the locally saved backend so a wrong project can be replaced.

Before enabling account sync on a production deployment, apply every checked-in
Supabase migration in timestamp order, including
`20260920123000_preference_conflict_guard.sql`,
`20260920133000_sync_stale_write_guards.sql`, and
`20260921163000_allow_season_zero_watch_progress.sql`. The conflict guards
prevent an older device write from replacing newer preferences, provider
metadata, or watch progress, while the Season 0 migration allows Specials
progress such as S0E1 to synchronize correctly.

Never expose a Supabase service-role key to the client or runtime-config response.

Do **not** add:

- `SUPABASE_SERVICE_ROLE_KEY`
- provider passwords/tokens
- resolved playback URLs
- Apple certificates/private keys
- third-party IPA signer credentials
- Google Play signing material

## Native app update channel

MoviesTv-Flix uses the same Cloudflare deployment as the stable native update
gateway. Native preview workflows publish a moving private GitHub Release tagged
`preview-latest`. The release keeps the latest signed APKs/re-signable IPAs plus
`MoviesTv-Flix-update-manifest.json`.

The public client-facing endpoints are:

- `/api/app-update/manifest`
- `/api/app-update/android.apk`
- `/api/app-update/android-tv.apk`
- `/api/app-update/ios.ipa`
- `/api/app-update/tvos.ipa`

The source repository stays private. Cloudflare reads the private
`preview-latest` release server-side and streams only the requested update
asset. Configure this runtime secret on the Cloudflare project:

```text
GITHUB_RELEASE_TOKEN=<read-only fine-grained GitHub token>
```

Give that token access only to `jugentorba/MoviesTv-Flix` and only the minimum
repository read permissions needed to read releases/assets. Store it as a
Cloudflare **secret**, never as an `EXPO_PUBLIC_*` variable and never in the
static PWA bundle. The native build workflows themselves publish the release
with their scoped GitHub Actions token; the Cloudflare token is read-only.

If `GITHUB_RELEASE_TOKEN` is absent or the release has not been published yet,
`/api/app-update/manifest` safely falls back to the checked-in baseline manifest
and package downloads remain unavailable. This prevents the app from offering a
package it cannot retrieve.

Android update entries are pinned to package
`com.jugentorba.moviestvflix` and the preview signing-certificate SHA-256. The
manifest writer and export verifier reject a mismatched package/signing channel.
Each GitHub Android preview build uses an increasing `versionCode`, so Android
can install the new APK over the existing app while retaining application data.
Android still presents its normal package-install confirmation.

iPhone/iPad update entries are pinned to bundle
`com.jugentorba.moviestvflix`. The in-app update action saves the re-signable
IPA into the MoviesTv-Flix Documents area exposed through the iOS Files app.
The IPA still requires signing/installing with the user's normal iOS sideloading
method. PWA updates continue to use the same URL and service-worker refresh path.

## API behavior

The Cloudflare runtime supports:

- `/api/runtime-config`
- `/api/cinemeta/*`
- `/api/nuvio-catalog/*`

Catalog proxying is restricted to manifest/catalog/meta requests. It is not an arbitrary stream proxy.

Provider streams can still fail in a browser when the provider itself blocks browser requests with CORS, mixed-content restrictions, unsupported headers, or another web security policy. MoviesTv-Flix should report that provider/source as unavailable and continue its normal fallback logic.

Private provider passwords, tokens, debrid/API keys and private manifest URLs
are held only in PWA memory. They are not saved to browser storage or Supabase;
a reload or closed PWA session requires re-entry. This is different from the
native apps' device-local secure storage. Do not include these values in QA
screenshots or build configuration.

## What the build verifies

The PWA export verifier requires:

- `index.html`
- `manifest.webmanifest`
- `service-worker.js`
- `_headers`
- `_routes.json`
- 192×192 and 512×512 install icons whose declared PNG dimensions match
  the actual image headers, with icon paths constrained to the exported app root
- Pages routing that includes `/api/*` and does not exclude `/api`, any
  `/api/*` subroute, or the whole application
- a stamped/versioned service-worker cache
- stable PWA install identity (`id`, launch URL, and scope)
- no-cache headers for the service worker and web manifest
- baseline static security headers: MIME sniffing protection, frame denial,
  strict-origin referrer policy, and disabled camera/microphone/geolocation
- service-worker guards that avoid caching API/auth/Supabase REST/realtime/storage traffic
- service-worker bypass for credential-bearing request headers and sensitive query values
- service-worker refusal to cache responses marked `private` or `no-store`
- no forbidden private-key/service-role/credentialized-provider markers in
  generated text assets, including credential-bearing URL path segments
- no embedded resolved media URLs in generated text assets
- no signing/provisioning artifacts such as private keys, keystores, P12/PFX,
  or mobile provisioning profiles in the public static export

The service worker caches only the same-origin application shell and static
script/style/image/font assets. Navigation is network-first with a cached shell
fallback. Credential-bearing requests and responses explicitly marked
`private`/`no-store` remain network-only.

Cloudflare Workers Static Assets honors the checked-in `_headers` file for
static responses. Worker-generated `/api/*` responses set their own cache and
MIME-sniffing headers in `worker/index.js`.

## Deployment checks

After a preview deployment succeeds:

1. Open **Settings → Preview diagnostics** on the physical device. The page must identify the current platform/layout and must not display provider keys or private URLs.
2. Confirm the diagnostics page can reach `/manifest.webmanifest`, `/service-worker.js`, `/api/runtime-config`, `/api/nuvio-catalog/manifest.json`, and `/api/cinemeta/manifest.json`.
3. For an installed PWA, confirm **Install mode** reports **Standalone PWA**, the service worker reports **Active**, and **PWA build** shows a 16-character build ID. Record that ID with screenshots so stale Home Screen installs can be distinguished from the latest deployment. A normal browser tab may report a warning for install mode.
4. Add a catalog manifest in **Settings → Sources → Catalogs** and confirm that catalog loads.
5. Confirm Add to Home Screen / install behavior on a supported browser.
6. With public Supabase runtime values configured, open **Settings → Account** and confirm sign-in/create-account is available.
7. Confirm provider secrets and resolved stream URLs are absent from generated static assets.
8. Test movie/series playback and Live TV separately because browser provider CORS and codec behavior can differ from native apps.
9. On Android/Smart-TV browsers, confirm Diagnostics reports **Layout: tv**, then verify D-pad focus, Back, channel drawer, and zapping with the real remote.

The Diagnostics page is a preview QA aid. Its green checks do not replace the
artifact verifier, a real playback test, or the external checklist evidence.
