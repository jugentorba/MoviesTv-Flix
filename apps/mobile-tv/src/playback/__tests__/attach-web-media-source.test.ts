import Hls from 'hls.js';
import type { StreamSource } from '@moviestv/core';
import {
  attachWebMediaSource,
  isMixedContentWebSource,
} from '../attachWebMediaSource';

jest.mock('hls.js', () => {
  class MockHls {
    static isSupported = jest.fn(() => false);
    static instances: MockHls[] = [];

    config: any;

    constructor(config?: any) {
      this.config = config;
      MockHls.instances.push(this);
    }

    audioTracks: any[] = [];
    subtitleTracks: any[] = [];
    audioTrack = 0;
    subtitleTrack = -1;
    on = jest.fn();
    attachMedia = jest.fn();
    loadSource = jest.fn();
    startLoad = jest.fn();
    stopLoad = jest.fn();
    recoverMediaError = jest.fn();
    destroy = jest.fn();
  }

  return {
    __esModule: true,
    default: MockHls,
    ErrorTypes: {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
    },
    Events: {
      AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
      AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
      MANIFEST_PARSED: 'manifestParsed',
      SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
      ERROR: 'error',
      MEDIA_ATTACHED: 'mediaAttached',
      FRAG_LOADED: 'fragLoaded',
    },
  };
});

function video() {
  return {
    src: '',
    canPlayType: jest.fn(() => ''),
    removeAttribute: jest.fn(),
    load: jest.fn(),
  } as unknown as HTMLVideoElement;
}

function source(
  url: string,
  headers?: Record<string, string>,
): StreamSource {
  return {
    id: 'provider:source',
    providerId: 'provider',
    sourceId: 'source',
    url,
    ...(headers ? { headers } : {}),
  };
}

