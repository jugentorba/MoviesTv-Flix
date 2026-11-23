import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

export type FormFactor = 'phone' | 'tablet' | 'tv';

export const WEB_TV_LAYOUT_STORAGE_KEY = 'moviestv:web-tv-layout:v1';

type WebStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const webTvLayoutListeners = new Set<(forced: boolean) => void>();

function browserStorage(): WebStorageLike | undefined {
  try {
    return (globalThis as typeof globalThis & {
      localStorage?: WebStorageLike;
    }).localStorage;
  } catch {
    return undefined;
  }
}

export function webTvLayoutRequested(
  search: string | null | undefined,
): boolean {
  if (!search) return false;
  try {
    const params = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    );
    return params.get('tv') === '1'
      || params.get('layout')?.toLowerCase() === 'tv';
  } catch {
    return false;
  }
}

export function webTvBootstrapUrlWithoutOverride(
  href: string | null | undefined,
): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    let changed = false;
    if (url.searchParams.get('tv') === '1') {
      url.searchParams.delete('tv');
      changed = true;
    }
    if (url.searchParams.get('layout')?.toLowerCase() === 'tv') {
      url.searchParams.delete('layout');
      changed = true;
    }
    if (!changed) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function readWebTvLayoutOverride(
  storage: WebStorageLike | undefined = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(WEB_TV_LAYOUT_STORAGE_KEY) === 'tv';
  } catch {
    return false;
  }
}

export function setWebTvLayoutOverride(
  forced: boolean,
  storage: WebStorageLike | undefined = browserStorage(),
): void {
  try {
    if (storage) {
      if (forced) storage.setItem(WEB_TV_LAYOUT_STORAGE_KEY, 'tv');
      else storage.removeItem(WEB_TV_LAYOUT_STORAGE_KEY);
    }
  } catch {
    // The in-memory notification still updates this running PWA when browser
    // storage is unavailable or blocked.
  }
  for (const listener of [...webTvLayoutListeners]) {
    try { listener(forced); } catch { /* isolate layout listeners */ }
  }
}

export function subscribeWebTvLayoutOverride(
  listener: (forced: boolean) => void,
): () => void {
  webTvLayoutListeners.add(listener);
  return () => {
    webTvLayoutListeners.delete(listener);
  };
}

export function useWebTvLayoutOverride(): [
  boolean,
  (forced: boolean) => void,
] {
  const requestedByUrl = Platform.OS === 'web'
    && webTvLayoutRequested(
      (globalThis as typeof globalThis & {
        location?: { search?: string };
      }).location?.search,
    );
  const [forced, setForced] = useState(() => (
    Platform.OS === 'web'
    && (requestedByUrl || readWebTvLayoutOverride())
  ));

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const unsubscribe = subscribeWebTvLayoutOverride(setForced);
    if (requestedByUrl) {
      setWebTvLayoutOverride(true);
      try {
        const runtime = globalThis as typeof globalThis & {
          location?: { href?: string };
          history?: {
            state?: unknown;
            replaceState?(
              state: unknown,
              title: string,
              url?: string | URL | null,
            ): void;
          };
        };
        const cleanUrl = webTvBootstrapUrlWithoutOverride(
          runtime.location?.href,
        );
        if (cleanUrl && typeof runtime.history?.replaceState === 'function') {
          runtime.history.replaceState(
            runtime.history.state ?? null,
            '',
            cleanUrl,
          );
        }
      } catch {
        // The persisted device override is sufficient when URL cleanup is
        // unavailable in an embedded or restricted TV browser.
      }
    } else {
      setForced(readWebTvLayoutOverride());
    }
    return unsubscribe;
  }, [requestedByUrl]);

  return [forced, setWebTvLayoutOverride];
}

export function isLikelyWebTvUserAgent(
  userAgent: string | null | undefined,
): boolean {
  const normalized = userAgent?.trim().toLowerCase() ?? '';
  if (!normalized) return false;

  return /(?:android[\s/;_-]*tv|google[\s_-]*tv|smart[\s_-]*tv|hbbtv|tizen|webos|netcast|bravia|crkey|(?:^|[\s;(])aft[a-z0-9]*\b)/i
    .test(normalized);
}


const TABLET_MIN_SHORT_EDGE = 600;
const DESKTOP_MIN_WIDTH = 1024;
const DESKTOP_MIN_HEIGHT = 500;

export function formFactorForDimensions(
  width: number,
  height: number,
  isTv = false,
): FormFactor {
  if (isTv) return 'tv';

  const shortEdge = Math.min(width, height);
  const desktopWide = width >= DESKTOP_MIN_WIDTH && height >= DESKTOP_MIN_HEIGHT;
  return shortEdge >= TABLET_MIN_SHORT_EDGE || desktopWide ? 'tablet' : 'phone';
}

export function useFormFactor(): FormFactor {
  const { width, height } = useWindowDimensions();
  const [forcedWebTv] = useWebTvLayoutOverride();
  const webTv = Platform.OS === 'web'
    && (
      forcedWebTv
      || isLikelyWebTvUserAgent(
        (globalThis as typeof globalThis & {
          navigator?: { userAgent?: string };
        }).navigator?.userAgent,
      )
    );
  return formFactorForDimensions(
    width,
    height,
    Boolean(Platform.isTV || webTv),
  );
}
