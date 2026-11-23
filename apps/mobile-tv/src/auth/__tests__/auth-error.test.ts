import { safeAuthErrorMessage } from '../authError';

test('keeps useful non-sensitive authentication errors', () => {
  expect(safeAuthErrorMessage(new Error('Invalid login credentials')))
    .toBe('Invalid login credentials');
  expect(safeAuthErrorMessage(new Error('Email not confirmed')))
    .toBe('Email not confirmed');
});

test('redacts URLs and credentials from authentication errors', () => {
  for (const message of [
    'POST https://example.supabase.co/auth/v1/token failed',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'refresh_token=LOCAL-SECRET expired',
    'session=LOCAL-SECRET expired',
    'Cookie: sb_session=LOCAL-SECRET',
    'Set-Cookie: sb_session=LOCAL-SECRET; Secure',
    'sb_secret_1234567890abcdefghijklmnop rejected',
    'POST https%3A%2F%2Fexample.supabase.co%2Fauth%2Fv1%2Ftoken failed',
    'refresh_token%3DLOCAL-SECRET expired',
    '/AbCdEfGhIjKlMnOpQrStUvWx12345678/auth failed',
  ]) {
    const safe = safeAuthErrorMessage(new Error(message));
    expect(safe).toBe('Authentication failed');
    expect(safe).not.toContain('SECRET');
    expect(safe).not.toContain('supabase.co');
  }
});

test('normalizes and bounds authentication messages', () => {
  expect(safeAuthErrorMessage(new Error(' first\n second ')))
    .toBe('first second');

  const safe = safeAuthErrorMessage(new Error('x'.repeat(800)));
  expect(safe.length).toBeLessThanOrEqual(240);
  expect(safe.endsWith('…')).toBe(true);
});

test('uses the generic fallback for unknown thrown values', () => {
  expect(safeAuthErrorMessage({ private: true }))
    .toBe('Authentication failed');
});
