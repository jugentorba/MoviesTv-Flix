const MAX_LENGTH = 200;

const sensitivePatterns = [
  /https?:\/\/\S+/i,
  /https?%3a%2f%2f\S+/i,
  /\bauthorization\s*[:=]\s*\S+/i,
  /\bauthorization%3a(?:%20|\+)*bearer(?:%20|\+)+\S+/i,
  /\b(?:set-)?cookie\s*[:=]\s*\S+/i,
  /\bbearer\s+\S+/i,
  /\b(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session|debrid)\s*[:=]\s*\S+/i,
  /\b(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session|debrid)%3d\S+/i,
  /\bsb_secret_[A-Za-z0-9_-]+\b/i,
  /\/[A-Za-z0-9_-]{24,}(?:\/|$)/i,
];

export function safePlaybackErrorMessage(
  message: unknown,
  fallback: string,
): string {
  const normalized = typeof message === 'string'
    ? message.replace(/\s+/g, ' ').trim()
    : '';

  if (
    !normalized
    || sensitivePatterns.some((pattern) => pattern.test(normalized))
  ) {
    return fallback;
  }

  if (normalized.length <= MAX_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LENGTH - 1)}…`;
}

/*
 * AVPlayer reports a container/codec it cannot demux as a generic item failure,
 * so the native surface normalizes that class of error to one stable marker.
 * The marker is what lets the surface retry the same source on the VLC engine
 * without leaking the raw AVFoundation text (which can carry signed URLs).
 */
const nativeFormatFailurePattern =
  /failed\s+to\s+load\s+(?:the\s+)?(?:player\s+)?item|player\s+item\s+(?:cannot|can't|could\s+not|couldn't)|(?:cannot|can't|could\s+not|couldn't)\s+open|avfoundationerrordomain|-11828|unsupported\s+format|format\s+is\s+not\s+supported|decoder\s+not\s+available/i;

export const NATIVE_FORMAT_PLAYBACK_ERROR = 'Native media format unsupported';

export function safeNativePlaybackErrorMessage(
  message: unknown,
  fallback: string,
): string {
  const normalized = typeof message === 'string'
    ? message.replace(/\s+/g, ' ').trim()
    : '';

  if (normalized && nativeFormatFailurePattern.test(normalized)) {
    return NATIVE_FORMAT_PLAYBACK_ERROR;
  }

  return safePlaybackErrorMessage(message, fallback);
}