describe('attachWebMediaSource request-header handling', () => {
  beforeEach(() => {
    (Hls.isSupported as jest.Mock).mockReturnValue(false);
    (Hls as unknown as { instances: unknown[] }).instances.length = 0;
  });

  it('tries an opaque headerless HTTPS source even when the provider marks it not web-ready', async () => {
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/play/opaque-id'),
        webReady: false,
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/play/opaque-id');
    expect(element.removeAttribute).not.toHaveBeenCalledWith('src');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('fails over explicit HEVC MP4 when the browser reports no codec support', async () => {
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'hevc',
      },
      onError,
    );

    await Promise.resolve();

    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot decode its video codec'),
    );
  });

  it('recognizes x265 as HEVC for Safari capability checks', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('hvc1') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'x265 10bit',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('uses QuickTime capability checks for MOV on Safari', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.startsWith('video/quicktime') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mov'),
        codec: 'h264',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mov');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps HEVC when Safari only advertises a profiled codec string', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('hvc1.1.6.L93.B0') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'hevc',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps explicit HEVC MP4 on Safari when the browser reports HEVC support', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('hvc1') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'hevc',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('uses preserved codec detail when the broad codec is generic HEVC', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('dvh1.05.06') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'h265',
        codecDetail: 'dvh1.05.06',
        dynamicRange: 'dolby-vision',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps a raw Dolby Vision codec when Safari supports that exact codec id', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('dvh1.05.06') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'dvh1.05.06',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps an explicit H.264 profile when the browser supports that exact codec id', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('avc1.640028') ? 'probably' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'avc1.640028',
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('treats a raw Dolby Vision codec id as HEVC for browser capability checks', async () => {
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        codec: 'dvh1.05.06',
      },
      onError,
    );

    await Promise.resolve();

    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot decode its video codec'),
    );
  });

  it('recognizes HLS hidden behind a proxy url query field', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Flive%2Fmaster.m3u8',
      ),
    );

    expect(attached.usesHlsJs).toBe(true);
    expect(
      (Hls as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(1);
  });

  it('uses nested proxy URLs for progressive codec preflight', async () => {
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      {
        ...source(
          'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Fmovie.mp4',
        ),
        codec: 'h264',
      },
      onError,
    );

    await Promise.resolve();

    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot decode its video codec'),
    );
  });

  it('recognizes MP4 hidden in a provider stream query field', async () => {
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/play?stream=https%3A%2F%2Fmedia.example%2Fmovie.mp4',
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toContain('stream=');

    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it('tries an explicit HTTPS MP4 even when the provider marks it not web-ready', async () => {
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/movie.mp4'),
        webReady: false,
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');
    expect(element.removeAttribute).not.toHaveBeenCalledWith('src');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('recognizes opaque HLS from MIME metadata', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/play/opaque-hls'),
        contentType: 'application/vnd.apple.mpegurl',
      },
    );

    expect(attached.usesHlsJs).toBe(true);
    expect(
      (Hls as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(1);
  });

  it('recognizes parameterized HLS MIME metadata for an opaque URL', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const attached = attachWebMediaSource(
      video(),
      {
        ...source('https://cdn.example/play/opaque-hls'),
        contentType: 'Application/Vnd.Apple.MpegURL; charset=utf-8',
      },
    );

    expect(attached.usesHlsJs).toBe(true);
  });

  it('checks codecs for parameterized MP4 MIME metadata', async () => {
    const element = video();
    const onError = jest.fn();
    attachWebMediaSource(element, {
      ...source('https://cdn.example/play/opaque-hevc'),
      contentType: 'video/mp4; codecs=hvc1',
      codec: 'hevc',
    }, onError);

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot decode its video codec'));
  });

  it('rejects parameterized WebM MIME metadata when WebM is unsupported', async () => {
    const onError = jest.fn();
    attachWebMediaSource(video(), {
      ...source('https://cdn.example/play/opaque-webm'),
      contentType: 'video/webm; codecs=vp9',
    }, onError);

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot open that container'));
  });

  it('rejects parameterized DASH MIME metadata', async () => {
    const onError = jest.fn();
    attachWebMediaSource(video(), {
      ...source('https://cdn.example/play/opaque-dash'),
      contentType: 'application/dash+xml; charset=utf-8',
    }, onError);

    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot open that container'));
  });

  it('recognizes opaque MP4 from MIME metadata for codec checks', async () => {
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/play/opaque-hevc'),
        contentType: 'video/mp4',
        codec: 'hevc',
      },
      onError,
    );

    await Promise.resolve();

    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot decode its video codec'),
    );
  });

  it('recognizes opaque HLS from preserved Stremio filename', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/play/opaque-id'),
        filename: 'Movie.Name.2026.1080p.m3u8',
        webReady: false,
      },
    );

    expect(attached.usesHlsJs).toBe(true);
  });

  it('keeps HLS eligible when notWebReady is a protocol hint', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      {
        ...source('https://cdn.example/live.m3u8'),
        webReady: false,
      },
      onError,
    );

    expect(attached.usesHlsJs).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('tries direct MP4 when its only request hint is browser-managed', async () => {
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/movie.mp4',
        { Referer: 'https://player.example/' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('tries header-dependent MP4 directly as a last browser fallback', async () => {
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/movie.mp4',
        { Authorization: 'Bearer runtime-only' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('does not misroute header-dependent MP4 through HLS.js', async () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/movie.mp4',
        { Authorization: 'Bearer runtime-only' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(
      (Hls as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(0);
    expect(element.src).toBe('https://cdn.example/movie.mp4');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('lets native Safari try header-dependent HLS when HLS.js is unavailable', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockReturnValue('probably');
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer runtime-only' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(
      (Hls as unknown as { instances: unknown[] }).instances,
    ).toHaveLength(0);
    expect(element.src).toBe('https://cdn.example/live.m3u8');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('passes browser-settable HLS headers to XHR but drops browser-managed headers', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        {
          Authorization: 'Bearer runtime-only',
          Referer: 'https://player.example/',
          'User-Agent': 'Provider Agent',
        },
      ),
    );

    const instance = (
      Hls as unknown as { instances: Array<{ config: any }> }
    ).instances.at(-1)!;
    const setRequestHeader = jest.fn();

    instance.config.xhrSetup({ setRequestHeader });

    expect(setRequestHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer runtime-only',
    );
    expect(setRequestHeader).not.toHaveBeenCalledWith(
      'Referer',
      expect.anything(),
    );
    expect(setRequestHeader).not.toHaveBeenCalledWith(
      'User-Agent',
      expect.anything(),
    );
  });

  it('drops extended browser-forbidden HLS headers before XHR injection', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        {
          Authorization: 'Bearer runtime-only',
          'Accept-Encoding': 'gzip',
          Via: 'provider-proxy',
          DNT: '1',
        },
      ),
    );

    const instance = (
      Hls as unknown as { instances: Array<{ config: any }> }
    ).instances.at(-1)!;
    const setRequestHeader = jest.fn();

    instance.config.xhrSetup({ setRequestHeader });

    expect(setRequestHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer runtime-only',
    );
    expect(setRequestHeader).not.toHaveBeenCalledWith(
      'Accept-Encoding',
      expect.anything(),
    );
    expect(setRequestHeader).not.toHaveBeenCalledWith(
      'Via',
      expect.anything(),
    );
    expect(setRequestHeader).not.toHaveBeenCalledWith(
      'DNT',
      expect.anything(),
    );
  });

  it('keeps direct native HLS detached when attachment begins offline', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(false);
    const originalOnLine = globalThis.navigator?.onLine;
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    try {
      const element = video();
      (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
        value.includes('mpegurl') || value.includes('mpegURL')
          ? 'probably'
          : ''
      ));

      const attached = attachWebMediaSource(
        element,
        source('https://cdn.example/live.m3u8?token=public'),
      );

      expect(attached.usesHlsJs).toBe(false);
      expect(element.src).toBe('');
      expect(element.removeAttribute).toHaveBeenCalledWith('src');

      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: true,
      });

      expect(attached.resumeNetwork?.()).toBe(true);
      expect(element.src).toBe(
        'https://cdn.example/live.m3u8?token=public',
      );
      expect(element.load).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });

  it('can proactively pause HLS before the browser emits a network error', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const attached = attachWebMediaSource(
      video(),
      source('https://cdn.example/live.m3u8'),
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{
          loadSource: jest.Mock;
          startLoad: jest.Mock;
          stopLoad: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;

    expect(attached.pauseNetwork?.()).toBe(true);
    expect(instance.stopLoad).toHaveBeenCalledTimes(1);

    expect(attached.resumeNetwork?.()).toBe(true);
    expect(instance.loadSource).toHaveBeenCalledWith(
      'https://cdn.example/live.m3u8',
    );
    expect(instance.startLoad).not.toHaveBeenCalled();
  });

  it('does not start HLS loading when attachment begins offline', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const originalOnLine = globalThis.navigator?.onLine;
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    try {
      const attached = attachWebMediaSource(
        video(),
        source('https://cdn.example/live.m3u8'),
      );
      const instance = (
        Hls as unknown as {
          instances: Array<{
            on: jest.Mock;
            loadSource: jest.Mock;
            stopLoad: jest.Mock;
          }>;
        }
      ).instances.at(-1)!;
      const mediaAttached = instance.on.mock.calls.find(
        ([event]) => event === 'mediaAttached',
      )?.[1];

      mediaAttached?.();

      expect(instance.loadSource).not.toHaveBeenCalled();
      expect(instance.stopLoad).toHaveBeenCalledTimes(1);

      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      expect(attached.resumeNetwork?.()).toBe(true);
      expect(instance.loadSource).toHaveBeenCalledWith(
        'https://cdn.example/live.m3u8',
      );
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });

  it('pauses HLS network recovery while the browser is offline and resumes it later', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const originalOnLine = globalThis.navigator?.onLine;
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    try {
      const element = video();
      const attached = attachWebMediaSource(
        element,
        source('https://cdn.example/live.m3u8'),
      );

      const instance = (
        Hls as unknown as {
          instances: Array<{
            on: jest.Mock;
            loadSource: jest.Mock;
            startLoad: jest.Mock;
            stopLoad: jest.Mock;
          }>;
        }
      ).instances.at(-1)!;
      const registration = instance.on.mock.calls.find(
        ([event]) => event === 'error',
      );

      registration![1](undefined, {
        fatal: true,
        type: 'networkError',
        details: 'manifestLoadError',
      });

      expect(instance.stopLoad).toHaveBeenCalledTimes(1);
      expect(instance.startLoad).not.toHaveBeenCalled();

      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: true,
      });

      expect(attached.resumeNetwork?.()).toBe(true);
      expect(instance.loadSource).toHaveBeenCalledWith(
        'https://cdn.example/live.m3u8',
      );
      expect(instance.startLoad).not.toHaveBeenCalled();
      expect(attached.resumeNetwork?.()).toBe(false);
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });

  it('resumes segment loading after reconnect when the HLS manifest was already parsed', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const originalOnLine = globalThis.navigator?.onLine;
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    try {
      const attached = attachWebMediaSource(
        video(),
        source('https://cdn.example/live.m3u8'),
      );
      const instance = (
        Hls as unknown as {
          instances: Array<{
            on: jest.Mock;
            loadSource: jest.Mock;
            startLoad: jest.Mock;
          }>;
        }
      ).instances.at(-1)!;
      const event = (name: string) => instance.on.mock.calls.find(
        ([registered]) => registered === name,
      )?.[1];

      event('manifestParsed')!();

      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      event('error')!(undefined, {
        fatal: true,
        type: 'networkError',
        details: 'fragLoadError',
      });

      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      instance.loadSource.mockClear();

      expect(attached.resumeNetwork?.()).toBe(true);
      expect(instance.startLoad).toHaveBeenCalledTimes(1);
      expect(instance.loadSource).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });

  it('reloads direct Live TV without restoring an old live playhead', () => {
    const element = {
      ...video(),
      currentTime: 125,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as unknown as HTMLVideoElement;

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      undefined,
      { preservePositionOnReconnect: false },
    );

    expect(attached.resumeNetwork?.()).toBe(true);
    expect(element.load).toHaveBeenCalledTimes(1);
    expect(element.addEventListener).not.toHaveBeenCalledWith(
      'loadedmetadata',
      expect.any(Function),
    );
  });

  it('reloads direct media after reconnect and restores its previous position', () => {
    let loadedMetadata: (() => void) | undefined;
    const element = {
      ...video(),
      currentTime: 125,
      addEventListener: jest.fn((event: string, listener: () => void) => {
        if (event === 'loadedmetadata') loadedMetadata = listener;
      }),
      removeEventListener: jest.fn(),
    } as unknown as HTMLVideoElement;

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/movie.mp4'),
    );

    expect(attached.resumeNetwork?.()).toBe(true);
    expect(element.load).toHaveBeenCalledTimes(1);

    element.currentTime = 0;
    loadedMetadata?.();

    expect(element.currentTime).toBe(125);
    expect(element.removeEventListener).toHaveBeenCalledWith(
      'loadedmetadata',
      loadedMetadata,
    );
  });

  it('replaces pending direct-media reconnect listeners instead of stacking them', () => {
    const listeners: Array<() => void> = [];
    const element = {
      ...video(),
      currentTime: 40,
      addEventListener: jest.fn((event: string, listener: () => void) => {
        if (event === 'loadedmetadata') listeners.push(listener);
      }),
      removeEventListener: jest.fn(),
    } as unknown as HTMLVideoElement;

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/movie.mp4'),
    );

    attached.resumeNetwork?.();
    element.currentTime = 80;
    attached.resumeNetwork?.();

    expect(element.removeEventListener).toHaveBeenCalledWith(
      'loadedmetadata',
      listeners[0],
    );

    attached.destroy();
    expect(element.removeEventListener).toHaveBeenCalledWith(
      'loadedmetadata',
      listeners[1],
    );
  });

  it('registers the HLS media-attached listener before attaching the video element', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{
          on: jest.Mock;
          attachMedia: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;
    const mediaAttachedCall = instance.on.mock.calls.findIndex(
      ([event]) => event === 'mediaAttached',
    );

    expect(mediaAttachedCall).toBeGreaterThanOrEqual(0);
    expect(
      instance.on.mock.invocationCallOrder[mediaAttachedCall],
    ).toBeLessThan(instance.attachMedia.mock.invocationCallOrder[0]!);
  });

  it('keeps Authorization-dependent HLS eligible when HLS.js is supported', async () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer runtime-only' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(true);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores browser-managed Referer metadata instead of rejecting HLS', async () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Referer: 'https://player.example/' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(true);
    expect((Hls as unknown as { instances: unknown[] }).instances).toHaveLength(1);

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('lets native Safari HLS try a source carrying only browser-managed headers', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockReturnValue('probably');
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Referer: 'https://player.example/' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/live.m3u8');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('recognizes HLS hidden in a provider file query field', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/play?file=live.m3u8&token=public'),
    );

    expect(attached.usesHlsJs).toBe(true);
  });

  it('recognizes extensionless HLS from URL hints', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/stream?format=m3u8&token=public'),
    );

    expect(attached.usesHlsJs).toBe(true);
  });

  it('tries an extensionless header-advertised source without guessing HLS', async () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/protected-stream',
        { Authorization: 'Bearer runtime-only' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect((Hls as unknown as { instances: unknown[] }).instances).toHaveLength(0);
    expect(element.src).toBe('https://cdn.example/protected-stream');
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it('selects the preferred HLS audio track when tracks become available', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onTracksChange = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      undefined,
      {
        preferredLanguages: ['de', 'fr', 'en'],
        onTracksChange,
      },
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        audioTracks: any[];
        audioTrack: number;
        on: jest.Mock;
      }> }
    ).instances.at(-1)!;
    instance.audioTracks = [
      { lang: 'eng', name: 'English' },
      { lang: 'fra', name: 'French' },
      { lang: 'ger', name: 'German' },
    ];

    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'audioTracksUpdated',
    );
    expect(registration?.[1]).toEqual(expect.any(Function));

    registration![1]();

    expect(instance.audioTrack).toBe(2);
    expect(onTracksChange).toHaveBeenLastCalledWith(
      [
        {
          id: 'hls-audio:0',
          language: 'eng',
          label: 'English',
        },
        {
          id: 'hls-audio:1',
          language: 'fra',
          label: 'French',
        },
        {
          id: 'hls-audio:2',
          language: 'ger',
          label: 'German',
        },
      ],
      'hls-audio:2',
    );

    attached.destroy();
  });

  it('can reapply a changed preferred HLS audio language', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    let preferred = ['en'];

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      undefined,
      {
        get preferredLanguages() {
          return preferred;
        },
      },
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        audioTracks: any[];
        audioTrack: number;
        on: jest.Mock;
      }> }
    ).instances.at(-1)!;
    instance.audioTracks = [
      { lang: 'en', name: 'English' },
      { lang: 'fr', name: 'French' },
    ];

    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'audioTracksUpdated',
    );
    registration![1]();
    expect(instance.audioTrack).toBe(0);

    preferred = ['fr'];
    expect(attached.selectPreferredAudioTrack?.()).toBe(true);
    expect(instance.audioTrack).toBe(1);
  });

  it('refreshes delayed HLS subtitle tracks and reapplies language preference', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onSubtitleTracksChange = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      undefined,
      {
        subtitlesEnabled: true,
        preferredSubtitleLanguages: ['fr', 'en'],
        onSubtitleTracksChange,
      },
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        subtitleTracks: any[];
        subtitleTrack: number;
        on: jest.Mock;
      }> }
    ).instances.at(-1)!;
    instance.subtitleTracks = [
      { lang: 'en', name: 'English' },
      { lang: 'fr', name: 'French' },
    ];

    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'subtitleTracksUpdated',
    );
    expect(registration?.[1]).toEqual(expect.any(Function));

    registration![1]();

    expect(instance.subtitleTrack).toBe(1);
    expect(onSubtitleTracksChange).toHaveBeenLastCalledWith(
      [
        {
          id: 'hls-subtitle:0',
          language: 'en',
          label: 'English',
        },
        {
          id: 'hls-subtitle:1',
          language: 'fr',
          label: 'French',
        },
      ],
      'hls-subtitle:1',
    );

    attached.destroy();
  });

  it('can reapply a changed preferred HLS subtitle language', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    let preferred = ['en'];

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      undefined,
      {
        subtitlesEnabled: true,
        get preferredSubtitleLanguages() {
          return preferred;
        },
      },
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        subtitleTracks: any[];
        subtitleTrack: number;
        on: jest.Mock;
      }> }
    ).instances.at(-1)!;
    instance.subtitleTracks = [
      { lang: 'en', name: 'English' },
      { lang: 'fr', name: 'French' },
    ];

    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'subtitleTracksUpdated',
    );
    registration![1]();
    expect(instance.subtitleTrack).toBe(0);

    preferred = ['fr'];
    expect(attached.selectPreferredSubtitleTrack?.()).toBe(true);
    expect(instance.subtitleTrack).toBe(1);
  });

  it('treats string HLS denial status as terminal instead of a CORS fallback', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer required' },
      ),
      onError,
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{
          on: jest.Mock;
          destroy: jest.Mock;
          startLoad: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: '403' },
    });

    expect(instance.destroy).not.toHaveBeenCalled();
    expect(instance.startLoad).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('fails over denied HLS immediately so the provider can issue a fresh URL', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8?token=expired'),
      onError,
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        on: jest.Mock;
        startLoad: jest.Mock;
      }> }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 403 },
    });

    expect(instance.startLoad).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      'HLS playback failed: manifestLoadError',
    );
  });

  it('reports a denied HLS URL only once even if hls.js repeats the fatal event', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8?token=expired'),
      onError,
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{ on: jest.Mock; stopLoad: jest.Mock }>;
      }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    const denied = {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 403 },
    };
    registration![1](undefined, denied);
    registration![1](undefined, denied);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(instance.stopLoad).toHaveBeenCalledTimes(1);
  });

  it('treats HLS response code zero as a CORS-style native Safari fallback', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer optional' },
      ),
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{ on: jest.Mock; destroy: jest.Mock }>;
      }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 0 },
    });

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/live.m3u8');
  });

  it('falls back to native Safari HLS when HLS.js hits a header/CORS network failure', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer optional' },
      ),
      onError,
    );

    expect(attached.usesHlsJs).toBe(true);

    const instance = (
      Hls as unknown as {
        instances: Array<{
          on: jest.Mock;
          destroy: jest.Mock;
          startLoad: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
    });

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(instance.startLoad).not.toHaveBeenCalled();
    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/live.m3u8');
    expect(element.load).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('clears stale hls.js track UI before native Safari takes over', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));
    const onTracksChange = jest.fn();
    const onSubtitleTracksChange = jest.fn();

    attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer optional' },
      ),
      undefined,
      {
        onTracksChange,
        onSubtitleTracksChange,
      },
    );

    const instance = (
      Hls as unknown as { instances: Array<{ on: jest.Mock }> }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 0 },
    });

    expect(onTracksChange).toHaveBeenLastCalledWith([], null);
    expect(onSubtitleTracksChange).toHaveBeenLastCalledWith([], null);
  });

  it('ignores queued hls.js events after switching to native Safari HLS', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));
    const onError = jest.fn();
    const onTracksChange = jest.fn();
    const onSubtitleTracksChange = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer optional' },
      ),
      onError,
      {
        onTracksChange,
        onSubtitleTracksChange,
      },
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{
          audioTracks: any[];
          subtitleTracks: any[];
          on: jest.Mock;
          loadSource: jest.Mock;
          startLoad: jest.Mock;
          recoverMediaError: jest.Mock;
          destroy: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;
    instance.audioTracks = [{ lang: 'en', name: 'English' }];
    instance.subtitleTracks = [{ lang: 'en', name: 'English' }];

    const event = (name: string) => instance.on.mock.calls.find(
      ([registered]) => registered === name,
    )?.[1];

    event('error')!(undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
      response: { code: 0 },
    });

    expect(attached.usesHlsJs).toBe(false);
    onTracksChange.mockClear();
    onSubtitleTracksChange.mockClear();

    event('mediaAttached')!();
    event('fragLoaded')!();
    event('audioTracksUpdated')!();
    event('audioTrackSwitched')!(undefined, { id: 0 });
    event('manifestParsed')!();
    event('subtitleTracksUpdated')!();
    event('error')!(undefined, {
      fatal: true,
      type: 'mediaError',
      details: 'bufferAppendError',
    });

    expect(instance.loadSource).not.toHaveBeenCalled();
    expect(instance.startLoad).not.toHaveBeenCalled();
    expect(instance.recoverMediaError).not.toHaveBeenCalled();
    expect(onTracksChange).not.toHaveBeenCalled();
    expect(onSubtitleTracksChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    attached.destroy();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not reset an already-playing HLS stream to native fallback', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));
    (element as any).currentTime = 12;
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source(
        'https://cdn.example/live.m3u8',
        { Authorization: 'Bearer optional' },
      ),
      onError,
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{
          on: jest.Mock;
          destroy: jest.Mock;
          startLoad: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'fragLoadError',
    });

    expect(instance.destroy).not.toHaveBeenCalled();
    expect(instance.startLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('recovers one fatal HLS network error before reporting playback failure', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      onError,
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        on: jest.Mock;
        startLoad: jest.Mock;
      }> }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );
    expect(registration?.[1]).toEqual(expect.any(Function));

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
    });

    expect(instance.startLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    registration![1](undefined, {
      fatal: true,
      type: 'networkError',
      details: 'manifestLoadError',
    });

    expect(onError).toHaveBeenCalledWith(
      'HLS playback failed: manifestLoadError',
    );
  });

  it('falls back to native Safari when hls.js rejects media at startup', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value.includes('mpegurl') || value.includes('mpegURL')
        ? 'probably'
        : ''
    ));

    const attached = attachWebMediaSource(
      element,
      source(
        'https://cdn.example/hevc-live.m3u8',
        { Authorization: 'Bearer optional' },
      ),
    );

    const instance = (
      Hls as unknown as {
        instances: Array<{
          on: jest.Mock;
          destroy: jest.Mock;
          recoverMediaError: jest.Mock;
        }>;
      }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );

    registration![1](undefined, {
      fatal: true,
      type: 'mediaError',
      details: 'bufferAppendError',
    });

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(instance.recoverMediaError).not.toHaveBeenCalled();
    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/hevc-live.m3u8');
  });

  it('recovers one fatal HLS media error before reporting playback failure', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      onError,
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        on: jest.Mock;
        recoverMediaError: jest.Mock;
      }> }
    ).instances.at(-1)!;
    const registration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );
    expect(registration?.[1]).toEqual(expect.any(Function));

    registration![1](undefined, {
      fatal: true,
      type: 'mediaError',
      details: 'bufferAppendError',
    });

    expect(instance.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    registration![1](undefined, {
      fatal: true,
      type: 'mediaError',
      details: 'bufferAppendError',
    });

    expect(onError).toHaveBeenCalledWith(
      'HLS playback failed: bufferAppendError',
    );
  });

  it('allows HLS media recovery again after a fragment loads successfully', () => {
    (Hls.isSupported as jest.Mock).mockReturnValue(true);
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/live.m3u8'),
      onError,
    );

    const instance = (
      Hls as unknown as { instances: Array<{
        on: jest.Mock;
        recoverMediaError: jest.Mock;
      }> }
    ).instances.at(-1)!;
    const errorRegistration = instance.on.mock.calls.find(
      ([event]) => event === 'error',
    );
    const fragmentRegistration = instance.on.mock.calls.find(
      ([event]) => event === 'fragLoaded',
    );

    errorRegistration![1](undefined, {
      fatal: true,
      type: 'mediaError',
      details: 'bufferAppendError',
    });
    fragmentRegistration![1]();
    errorRegistration![1](undefined, {
      fatal: true,
      type: 'mediaError',
      details: 'bufferAppendError',
    });

    expect(instance.recoverMediaError).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails over FLV before attaching it to the browser video element', async () => {
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/legacy.flv'),
      onError,
    );

    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot open that container'),
    );
  });

  it('fails over MKV when the browser engine does not advertise Matroska', async () => {
    const element = video();
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/movie.mkv'),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(element.src).toBe('');

    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot open that container'),
    );
  });

  it('attaches MKV when the browser engine advertises Matroska support', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value === 'video/x-matroska' ? 'maybe' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/movie.mkv'),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.removeAttribute).not.toHaveBeenCalledWith('src');
    expect(element.src).toBe('https://cdn.example/movie.mkv');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('fails over an extensionless URL that declares an MKV container', async () => {
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/play?file=movie.mkv&token=public'),
      onError,
    );

    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot open that container'),
    );
  });

  it('attaches an extensionless MKV source when the engine advertises Matroska', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
      value === 'video/x-matroska' ? 'maybe' : ''
    ));
    const onError = jest.fn();

    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/play?file=movie.mkv&token=public'),
      onError,
    );

    expect(attached.usesHlsJs).toBe(false);
    expect(element.src).toBe('https://cdn.example/play?file=movie.mkv&token=public');

    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('still fails over AVI when the engine reports generic container support', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockReturnValue('maybe');
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/legacy.avi'),
      onError,
    );

    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot open that container'),
    );
  });

  it('still fails over DASH when the engine reports generic container support', async () => {
    const element = video();
    (element.canPlayType as jest.Mock).mockReturnValue('maybe');
    const onError = jest.fn();

    attachWebMediaSource(
      element,
      source('https://cdn.example/movie.mpd'),
      onError,
    );

    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('cannot open that container'),
    );
  });

  it('detects HTTP media as mixed content only on HTTPS pages', () => {
    const httpSource = source('http://cdn.example/movie.mp4');
    const httpsSource = source('https://cdn.example/movie.mp4');

    expect(isMixedContentWebSource(httpSource, 'https:')).toBe(true);
    expect(isMixedContentWebSource(httpSource, 'http:')).toBe(false);
    expect(isMixedContentWebSource(httpsSource, 'https:')).toBe(false);
  });

});


