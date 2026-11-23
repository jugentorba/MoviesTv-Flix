import { safeBootErrorMessage } from '../safeErrorMessage';

test('preserves concise non-sensitive startup errors', () => {
  expect(safeBootErrorMessage(new Error('Network request failed'))).toBe(
    'Network request failed',
  );
});

test('does not expose provider credentials from startup errors', () => {
  for (const message of [
    'Failed https://provider.example/manifest.json?token=LOCAL-SECRET',
    'Failed https://provider.example/manifest.json?key=LOCAL-SECRET',
    'Authorization: Bearer super-secret-value',
    'session=LOCAL-SECRET rejected',
    'Cookie: boot_session=LOCAL-SECRET',
    'Set-Cookie: boot_session=LOCAL-SECRET; Secure',
    'Supabase sb_secret_1234567890abcdefghijklmnop was rejected',
    'service_role credential rejected',
    'https://provider.example/realdebrid=LOCAL-SECRET/manifest.json failed',
    'https://provider.example/1234567890abcdef1234567890abcdef/manifest.json failed',
  ]) {
    const safe = safeBootErrorMessage(new Error(message));
    expect(safe).toBe('MoviesTv-Flix could not finish starting.');
    expect(safe).not.toContain('SECRET');
  }
});

test('normalizes and bounds startup diagnostics', () => {
  expect(safeBootErrorMessage(new Error('  first\n  second  '))).toBe(
    'first second',
  );

  const safe = safeBootErrorMessage(new Error('x'.repeat(500)));
  expect(safe.length).toBeLessThanOrEqual(200);
  expect(safe.endsWith('…')).toBe(true);
});

test('uses a generic diagnostic for unknown thrown values', () => {
  expect(safeBootErrorMessage({ private: 'value' })).toBe(
    'MoviesTv-Flix could not finish starting.',
  );
});
