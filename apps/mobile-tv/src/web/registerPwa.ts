import { registerPwaInstallLifecycle } from './pwaInstall';

export interface PwaEnvironment {
  document?: Document;
  navigator?: Navigator;
  window?: Window;
}

const foregroundUpdateDocuments = new WeakSet<Document>();

function browserEnvironment(): PwaEnvironment {
  const root = globalThis as typeof globalThis & {
    document?: Document;
    navigator?: Navigator;
    window?: Window;
  };
  return {
    document: root.document,
    navigator: root.navigator,
    window: root.window,
  };
}

export function registerPwa(environment?: PwaEnvironment): void {
  const active = environment ?? browserEnvironment();
  if (
    active.window
    && typeof active.window.addEventListener === 'function'
  ) {
    registerPwaInstallLifecycle(active.window, active.navigator);
  }

  const documentObject = active.document;
  if (!documentObject) return;

  if (!documentObject.querySelector('link[rel="manifest"]')) {
    const manifest = documentObject.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.webmanifest';
    documentObject.head.appendChild(manifest);
  }

  const viewport = documentObject.querySelector(
    'meta[name="viewport"]',
  ) as HTMLMetaElement | null;
  if (!viewport) {
    const meta = documentObject.createElement('meta');
    meta.name = 'viewport';
    meta.content =
      'width=device-width, initial-scale=1, viewport-fit=cover';
    documentObject.head.appendChild(meta);
  } else {
    const viewportContent = typeof viewport.content === 'string'
      ? viewport.content
      : '';
    if (!/\bviewport-fit\s*=\s*cover\b/i.test(viewportContent)) {
      const current = viewportContent.trim().replace(/,+\s*$/, '');
      viewport.content = current
        ? `${current}, viewport-fit=cover`
        : 'width=device-width, initial-scale=1, viewport-fit=cover';
    }
  }

  if (!documentObject.querySelector('meta[name="theme-color"]')) {
    const theme = documentObject.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#09090b';
    documentObject.head.appendChild(theme);
  }

  if (!documentObject.querySelector('link[rel="apple-touch-icon"]')) {
    const appleIcon = documentObject.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = '/icon-192.png';
    documentObject.head.appendChild(appleIcon);
  }

  if (!documentObject.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const capable = documentObject.createElement('meta');
    capable.name = 'apple-mobile-web-app-capable';
    capable.content = 'yes';
    documentObject.head.appendChild(capable);
  }

  if (!documentObject.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
    const statusBar = documentObject.createElement('meta');
    statusBar.name = 'apple-mobile-web-app-status-bar-style';
    statusBar.content = 'black-translucent';
    documentObject.head.appendChild(statusBar);
  }

  if (!documentObject.querySelector('meta[name="apple-mobile-web-app-title"]')) {
    const title = documentObject.createElement('meta');
    title.name = 'apple-mobile-web-app-title';
    title.content = 'MoviesTv-Flix';
    documentObject.head.appendChild(title);
  }

  const serviceWorker = active.navigator?.serviceWorker;
  if (serviceWorker) {
    // Do not force-reload an already running PWA when a new worker activates.
    // A forced controllerchange reload can interrupt playback and, by design,
    // would also clear session-memory-only private provider credentials. The
    // new worker may take control now; the new application shell is picked up
    // on the user's next natural reopen/reload.
    void serviceWorker.register('/service-worker.js', {
      updateViaCache: 'none',
    }).then((registration) => {
      if (
        typeof documentObject.addEventListener === 'function'
        && !foregroundUpdateDocuments.has(documentObject)
      ) {
        foregroundUpdateDocuments.add(documentObject);
        documentObject.addEventListener('visibilitychange', () => {
          if (documentObject.visibilityState !== 'visible') return;
          void registration.update().catch(() => undefined);
        });
      }

      // The first update check must never gate future foreground retries.
      // A temporary network failure (or a slow update check) can therefore
      // recover the next time the installed PWA becomes visible.
      void registration.update().catch(() => undefined);
    }).catch(() => undefined);
  }
}
