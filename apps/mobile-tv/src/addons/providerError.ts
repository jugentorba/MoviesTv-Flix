const DEFAULT_FALLBACK = 'Provider operation failed';
const MAX_LENGTH = 240;

const sensitivePatterns = [
  /https?:\/\/\S+/i,
  /https?%3a%2f%2f\S+/i,
  /\bauthorization\s*[:=]\s*\S+/i,
  /\b(?:set-)?cookie\s*[:=]\s*\S+/i,
  /\bbearer\s+\S+/i,
  /\b(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session|debrid)\s*[:=]\s*\S+/i,
  /\b(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session|debrid)%3d\S+/i,
  /\bsb_secret_[A-Za-z0-9_-]+\b/i,
  /\/[A-Za-z0-9_-]{24,}(?:\/|$)/i,
];


export function isProviderNetworkError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : '';
  const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalized === 'failed to fetch'
    || normalized === 'fetch failed'
    || normalized === 'load failed'
    || normalized === 'network request failed'
    || normalized === 'networkerror when attempting to fetch resource.'
    || normalized.includes('network request failed')
    || normalized.includes('network connection was lost')
    || normalized.includes('internet connection appears to be offline')
    || normalized.includes('server with the specified hostname could not be found');
}

export function safeProviderErrorMessage(
  error: unknown,
  fallback = DEFAULT_FALLBACK,
): string {
  const raw = error instanceof Error ? error.message : '';
  const normalized = raw.replace(/\s+/g, ' ').trim();

  if (
    !normalized
    || sensitivePatterns.some((pattern) => pattern.test(normalized))
  ) {
    return fallback;
  }

  if (normalized.length <= MAX_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LENGTH - 1)}…`;
}
