import { useEffect } from 'react';

export type SpatialDirection = 'left' | 'right' | 'up' | 'down';

export type WebTvBackHandler = () => boolean;

const webTvBackHandlers: WebTvBackHandler[] = [];

export function registerWebTvBackHandler(
  handler: WebTvBackHandler,
): () => void {
  webTvBackHandlers.push(handler);
  return () => {
    const index = webTvBackHandlers.lastIndexOf(handler);
    if (index >= 0) webTvBackHandlers.splice(index, 1);
  };
}

export function dispatchWebTvBack(): boolean {
  for (let index = webTvBackHandlers.length - 1; index >= 0; index -= 1) {
    try {
      if (webTvBackHandlers[index]?.()) return true;
    } catch {
      // One stale screen handler must not block the next back layer.
    }
  }
  return false;
}

export function isWebTvBackKey(event: {
  key?: string | null;
  keyCode?: number;
  which?: number;
}): boolean {
  const key = event.key?.trim().toLowerCase() ?? '';
  if ([
    'escape',
    'browserback',
    'goback',
    'back',
    'xf86back',
  ].includes(key)) return true;

  const code = event.keyCode ?? event.which;
  return code === 27 || code === 461 || code === 10009;
}

export type WebTvChannelAction = 'previous' | 'next' | 'list';

export function webTvChannelAction(event: {
  key?: string | null;
  code?: string | null;
  keyCode?: number;
  which?: number;
}): WebTvChannelAction | null {
  const key = event.key?.trim().toLowerCase() ?? '';
  const codeName = event.code?.trim().toLowerCase() ?? '';
  const numericCode = event.keyCode ?? event.which;

  if (
    key === 'channelup'
    || codeName === 'channelup'
    || key === 'f12'
    || codeName === 'f12'
    || numericCode === 427
    || numericCode === 123
  ) return 'next';

  if (
    key === 'channeldown'
    || codeName === 'channeldown'
    || key === 'f11'
    || codeName === 'f11'
    || numericCode === 428
    || numericCode === 122
  ) return 'previous';

  if (
    key === 'channellist'
    || codeName === 'channellist'
    || numericCode === 10073
  ) return 'list';

  return null;
}


export interface FocusRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function center(rect: FocusRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return Math.max(firstStart, secondStart)
    <= Math.min(firstEnd, secondEnd);
}

export function spatialFocusIndex(
  rects: readonly FocusRect[],
  currentIndex: number,
  direction: SpatialDirection,
): number {
  const current = rects[currentIndex];
  if (!current) return -1;

  const currentCenter = center(current);
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  rects.forEach((candidate, index) => {
    if (index === currentIndex) return;
    const candidateCenter = center(candidate);
    const deltaX = candidateCenter.x - currentCenter.x;
    const deltaY = candidateCenter.y - currentCenter.y;

    const horizontal = direction === 'left' || direction === 'right';
    const primary = horizontal ? Math.abs(deltaX) : Math.abs(deltaY);
    const secondary = horizontal ? Math.abs(deltaY) : Math.abs(deltaX);
    const inDirection = direction === 'left'
      ? deltaX < -1
      : direction === 'right'
        ? deltaX > 1
        : direction === 'up'
          ? deltaY < -1
          : deltaY > 1;
    if (!inDirection) return;

    const aligned = horizontal
      ? rangesOverlap(
          current.top,
          current.bottom,
          candidate.top,
          candidate.bottom,
        )
      : rangesOverlap(
          current.left,
          current.right,
          candidate.left,
          candidate.right,
        );
    const score = primary * 1_000
      + secondary
      + (aligned ? 0 : 1_000_000);

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input'
    || tag === 'textarea'
    || tag === 'select'
    || target.isContentEditable;
}

function visibleElement(element: HTMLElement): boolean {
  if (
    element.getAttribute('aria-disabled') === 'true'
    || element.hasAttribute('disabled')
    || element.hidden
  ) return false;

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function activeFocusRoot(
  documentObject: Document,
): Document | HTMLElement {
  const modals = [
    ...documentObject.querySelectorAll<HTMLElement>(
      '[aria-modal="true"]',
    ),
  ].filter(visibleElement);

  return modals.at(-1) ?? documentObject;
}

function focusableElements(documentObject: Document): HTMLElement[] {
  const root = activeFocusRoot(documentObject);
  const candidates = root.querySelectorAll<HTMLElement>([
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','));

  return [...candidates].filter(visibleElement);
}


export function focusWebTvControl(
  target: { focus?: () => void } | null | undefined,
): boolean {
  if (!target || typeof target.focus !== 'function') return false;
  try {
    target.focus();
    return true;
  } catch {
    return false;
  }
}


export function restoreWebTvFocus(
  target: {
    focus?: () => void;
    isConnected?: boolean;
    tagName?: string;
  } | null | undefined,
): boolean {
  if (!target || target.isConnected === false) return false;
  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'body' || tagName === 'html') return false;
  return focusWebTvControl(target);
}

export function focusInitialWebTvElement(
  documentObject: Document,
): boolean {
  const elements = focusableElements(documentObject);
  if (!elements.length) return false;

  const active = documentObject.activeElement;
  if (elements.some((element) => element === active)) return false;

  try {
    elements[0]?.focus();
    return true;
  } catch {
    return false;
  }
}

export function installWebTvRemoteNavigation(
  documentObject: Document,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) return;

    if (isWebTvBackKey(event)) {
      if (isTextEntryTarget(event.target)) {
        event.preventDefault();
        (event.target as HTMLElement).blur();
        return;
      }
      if (dispatchWebTvBack()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (isTextEntryTarget(event.target)) return;

    const direction: SpatialDirection | null = event.key === 'ArrowLeft'
      ? 'left'
      : event.key === 'ArrowRight'
        ? 'right'
        : event.key === 'ArrowUp'
          ? 'up'
          : event.key === 'ArrowDown'
            ? 'down'
            : null;
    if (!direction) return;

    const elements = focusableElements(documentObject);
    if (!elements.length) return;

    const active = documentObject.activeElement;
    const currentIndex = elements.findIndex(
      (element) => element === active,
    );

    if (currentIndex < 0) {
      event.preventDefault();
      elements[0]?.focus();
      return;
    }

    const nextIndex = spatialFocusIndex(
      elements.map((element) => element.getBoundingClientRect()),
      currentIndex,
      direction,
    );
    if (nextIndex < 0) return;

    event.preventDefault();
    elements[nextIndex]?.focus();
  };

  focusInitialWebTvElement(documentObject);
  documentObject.addEventListener('keydown', onKeyDown);
  return () => {
    documentObject.removeEventListener('keydown', onKeyDown);
  };
}

export function useWebTvModalFocusRestore(
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const previous = document.activeElement as {
      focus?: () => void;
      isConnected?: boolean;
      tagName?: string;
    } | null;

    focusInitialWebTvElement(document);

    return () => {
      restoreWebTvFocus(previous);
    };
  }, [enabled]);
}

export function useWebTvBackHandler(
  enabled: boolean,
  handler: WebTvBackHandler,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    return registerWebTvBackHandler(handler);
  }, [enabled, handler]);
}

export function useWebTvRemoteNavigation(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    return installWebTvRemoteNavigation(document);
  }, [enabled]);
}
