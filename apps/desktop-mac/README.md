# MoviesTv-Flix for macOS

A small AppKit host for the same web build the PWA serves, plus one thing a
WKWebView cannot do on its own: play Matroska.

## Why this exists

WebKit has no Matroska demuxer. In the DMG every MKV source fails with
`MEDIA_ERR_SRC_NOT_SUPPORTED`, whatever its video codec is — measured on macOS
27.2, see `docs/builds/mkv-engine-matrix.md`. Chromium is the opposite case: it
plays H.264/AAC MKV but cannot decode AC-3/E-AC-3.

The wrapper therefore injects a small bridge before the page loads:

```js
window.__MOVIESTV_NATIVE__ = {
  play({ url, headers, title, rect, startAt }) { /* postMessage */ },
  stop() { /* postMessage */ },
};
```

When the web player decides a source is unplayable it calls `play()`. The native
side opens an overlay window exactly over the HTML video element and plays the
source with **libVLC**, with play/pause, a seek slider, a time readout and a
close button. The rest of the UI stays the web UI.

The signed URL and provider headers cross one `postMessage` and are never
written to the page, to `localStorage` or to a log. `User-Agent` and `Referer`
are forwarded to VLC as media options; VLC 3 has no option for arbitrary
headers, so any other provider header is ignored (documented limitation, not a
silent one: the app still fails over to another source).

## Build

```bash
apps/desktop-mac/build.sh            # .app only
apps/desktop-mac/build.sh --dmg      # .app + .dmg
apps/desktop-mac/build.sh --arch universal --dmg
```

Output:

- `apps/desktop-mac/build/MoviesTv-Flix.app`
- `apps/desktop-mac/build/MoviesTv-Flix.dmg`

The build is ad-hoc signed (`codesign --sign -`). It runs locally; distributing
it needs a Developer ID and notarization.

## Requirements

- macOS 12 or newer, Xcode command line tools.
- libVLC, which is **not** bundled:
  `brew install --cask vlc` (or set `MTFLIX_VLC_LIB=/path/to/libvlc.dylib`).

libVLC is loaded at runtime with `dlopen`. `libvlc.dylib` depends on
`@rpath/libvlccore.dylib` and ships without its own `LC_RPATH`, so the build
adds rpaths for `/Applications/VLC.app/Contents/MacOS/lib`, `/opt/homebrew/lib`
and `/usr/local/lib`.

## Run

```bash
open apps/desktop-mac/build/MoviesTv-Flix.app
# against a local web build instead of the deployed PWA:
apps/desktop-mac/build/MoviesTv-Flix.app/Contents/MacOS/MoviesTv-Flix --url http://localhost:8081
```

`--url` (or `MTFLIX_URL`) points the wrapper at another web build, which is how
the PWA can be exercised in WebKit without a deploy.

## Verification modes

These exist so the native path can be checked without clicking:

```bash
# libVLC playback: start, tracks, seek
MoviesTv-Flix --native-test <media-url> /tmp/out.json

# the injected bridge end to end: page -> postMessage -> libVLC
MoviesTv-Flix --bridge-test <page-url> /tmp/out.json

# the wrapper loads and stays on the configured origin
MoviesTv-Flix --smoke-test --url <url>
```

`--native-test` reports `playing`, `hasVideo`, `audioTracks`, `timeMs`,
`lengthMs`, then seeks to 8 s and reports again.
