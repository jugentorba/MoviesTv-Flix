import { safeDownloadErrorMessage } from '../downloadError';

test('keeps concise non-sensitive download errors', () => {
  expect(safeDownloadErrorMessage(new Error('Network request failed')))
    .toBe('Network request failed');
  expect(safeDownloadErrorMessage(new Error('Downloaded file is empty')))
    .toBe('Downloaded file is empty');
});

test('redacts signed URLs and credential material from download errors', () => {
  for (const message of [
    'Download failed for https://cdn.example/movie.mp4?token=LOCAL-SECRET',
    'Unable to open https://user:pass@cdn.example/movie.mp4',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'provider apiKey=LOCAL-SECRET rejected the request',
    'session=LOCAL-SECRET rejected the request',
    'Cookie: download_session=LOCAL-SECRET',
    'Set-Cookie: download_session=LOCAL-SECRET; Secure',
    'https://cdn.example/abcdefghijklmnopqrstuvwx/movie.mp4 failed',
    'Download https%3A%2F%2Fcdn.example%2Fmovie.mp4%3Ftoken%3DLOCAL-SECRET failed',
    'token%3DLOCAL-SECRET rejected',
    '/AbCdEfGhIjKlMnOpQrStUvWx12345678/movie.mp4 failed',
  ]) {
    const safe = safeDownloadErrorMessage(new Error(message));
    expect(safe).toBe('Download failed');
    expect(safe).not.toContain('SECRET');
    expect(safe).not.toContain('cdn.example');
  }
});

test('normalizes and bounds safe download errors', () => {
  expect(safeDownloadErrorMessage(new Error(' first\n second ')))
    .toBe('first second');

  const safe = safeDownloadErrorMessage(new Error('x'.repeat(800)));
  expect(safe.length).toBeLessThanOrEqual(200);
  expect(safe.endsWith('…')).toBe(true);
});

test('uses a generic message for unknown thrown values', () => {
  expect(safeDownloadErrorMessage({ url: 'private' })).toBe('Download failed');
});
