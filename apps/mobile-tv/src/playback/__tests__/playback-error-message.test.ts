import {
  NATIVE_FORMAT_PLAYBACK_ERROR,
  safeNativePlaybackErrorMessage,
  safePlaybackErrorMessage,
} from '../playbackError';

test('keeps concise non-sensitive playback diagnostics', () => {
  expect(safePlaybackErrorMessage(
    'Video source did not become ready in time',
    'Playback failed',
  )).toBe('Video source did not become ready in time');

  expect(safePlaybackErrorMessage(
    'HLS playback failed: fragLoadError',
    'Playback failed',
  )).toBe('HLS playback failed: fragLoadError');
});

test('redacts signed URLs and credentials from playback diagnostics', () => {
  for (const message of [
    'Failed https://cdn.example/movie.m3u8?token=LOCAL-SECRET',
    'Unable to load https://user:pass@cdn.example/movie.mp4',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'apiKey=LOCAL-SECRET rejected',
    'session=LOCAL-SECRET rejected',
    'Cookie: session=LOCAL-SECRET; path=/',
    'Set-Cookie: playback_session=LOCAL-SECRET; Secure',
    'https://cdn.example/1234567890abcdef1234567890abcdef/movie.m3u8 failed',
    'GET /stream/1234567890abcdef1234567890abcdef',
    'Failed https%3A%2F%2Fcdn.example%2Fmovie.m3u8%3Ftoken%3DLOCAL-SECRET',
    'request auth_token%3DLOCAL-SECRET failed',
    'Authorization%3A%20Bearer%20LOCAL-SECRET rejected',
  ]) {
    const safe = safePlaybackErrorMessage(message, 'Playback failed');
    expect(safe).toBe('Playback failed');
    expect(safe).not.toContain('SECRET');
    expect(safe).not.toContain('cdn.example');
  }
});

test('normalizes and bounds playback diagnostics', () => {
  expect(safePlaybackErrorMessage(
    ' first\n second ',
    'Playback failed',
  )).toBe('first second');

  const safe = safePlaybackErrorMessage(
    'x'.repeat(800),
    'Playback failed',
  );
  expect(safe.length).toBeLessThanOrEqual(200);
  expect(safe.endsWith('…')).toBe(true);
});

test('uses fallback when no useful diagnostic exists', () => {
  expect(safePlaybackErrorMessage(undefined, 'Playback failed'))
    .toBe('Playback failed');
  expect(safePlaybackErrorMessage('', 'Playback failed'))
    .toBe('Playback failed');
});

test('classifies AVPlayer container failures for the VLC retry', () => {
  for (const message of [
    'Failed to load the player item',
    'Cannot Open',
    'AVFoundationErrorDomain -11828',
    'The format is not supported',
  ]) {
    expect(safeNativePlaybackErrorMessage(message, 'Playback failed'))
      .toBe(NATIVE_FORMAT_PLAYBACK_ERROR);
  }
});

test('keeps ordinary native errors on the normal failover path', () => {
  expect(safeNativePlaybackErrorMessage(
    'Network timeout',
    'Playback failed',
  )).toBe('Network timeout');

  // A container failure that also carries a URL must not leak it.
  expect(safeNativePlaybackErrorMessage(
    'Failed to load the player item from https://cdn.example/movie.mkv?token=LOCAL-SECRET',
    'Playback failed',
  )).toBe(NATIVE_FORMAT_PLAYBACK_ERROR);

  expect(safeNativePlaybackErrorMessage(undefined, 'Video source failed'))
    .toBe('Video source failed');
});
