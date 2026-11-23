export interface FullscreenVideoLike {
  parentElement?: {
    requestFullscreen?: () => Promise<void>;
  } | null;
  webkitEnterFullscreen?: () => void;
}

export interface FullscreenDocumentLike {
  fullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
}

export async function toggleWebVideoFullscreen(
  video: FullscreenVideoLike,
  documentLike: FullscreenDocumentLike,
): Promise<void> {
  if (documentLike.fullscreenElement && documentLike.exitFullscreen) {
    await documentLike.exitFullscreen();
    return;
  }

  if (video.parentElement?.requestFullscreen) {
    try {
      await video.parentElement.requestFullscreen();
      return;
    } catch {
      // Some iPhone/PWA builds expose requestFullscreen but reject it for the
      // app container. Fall through to the native video fullscreen API.
    }
  }

  // iPhone Safari/PWA historically omits or rejects the standard Fullscreen
  // API for inline video while still exposing the native video method.
  try {
    video.webkitEnterFullscreen?.();
  } catch {
    // Fullscreen is optional; leave playback running inline if iOS rejects it.
  }
}
