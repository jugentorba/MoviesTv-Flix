import { passwordProblem, signInPasswordValid } from '../passwordPolicy';

test('accepts a reasonable password', () => {
  expect(passwordProblem('brandnew1')).toBeNull();
  expect(passwordProblem('Passw0rd!')).toBeNull();
});

test('rejects short, long and one-note passwords', () => {
  expect(passwordProblem('short1')).toBe('too-short');
  expect(passwordProblem('a1'.repeat(40))).toBe('too-long');
  expect(passwordProblem('12345678')).toBe('needs-letter');
  expect(passwordProblem('password')).toBe('needs-number');
});

test('sign-in accepts older passwords the policy would reject', () => {
  expect(signInPasswordValid('oldpass')).toBe(true);
  expect(signInPasswordValid('')).toBe(false);
  expect(signInPasswordValid('line\nbreak')).toBe(false);
});
