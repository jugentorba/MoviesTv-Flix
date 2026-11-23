const CACHE = 'moviestv-shell-__MOVIESTV_BUILD_ID__';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  /* __MOVIESTV_SHELL_ASSETS__ */
];

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
    self.skipWaiting(),
  ]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('moviestv-shell-') && key !== CACHE)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

function sensitivePath(pathname) {
  const networkOnlyPrefix = [
    '/api/',
    '/auth/',
    '/rest/',
    '/realtime/',
    '/storage/',
    '/functions/',
  ].some((prefix) => (
    pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)
  ));
  if (networkOnlyPrefix) return true;

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return true;
  }

  const credentialSegment = /^(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|session|debrid|alldebrid|realdebrid)(?:=|:).+/i;
  return decodedPathname
    .split('/')
    .filter(Boolean)
    .some((segment) => {
      if (credentialSegment.test(segment)) return true;
      if (/^[a-f0-9]{24,}$/i.test(segment)) return true;
      if (
        /^[A-Za-z0-9_-]{32,}$/.test(segment)
        && /[A-Za-z]/.test(segment)
        && /\d/.test(segment)
      ) return true;
      if (
        segment.length >= 12
        && /[A-Z]/.test(segment)
        && /[a-z]/.test(segment)
        && /\d/.test(segment)
        && !/[._~-]/.test(segment)
      ) return true;
      return false;
    });
}

function sensitiveQuery(url) {
  const sensitive = /token|key|secret|auth|signature|session|credential/i;
  return [...url.searchParams.entries()].some(([key, value]) => (
    sensitive.test(key) || sensitive.test(value)
  ));
}

function sensitiveHeaders(request) {
  const entries = request.headers?.entries;
  if (typeof entries !== 'function') return false;

  const sensitive = /token|key|secret|auth|signature|session|credential/i;
  for (const [name, value] of request.headers.entries()) {
    if (sensitive.test(name) || sensitive.test(value)) return true;
  }
  return false;
}

function responseUrlMayBeCached(response) {
  const raw = response.url;
  if (!raw) return true;

  try {
    const url = new URL(raw);
    return (
      url.origin === self.location.origin
      && !sensitivePath(url.pathname)
      && !sensitiveQuery(url)
    );
  } catch {
    return false;
  }
}

function responseMayBeCached(response) {
  if (!response.ok || !responseUrlMayBeCached(response)) return false;
  const cacheControl = response.headers?.get?.('cache-control') ?? '';
  return !/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl);
}

function navigationResponseMayBeCached(response) {
  if (!responseMayBeCached(response)) return false;
  const contentType = response.headers?.get?.('content-type') ?? '';
  return /^(?:text\/html|application\/xhtml\+xml)\b/i.test(
    contentType.trim(),
  );
}

function staticAssetResponseMayBeCached(response) {
  if (!responseMayBeCached(response)) return false;
  const contentType = response.headers?.get?.('content-type') ?? '';
  return !/^text\/html\b/i.test(contentType.trim());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never let the app-shell worker sit in the media path. Native video/audio
  // requests and byte-range playback must reach the network directly so iOS
  // Safari can negotiate streaming/ranges without cached shell responses.
  if (
    request.destination === 'video'
    || request.destination === 'audio'
    || request.headers?.has?.('range')
  ) return;

  if (
    sensitivePath(url.pathname)
    || sensitiveQuery(url)
    || sensitiveHeaders(request)
  ) return;

  const isNavigation = request.mode === 'navigate' || request.destination === 'document';
  if (isNavigation) {
    event.respondWith(
      fetch(request).then((response) => {
        if (!navigationResponseMayBeCached(response)) return response;
        const copy = response.clone();
        return caches.open(CACHE)
          .then((cache) => cache.put(request, copy))
          .catch(() => undefined)
          .then(() => response);
      }).catch(() => caches.match(request)
        .then((cached) => cached || caches.match('/'))
        .then((cached) => cached || Response.error())),
    );
    return;
  }

  const cacheableDestination = ['script', 'style', 'image', 'font'].includes(request.destination);
  if (!cacheableDestination) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!staticAssetResponseMayBeCached(response)) return response;
      const copy = response.clone();
      return caches.open(CACHE)
        .then((cache) => cache.put(request, copy))
        .catch(() => undefined)
        .then(() => response);
    })),
  );
});