test('tries an extensionless header-advertised source without guessing HLS', async () => {
  const element = video();
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    source('https://cdn.example/play?id=movie', {
      Authorization: 'Bearer runtime-only',
    }),
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/play?id=movie');

  await Promise.resolve();

  expect(onError).not.toHaveBeenCalled();
});


test('fails over opaque DASH from MIME metadata before attachment', async () => {
  const element = video();
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/play/opaque-dash'),
      contentType: 'application/dash+xml',
    },
    onError,
  );

  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot open that container'),
  );
});

test('fails over MPEG-DASH because the web player has no DASH engine', async () => {
  const element = video();
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    source('https://cdn.example/movie.mpd'),
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot open that container'),
  );
});

test('fails over extensionless DASH hints before the startup watchdog', async () => {
  const element = video();
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    source('https://cdn.example/play?format=dash&token=public'),
    onError,
  );

  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot open that container'),
  );
});


test('does not mistake a display name for an unsupported media container', async () => {
  const element = video();
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/play?id=browser-mp4'),
      name: 'Dash',
      codec: 'h264',
    },
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/play?id=browser-mp4');
  await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
});

test('still rejects an unsupported container preserved in filename metadata', async () => {
  const element = video();
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/play?id=opaque'),
      filename: 'Movie.Name.2026.1080p.mkv',
    },
    onError,
  );

  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot open that container'),
  );
});


