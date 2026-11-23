import type { StreamSource } from '@moviestv/core';
import {
  browserAdvertisesContainer,
  detectWebMatroskaSupport,
  isNeverNativeWebContainer,
  webContainerDecision,
  webContainerKind,
  webEngineSupportsMatroska,
} from '../webContainerSupport';

function source(
  url: string,
  extra?: Partial<StreamSource>,
): StreamSource {
  return {
    id: 'provider:source',
    providerId: 'provider',
    sourceId: 'source',
    url,
    ...extra,
  };
}

function engine(advertised: Record<string, string> = {}) {
  return {
    canPlayType: (mime: string) => advertised[mime] ?? '',
  } as unknown as Pick<HTMLVideoElement, 'canPlayType'>;
}

describe('webContainerKind', () => {
  it('classifies explicit extensions', () => {
    expect(webContainerKind(source('https://cdn.example/movie.mkv'))).toBe('matroska');
    expect(webContainerKind(source('https://cdn.example/movie.mp4'))).toBe('mp4');
    expect(webContainerKind(source('https://cdn.example/movie.m4v'))).toBe('m4v');
    expect(webContainerKind(source('https://cdn.example/movie.mov'))).toBe('mov');
    expect(webContainerKind(source('https://cdn.example/movie.webm'))).toBe('webm');
    expect(webContainerKind(source('https://cdn.example/movie.mpd'))).toBe('dash');
    expect(webContainerKind(source('https://cdn.example/movie.avi'))).toBe('avi');
    expect(webContainerKind(source('https://cdn.example/movie.flv'))).toBe('flv');
    expect(webContainerKind(source('https://cdn.example/movie.wmv'))).toBe('wmv');
    expect(webContainerKind(source('https://cdn.example/playlist.m3u8'))).toBe('hls');
  });

  it('classifies by content type without trusting the display name', () => {
    expect(webContainerKind(source('https://cdn.example/play/opaque', {
      contentType: 'video/x-matroska; codecs=avc1',
      name: 'MP4 1080p',
    }))).toBe('matroska');
    expect(webContainerKind(source('https://cdn.example/play/opaque', {
      name: 'Dash',
      contentType: 'video/mp4',
    }))).toBe('mp4');
  });

  it('classifies extensionless URLs from media query parameters', () => {
    expect(webContainerKind(
      source('https://cdn.example/play?file=movie.mkv'),
    )).toBe('matroska');
    expect(webContainerKind(
      source('https://cdn.example/play?format=matroska'),
    )).toBe('matroska');
  });

  it('ignores unrelated query parameters that happen to mention a container', () => {
    expect(webContainerKind(
      source('https://cdn.example/play?id=movie&token=mkv-signature'),
    )).toBeNull();
  });

  it('returns null for opaque progressive sources', () => {
    expect(webContainerKind(source('https://cdn.example/play?id=movie'))).toBeNull();
  });
});

describe('browserAdvertisesContainer', () => {
  it('requires a positive canPlayType answer', () => {
    expect(browserAdvertisesContainer(engine(), 'matroska')).toBe(false);
    expect(browserAdvertisesContainer(
      engine({ 'video/x-matroska': 'maybe' }),
      'matroska',
    )).toBe(true);
    expect(browserAdvertisesContainer(
      engine({ 'video/webm': 'probably' }),
      'webm',
    )).toBe(true);
  });

  it('never advertises containers without a native demuxer', () => {
    const permissive = engine({
      'video/x-msvideo': 'maybe',
      'application/dash+xml': 'maybe',
    });
    expect(browserAdvertisesContainer(permissive, 'avi')).toBe(false);
    expect(browserAdvertisesContainer(permissive, 'dash')).toBe(false);
  });

  it('treats a missing or throwing media element as unsupported', () => {
    expect(browserAdvertisesContainer(null, 'matroska')).toBe(false);
    expect(browserAdvertisesContainer(
      {
        canPlayType: () => {
          throw new Error('not implemented');
        },
      } as unknown as Pick<HTMLVideoElement, 'canPlayType'>,
      'matroska',
    )).toBe(false);
  });
});

describe('detectWebMatroskaSupport', () => {
  it('follows the engine probe', () => {
    expect(detectWebMatroskaSupport(() => engine({ 'video/x-matroska': 'maybe' })))
      .toBe(true);
    expect(detectWebMatroskaSupport(() => engine({ 'video/x-matroska': '' })))
      .toBe(false);
    expect(detectWebMatroskaSupport(() => engine())).toBe(false);
  });

  it('treats a missing or throwing element factory as unsupported', () => {
    expect(detectWebMatroskaSupport(() => null)).toBe(false);
    expect(detectWebMatroskaSupport(() => {
      throw new Error('no DOM');
    })).toBe(false);
  });
});

describe('webEngineSupportsMatroska', () => {
  it('never claims Matroska support without a DOM', () => {
    // The jest-expo environment for this suite has no document.
    if (typeof document === 'undefined') {
      expect(webEngineSupportsMatroska()).toBe(false);
    }
  });
});

describe('webContainerDecision', () => {
  it('attaches browser-native progressive media and HLS', () => {
    expect(webContainerDecision(engine(), source('https://cdn.example/movie.mp4')).rejects)
      .toBe(false);
    expect(webContainerDecision(engine(), source('https://cdn.example/movie.mov')).rejects)
      .toBe(false);
    expect(webContainerDecision(engine(), source('https://cdn.example/live.m3u8')).rejects)
      .toBe(false);
  });

  it('follows engine support for Matroska and WebM', () => {
    expect(webContainerDecision(engine(), source('https://cdn.example/movie.mkv')))
      .toMatchObject({ kind: 'matroska', rejects: true, unsupportedByEngine: true });
    expect(webContainerDecision(
      engine({ 'video/x-matroska': 'maybe' }),
      source('https://cdn.example/movie.mkv'),
    )).toMatchObject({ kind: 'matroska', rejects: false, unsupportedByEngine: false });
    expect(webContainerDecision(
      engine({ 'video/webm': 'maybe' }),
      source('https://cdn.example/movie.webm'),
    )).toMatchObject({ kind: 'webm', rejects: false, unsupportedByEngine: false });
  });

  it('always rejects containers no browser demuxes', () => {
    for (const url of [
      'https://cdn.example/movie.avi',
      'https://cdn.example/movie.mpd',
      'https://cdn.example/movie.flv',
      'https://cdn.example/movie.wmv',
    ]) {
      expect(webContainerDecision(engine({ 'video/x-matroska': 'maybe' }), source(url)).rejects)
        .toBe(true);
    }
    expect(isNeverNativeWebContainer('matroska')).toBe(false);
    expect(isNeverNativeWebContainer('dash')).toBe(true);
  });
});
