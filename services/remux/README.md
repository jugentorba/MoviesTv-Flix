# Remux service

Turns a source the browser cannot play into HLS **without re-encoding the
video**, so an MKV becomes playable in WebKit and an AC-3/E-AC-3 track becomes
playable in Chromium.

## What it does per source

1. `ffprobe` reads the first audio stream of the source.
2. ffmpeg runs with `-c:v copy`: the original H.264 bitstream is copied into
   HLS segments. Nothing is re-encoded, so there is no quality loss and startup
   does not wait for a transcode.
3. Audio is copied when it is AAC, MP3, Opus, Vorbis or FLAC, and transcoded to
   AAC 192k stereo **only** when it is not (AC-3, E-AC-3, DTS, TrueHD, PCM...).

Seeking works because the playlist is an `EVENT` playlist of keyframe-aligned
segments; the player fetches the segment it needs.

## Run

```bash
node services/remux/server.mjs
# GET  /health
# POST /sessions   {"url": "...", "headers": {"Referer": "..."}}
#      -> {"id", "playlist": "/sessions/<id>/index.m3u8", "audio": "copy|transcode-aac"}
# GET  /sessions/<id>/index.m3u8
# GET  /sessions/<id>/seg-00000.ts
# DELETE /sessions/<id>
```

Environment: `PORT` (8790), `REMUX_ALLOWED_ORIGINS` (`*`), `FFMPEG_PATH`,
`FFPROBE_PATH`, `SESSION_TTL_MS` (15 min), `MAX_SESSIONS` (4).

Point the app at it with `EXPO_PUBLIC_REMUX_URL=http://localhost:8790`.

## Security

- The signed URL and the provider headers travel in a **POST body**, never a
  query string, so they do not end up in access logs, `Referer` headers or
  browser history.
- The service returns an opaque session id; every later request carries only
  that id.
- Only an allow-list of provider headers is forwarded (`user-agent`, `referer`,
  `origin`, `cookie`, `authorization`, `accept*`, `x-api-key`, `x-auth-token`),
  and header values are stripped of CR/LF.
- Logs contain session ids and the audio decision, never a URL or a token.
- Sessions expire (TTL) and are capped, and ffmpeg is killed with the session.

## Hosting: what exists and what this needs

The current hosting is Cloudflare Pages + Workers (`worker/`, `functions/api`).
**A Worker cannot run this service**: Workers have no child processes and no
native binaries, and ffmpeg cannot be bundled into one. Cloudflare Stream or
Media Transformations would do it, but that is a paid product.

So the fallback needs one additional deployment:

- a container host that can run `node:22` with `ffmpeg` installed
  (Fly.io, Railway, Render, a VPS, or a home server),
- HTTPS on a stable hostname (mixed content blocks an `http://` service from the
  `https://` PWA),
- CORS for the PWA origin (`REMUX_ALLOWED_ORIGINS=https://<your>.pages.dev`),
- egress that can reach the providers, plus the CPU/RAM for one ffmpeg process
  per active session (`MAX_SESSIONS` bounds it),
- the PWA rebuilt with `EXPO_PUBLIC_REMUX_URL=https://<service-host>`.

What works with today's hosting and no extra deployment:

- direct playback of browser-compatible sources (MP4/MOV/M4V, HLS, and MKV in
  Chromium),
- the macOS DMG, which needs no service at all because libVLC plays the MKV
  locally,
- every MP4/HLS path on the PWA.

What does **not** work without the extra deployment: MKV in Safari and
AC-3/E-AC-3 audio in Chromium, on the PWA.
