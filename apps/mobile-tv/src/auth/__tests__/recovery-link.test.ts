import { parseRecoveryTokens } from '../recoveryLink';

test('reads tokens from a recovery hash', () => {
  expect(parseRecoveryTokens(
    'moviestvflix://auth/reset#access_token=abc&refresh_token=def&type=recovery',
  )).toEqual({ accessToken: 'abc', refreshToken: 'def' });
});

test('reads tokens from a query string', () => {
  expect(parseRecoveryTokens(
    'https://app.example/auth/reset?access_token=one&refresh_token=two',
  )).toEqual({ accessToken: 'one', refreshToken: 'two' });
});

test('prefers the hash when both are present', () => {
  expect(parseRecoveryTokens(
    'moviestvflix://auth/reset?access_token=query#access_token=hash&refresh_token=refresh',
  )).toEqual({ accessToken: 'hash', refreshToken: 'refresh' });
});

test('rejects links without both tokens', () => {
  expect(parseRecoveryTokens('moviestvflix://auth/reset#access_token=abc')).toBeNull();
  expect(parseRecoveryTokens('moviestvflix://auth/reset')).toBeNull();
  expect(parseRecoveryTokens('')).toBeNull();
});

test('rejects control characters and absurd lengths', () => {
  expect(parseRecoveryTokens(
    'moviestvflix://auth/reset#access_token=ab%0Ac&refresh_token=def',
  )).toBeNull();
  expect(parseRecoveryTokens(
    `moviestvflix://auth/reset#access_token=${'a'.repeat(5000)}&refresh_token=def`,
  )).toBeNull();
});
