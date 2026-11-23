const FALLBACK = 'Authentication failed';
const MAX_LENGTH = 240;

const sensitivePatterns = [
  /https?:\/\/\S+/i,
  /https?%3a%2f%2f\S+/i,
  /\bauthorization\s*[:=]\s*\S+/i,
  /\b(?:set-)?cookie\s*[:=]\s*\S+/i,
  /\bbearer\s+\S+/i,
  /\b(?:access[-_]?token|refresh[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session)\s*[:=]\s*\S+/i,
  /\b(?:access[-_]?token|refresh[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session)%3d\S+/i,
  /\bsb_secret_[A-Za-z0-9_-]+\b/i,
  /\/[A-Za-z0-9_-]{24,}(?:\/|$)/i,
];

export function safeAuthErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  const normalized = raw.replace(/\s+/g, ' ').trim();

  if (
    !normalized
    || sensitivePatterns.some((pattern) => pattern.test(normalized))
  ) {
    return FALLBACK;
  }

  if (normalized.length <= MAX_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LENGTH - 1)}…`;
}
