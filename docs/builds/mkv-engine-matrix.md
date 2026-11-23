# Measured engine support (2026-11-18, macOS 27.2, Chrome 152, WKWebView/WebKit)

Test media: 12 s `testsrc2` + 440 Hz sine, generated locally with ffmpeg 9.0.2.
Playback probed in a real page (`<video>` + `play()` + a seek to 8 s).

| File | Real container | Video | Audio | WebKit (Safari / DMG) | Chromium (PWA in Chrome) |
| --- | --- | --- | --- | --- | --- |
| `control-720p-h264-aac.mp4` | MP4 | H.264 High 1280×720 | AAC-LC 96k | **plays**, seek 8 s → 9.37 s | **plays** |
| `movie-1080p-h264-aac.mkv` | Matroska | H.264 High 1920×1080 | AAC-LC 96k | **fails** `MEDIA_ERR_SRC_NOT_SUPPORTED` (4), `NotSupportedError` | **plays** (loadeddata 1920×1080, 12 s) |
| `movie-1080p-h264-eac3.mkv` | Matroska | H.264 High 1920×1080 | E-AC-3 192k | **fails** code 4 | **plays video** (`loadeddata` 1920×1080) |

`canPlayType` answers:

| MIME | WebKit | Chromium |
| --- | --- | --- |
| `video/mp4; codecs="avc1.640028,mp4a.40.2"` | probably | probably |
| `video/mp4; codecs="avc1.640028,ec-3"` | **probably** | **no** |
| `video/mp4; codecs="avc1.640028,ac-3"` | **probably** | **no** |
| `video/x-matroska` | **no** | maybe (and it does play) |
| `application/vnd.apple.mpegurl` | maybe | maybe |

Two label traps worth recording:

1. `https://test-videos.co.uk/vids/bigbuckbunny/mkv/1080/Big_Buck_Bunny_1080_10s_1MB.mkv`
   is served as `video/x-matroska` and *named* `.mkv`, but `ffprobe` reports
   `format_name=mov,mp4,m4a,3gp,3g2,mj2` and **no audio stream**. A source that
   "looks like MKV" can be an MP4, and an H.264 label says nothing about audio.
2. E-AC-3/AC-3 is the inverse case: WebKit reports `probably` and plays it,
   Chromium reports `no`. So "MP4 + H.264" is not sufficient evidence either.

Conclusion that drives the fix: the DMG failure is the **Matroska container** in
WebKit, not the resolution or the video codec. A Chromium-only session may still
fail on AC-3/E-AC-3 audio, which is why the fallback must consider both
container and audio codec, per source.
