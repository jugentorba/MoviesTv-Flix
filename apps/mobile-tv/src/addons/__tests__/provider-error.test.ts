import {
  isProviderNetworkError,
  safeProviderErrorMessage,
} from '../providerError';

test('keeps concise non-sensitive provider errors', () => {
  expect(safeProviderErrorMessage(
    new Error('Provider request failed with 404 Not Found'),
    'Unavailable',
  )).toBe('Provider request failed with 404 Not Found');

  expect(safeProviderErrorMessage(
    new Error('Provider manifest URL is unavailable'),
    'Unavailable',
  )).toBe('Provider manifest URL is unavailable');
});

test('redacts credential-bearing provider errors', () => {
  for (const message of [
    'Failed https://provider.example/manifest.json?token=LOCAL-SECRET',
    'Failed https://provider.example/key=LOCAL-SECRET/manifest.json',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'apiKey=LOCAL-SECRET rejected',
    'session=LOCAL-SECRET rejected',
    'Cookie: provider_session=LOCAL-SECRET',
    'Set-Cookie: provider_session=LOCAL-SECRET; Secure',
    'https://provider.example/1234567890abcdef1234567890abcdef/manifest.json failed',
    'Failed https%3A%2F%2Fprovider.example%2Fmanifest.json%3Ftoken%3DLOCAL-SECRET',
    'token%3DLOCAL-SECRET rejected',
    '/AbCdEfGhIjKlMnOpQrStUvWx12345678/request failed',
  ]) {
    const safe = safeProviderErrorMessage(new Error(message), 'Unavailable');
    expect(safe).toBe('Unavailable');
    expect(safe).not.toContain('SECRET');
    expect(safe).not.toContain('provider.example');
  }
});

test('normalizes and bounds safe provider errors', () => {
  expect(safeProviderErrorMessage(
    new Error(' first\n second '),
    'Unavailable',
  )).toBe('first second');

  const safe = safeProviderErrorMessage(
    new Error('x'.repeat(800)),
    'Unavailable',
  );
  expect(safe.length).toBeLessThanOrEqual(240);
  expect(safe.endsWith('…')).toBe(true);
});

test('uses the supplied fallback for unknown thrown values', () => {
  expect(safeProviderErrorMessage({ private: true }, 'Unavailable'))
    .toBe('Unavailable');
});


test('recognizes browser-style provider network failures without inspecting URLs', () => {
  expect(isProviderNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  expect(isProviderNetworkError(new Error('Load failed'))).toBe(true);
  expect(isProviderNetworkError(new Error('Network request failed'))).toBe(true);
  expect(isProviderNetworkError(new Error('Fetch failed'))).toBe(true);
  expect(isProviderNetworkError(new Error(
    'The Internet connection appears to be offline.',
  ))).toBe(true);
  expect(isProviderNetworkError(new Error(
    'A server with the specified hostname could not be found.',
  ))).toBe(true);
  expect(isProviderNetworkError(new Error(
    'The network connection was lost.',
  ))).toBe(true);
  expect(isProviderNetworkError(new Error('Provider request failed with 404 Not Found'))).toBe(false);
  expect(isProviderNetworkError('Failed to fetch')).toBe(false);
});

