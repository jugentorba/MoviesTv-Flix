/**
 * Shows which account is signed in without printing the full address on a TV or
 * a shared screen. The local part keeps one character; the domain stays legible
 * so a typo is still recognisable.
 */
export function maskEmail(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at === 0) return '***';
  if (at < 0 || at === value.length - 1) {
    return value.length > 2 ? `${value[0]}***` : '***';
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local[0]}***@${domain}`;
}