test('does not infer HLS from a provider display name', () => {
  (Hls.isSupported as jest.Mock).mockReturnValue(true);
  const element = video();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/play?id=opaque'),
      name: 'HLS Premium',
      codec: 'h264',
    },
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/play?id=opaque');
  expect((Hls as unknown as { instances: unknown[] }).instances).toHaveLength(0);
});

test('does not infer HLS from a provider display name when headers are advertised', async () => {
  (Hls.isSupported as jest.Mock).mockReturnValue(true);
  const element = video();
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/play?id=opaque', {
        Authorization: 'Bearer runtime-only',
      }),
      name: 'HLS Premium',
    },
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/play?id=opaque');
  expect((Hls as unknown as { instances: unknown[] }).instances).toHaveLength(0);

  await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
});


test('fails over MIME-declared TrueHD before attachment when the browser reports it unsupported', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') ? 'probably' : ''
  ));
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/play/opaque-truehd'),
      contentType: 'video/mp4; codecs="avc1.4d401f, mlpa"',
    },
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot decode its audio codec'),
  );
});

test('fails over DTS MP4 before attachment when the browser reports DTS unsupported', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') ? 'probably' : ''
  ));
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.mp4'),
      name: 'Lumio 1080p DTS-HD',
      codec: 'h264',
    },
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(element.src).toBe('');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot decode its audio codec'),
  );
});

