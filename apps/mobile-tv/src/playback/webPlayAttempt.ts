export type WebPlayFailure = 'interaction-required' | 'source-failed' | 'interrupted' | 'unknown';

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

export function classifyWebPlayFailure(error: unknown): WebPlayFailure {
  switch (errorName(error)) {
    case 'NotAllowedError':
      return 'interaction-required';
    case 'NotSupportedError':
      return 'source-failed';
    case 'AbortError':
      return 'interrupted';
    default:
      return 'unknown';
  }
}


/**
 * Browsers can reject an eager play() with NotSupportedError before source
 * metadata has been examined at all (readyState 0). Safari can hit this while
 * native HLS is still starting, while HLS.js can remain provisional until it
 * reaches HAVE_FUTURE_DATA (readyState 3). A real unsupported direct source
 * will still emit the media element error event, so avoid treating only these
 * early play() rejections as terminal source failures.
 */
export function shouldDeferWebPlayFailure(
  failure: WebPlayFailure,
  usesHlsJs: boolean,
  mediaReadyState: number,
): boolean {
  if (
    failure !== 'source-failed'
    || !Number.isFinite(mediaReadyState)
  ) return false;

  return mediaReadyState < 1
    || (usesHlsJs && mediaReadyState < 3);
}


export function shouldAttemptWebPlayback(
  visibilityState: string | undefined,
  online: boolean | undefined,
): boolean {
  return visibilityState !== 'hidden' && online !== false;
}


export function shouldRevealWebPlayButton(
  failure: WebPlayFailure,
  revealUnknownFailure = false,
): boolean {
  if (failure === 'interaction-required') return true;
  return failure === 'unknown' && revealUnknownFailure;
}
