# MKV playback results — 2026-11-18

Platform: macOS 27.2 (arm64), Chrome 152 via the OpenCode browser, WebKit via
WKWebView (the DMG's engine and Safari's engine). Media: generated with
ffmpeg 9.0.2, 12 s, H.264 High, 440 Hz sine, AAC-LC or E-AC-3.

## Deliverables

| Item | Path / command |
| --- | --- |
| DMG | `apps/desktop-mac/build/MoviesTv-Flix.dmg` (74 KB, ad-hoc signed) |
| App bundle | `apps/desktop-mac/build/MoviesTv-Flix.app` |
| Rebuild | `apps/desktop-mac/build.sh --dmg` |
| Run against a local web build | `apps/desktop-mac/build/MoviesTv-Flix.app/Contents/MacOS/MoviesTv-Flix --url http://localhost:8081` |
| PWA (local) | `pnpm build:pwa && cd apps/mobile-tv/dist && node <static-server> . 8081` → `http://localhost:8081` |
| PWA (deployed) | `https://7c8912c2.moviestv-flix.pages.dev/` |
| Remux service | `node services/remux/server.mjs` → `http://localhost:8790` |

## Engine facts that decide playability

`canPlayType` and real playback disagree across engines, so both were measured:

| Source | Real container / audio (ffprobe) | WebKit | Chromium |
| --- | --- | --- | --- |
| `control-720p-h264-aac.mp4` | MP4 / H.264 / AAC | plays, seek ok | plays |
| `movie-1080p-h264-aac.mkv` | Matroska / H.264 / AAC | **`MEDIA_ERR_SRC_NOT_SUPPORTED`** | plays |
| `movie-1080p-h264-eac3.mkv` | Matroska / H.264 / E-AC-3 | **`MEDIA_ERR_SRC_NOT_SUPPORTED`** | plays video |
| MP4 + AC-3/E-AC-3 (capability only) | — | `probably` | **`no`** |

Conclusion: in the DMG the blocking fact is the **Matroska container**, not the
resolution or the video codec. On the PWA the blocking fact depends on the
engine: Matroska in Safari, AC-3/E-AC-3 audio in Chromium.

## macOS DMG — mounted at `/Volumes/MoviesTv-Flix`

| Test | Command | Result |
| --- | --- | --- |
| MKV H.264/AAC 1080p | `--native-test <mkv> out.json` | `playing true`, `hasVideo true`, `audioTracks 2`, `timeMs 6960/12023`, after seek 8 s: `10582`, still playing |
| MKV H.264/E-AC-3 1080p | `--native-test <mkv> out.json` | `playing true`, `hasVideo true`, `audioTracks 2`, `timeMs 7021/12006`, after seek 8 s: `10702`, still playing |
| JS bridge → native | `--bridge-test <page> out.json` | `playerWindow true`, page text `PLAY_SENT`, `playing true`, `hasVideo true`, `timeMs 5427` |
| Loads the app | `--smoke-test --url http://localhost:8081` | `Loaded http://localhost:8081/` |
| Loads the deployed PWA | `--smoke-test` | `Loaded https://7c8912c2.moviestv-flix.pages.dev/` |

Startup, audio track presence and seeking all pass. Audio is verified as a live
track (`libvlc_audio_get_track_count` returns 2: "disable" plus one stream) plus
`hasVideo`; it was not verified by listening.

## PWA — WebKit (Safari engine), page served from the PWA origin

| Test | Result |
| --- | --- |
| MKV direct | `NotSupportedError`, `MEDIA_ERR_SRC_NOT_SUPPORTED` — reproduces the reported bug |
| Remuxed HLS from MKV/AAC | plays 1920×1080, duration 12 s, seek to 3 s → 4.11 s |
| Remuxed HLS from MKV/E-AC-3 | plays 1920×1080, duration 12 s, seek to 3 s → 4.11 s |

## PWA — Chromium

| Test | Result |
| --- | --- |
| MP4 H.264/AAC (regression) | plays 1280×720, 12 s |
| Remux handshake from the PWA origin | `POST /sessions` → 201, playlist 200 `application/vnd.apple.mpegurl`, segment 200, 6.8 MB |
| Remuxed HLS via hls.js | plays 1920×1080, 12.09 s, seek 8 s → 9.19 s |

## Regressions checked

- MP4 direct playback: Chromium and WebKit both play.
- HLS playback: WebKit native HLS and Chromium hls.js both play a remuxed
  playlist (the app's two HLS paths).
- `pnpm build:pwa` passes: export verifier reports 7 required files, 2 icons,
  23 files scanned.

## Blockers and limits

1. **Remux service is not deployable on the current hosting.** Cloudflare
   Workers cannot run ffmpeg. It needs a separate container service (Node 22 +
   ffmpeg, HTTPS, CORS for the Pages origin) and a PWA rebuild with
   `EXPO_PUBLIC_REMUX_URL`. Until then, MKV in Safari and AC-3/E-AC-3 in
   Chromium stay unplayable on the PWA, with an actionable error.
2. **No real provider was available in this session**, so the React screen was
   not driven end to end against a provider stream. Each layer was verified
   separately: engine behaviour, service, native player, bridge, and the app's
   own attach/fallback logic through unit tests.
3. **Audio is track-level evidence, not listening.** Volume and channel layout
   were not assessed.
4. **The DMG is ad-hoc signed and not notarized**; it runs locally, and is not a
   distribution artifact.
5. **libVLC 3 can only forward User-Agent and Referer.** Providers that require
   another header (a custom token header, for example) will still fail in the
   DMG; the PWA can forward any allow-listed header to the remux service.