test('keeps TrueHD MP4 eligible when the browser reports TrueHD support', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') || value.includes('mlpa') ? 'probably' : ''
  ));
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.mp4'),
      name: 'Lumio 1080p TrueHD',
      codec: 'h264',
    },
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/movie.mp4');

  await Promise.resolve();

  expect(onError).not.toHaveBeenCalled();
});


test('fails over TrueHD MP4 before attachment when the browser reports TrueHD unsupported', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') ? 'probably' : ''
  ));
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.mp4'),
      name: 'Lumio 1080p TrueHD',
      codec: 'h264',
    },
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(element.src).toBe('');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot decode its audio codec'),
  );
});


test('keeps DTS MP4 eligible when the browser reports DTS Express support', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') || value.includes('dtse') ? 'probably' : ''
  ));
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.mp4'),
      name: 'Lumio 1080p DTS',
      codec: 'h264',
    },
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/movie.mp4');

  await Promise.resolve();

  expect(onError).not.toHaveBeenCalled();
});


test('fails over normalized TrueHD metadata with a generic source name', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') ? 'probably' : ''
  ));
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.mp4'),
      name: 'Lumio',
      codec: 'h264',
      audioCodec: 'truehd',
    },
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot decode its audio codec'),
  );
});


test('uses normalized TrueHD metadata even when the display name is generic', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value.includes('avc1') ? 'probably' : ''
  ));
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.mp4'),
      name: 'Lumio',
      codec: 'h264',
      audioCodec: 'truehd',
    },
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot decode its audio codec'),
  );
});


