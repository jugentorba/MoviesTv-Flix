export interface WebBackgroundMediaLike {
  paused: boolean;
  ended: boolean;
  pause(): void;
}

export function pauseWebMediaForBackground(
  media: WebBackgroundMediaLike,
): boolean {
  if (media.ended || media.paused) return false;
  media.pause();
  return true;
}


export function shouldResumeWebMediaAfterBackground({
  resumeRequested,
  visibilityState,
  online,
  ended,
}: {
  resumeRequested: boolean;
  visibilityState: string;
  online: boolean;
  ended: boolean;
}): boolean {
  return Boolean(
    resumeRequested
    && visibilityState !== 'hidden'
    && online
    && !ended
  );
}
