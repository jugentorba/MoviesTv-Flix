const GENERIC_BOOT_ERROR = 'MoviesTv-Flix could not finish starting.';
const MAX_BOOT_ERROR_LENGTH = 200;

const sensitivePatterns = [
  /\b(?:authorization|bearer|password|passwd|secret|signature|credential|session|cookie|debrid)\b/i,
  /\b(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|service[-_]?role|session)\b/i,
  /\bsb_secret_[A-Za-z0-9_-]+\b/i,
  /https?:\/\/\S*[?&#](?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|debrid)=/i,
  /https?:\/\/\S*\/(?:[^\s/?#]+\/)*[^\s/?#=]+=[^\s/?#]+\/manifest\.json/i,
  /https?:\/\/\S*\/[A-Za-z0-9_-]{24,}\/manifest\.json/i,
];

function normalizeMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function safeBootErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return GENERIC_BOOT_ERROR;
  }

  const message = normalizeMessage(error.message);
  if (!message || sensitivePatterns.some((pattern) => pattern.test(message))) {
    return GENERIC_BOOT_ERROR;
  }

  if (message.length <= MAX_BOOT_ERROR_LENGTH) return message;
  return `${message.slice(0, MAX_BOOT_ERROR_LENGTH - 1)}…`;
}