test('fails over explicit WebM when the browser reports no container support', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockReturnValue('');
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.webm'),
      contentType: 'video/webm',
    },
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(element.src).toBe('');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot open that container'),
  );
});

test('keeps explicit WebM when the browser reports container support', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockImplementation((value: string) => (
    value === 'video/webm' ? 'probably' : ''
  ));
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movie.webm'),
      contentType: 'video/webm',
    },
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe('https://cdn.example/movie.webm');

  await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
});


test('fails over opaque WebM transport hints when the browser has no WebM support', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockReturnValue('');
  const onError = jest.fn();

  attachWebMediaSource(
    element,
    source('https://cdn.example/play?id=42&format=webm'),
    onError,
  );

  await Promise.resolve();

  expect(element.removeAttribute).toHaveBeenCalledWith('src');
  expect(onError).toHaveBeenCalledWith(
    expect.stringContaining('cannot open that container'),
  );
});


test('does not mistake HLS text in a progressive movie path for an HLS manifest', async () => {
  const element = video();
  (element.canPlayType as jest.Mock).mockReturnValue('probably');
  const onError = jest.fn();

  const attached = attachWebMediaSource(
    element,
    {
      ...source('https://cdn.example/movies/HLS-documentary.mp4'),
      contentType: 'video/mp4',
      codec: 'h264',
    },
    onError,
  );

  expect(attached.usesHlsJs).toBe(false);
  expect(element.src).toBe(
    'https://cdn.example/movies/HLS-documentary.mp4',
  );

  await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
});

