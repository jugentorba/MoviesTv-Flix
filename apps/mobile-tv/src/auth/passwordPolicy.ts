/**
 * One password rule, shared by sign-up, recovery and change-password.
 *
 * The backend enforces its own policy (Supabase: minimum length and optional
 * leaked-password protection), so this is the client's mirror: long enough to be
 * useful, short enough for bcrypt's 72-byte limit, and not a single repeated
 * character. Sign-in deliberately accepts any non-empty password — an account
 * created under an older rule must still be able to log in.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** Supabase hashes with bcrypt, which ignores everything past 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordProblem =
  | 'too-short'
  | 'too-long'
  | 'needs-letter'
  | 'needs-number';

export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too-short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too-long';
  if (!/[A-Za-z]/.test(password)) return 'needs-letter';
  if (!/[0-9]/.test(password)) return 'needs-number';
  return null;
}

/** Sign-in only needs something the backend can compare. */
export function signInPasswordValid(password: string): boolean {
  return password.length > 0
    && password.length <= 1024
    && !/[\u0000-\u001f\u007f]/.test(password);
}