test('still recognizes an opaque HLS URL from a transport query hint', () => {
  (Hls.isSupported as jest.Mock).mockReturnValue(true);
  const element = video();
  (element.canPlayType as jest.Mock).mockReturnValue('');

  const attached = attachWebMediaSource(
    element,
    source('https://cdn.example/play/opaque?format=hls'),
  );

  expect(attached.usesHlsJs).toBe(true);
});

describe('attachWebMediaSource remux fallback', () => {
  const ENV = 'EXPO_PUBLIC_REMUX_URL';
  const original = process.env[ENV];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env[ENV] = 'https://remux.example.com';
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    globalThis.fetch = originalFetch;
  });

  it('remuxes an unplayable MKV and attaches the resulting HLS source', async () => {
    // Pin the engine mode: without hls.js the playlist goes straight on the
    // element, which is what this test asserts.
    (Hls.isSupported as jest.Mock).mockReturnValue(false);
    const calls: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return {
        ok: true,
        json: async () => ({ id: 'abc', playlist: '/sessions/abc/index.m3u8', audio: 'copy' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const element = video();
    const onError = jest.fn();
    const attached = attachWebMediaSource(
      element,
      source('https://cdn.example/movie.mkv', {
        Referer: 'https://cdn.example/',
        'User-Agent': 'MoviesTvFlix/1.0',
      }),
      onError,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toHaveLength(1);
    // The signed URL and headers travel in the body, never the query string.
    expect(calls[0].url).toBe('https://remux.example.com/sessions');
    expect(calls[0].body.url).toBe('https://cdn.example/movie.mkv');
    expect(calls[0].body.headers.Referer).toBe('https://cdn.example/');
    // The HLS source was attached instead of failing.
    expect(onError).not.toHaveBeenCalled();
    expect(element.src).toBe('https://remux.example.com/sessions/abc/index.m3u8');
    // hls.js is mocked as unsupported here, so the playlist is attached natively.
    expect(attached.usesHlsJs).toBe(false);
  });

  it('reports an actionable message when the fallback is not configured', async () => {
    delete process.env[ENV];
    const element = video();
    const onError = jest.fn();

    attachWebMediaSource(element, source('https://cdn.example/movie.mkv'), onError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain('MKV');
    expect(onError.mock.calls[0][0]).toContain('Choose another source');
  });
});
