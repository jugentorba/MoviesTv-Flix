import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const serviceWorker = resolve(
  process.cwd(),
  'public',
  'service-worker.js',
);

function runtime() {
  const listeners = {};
  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim() {} },
    skipWaiting() {},
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async put() {},
        async addAll() {},
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'routing-test',
    ),
    {
      self,
      caches,
      fetch: async () => ({
        ok: false,
        clone() { return this; },
      }),
      URL,
      Promise,
    },
  );

  return listeners;
}

function intercepted(listeners, path, headers = []) {
  let responded = false;
  listeners.fetch({
    request: {
      method: 'GET',
      url: `https://app.example${path}`,
      mode: 'navigate',
      destination: 'document',
      headers: {
        entries() {
          return headers[Symbol.iterator]();
        },
      },
    },
    respondWith() {
      responded = true;
    },
  });
  return responded;
}

const listeners = runtime();

for (const path of [
  '/api',
  '/auth',
  '/rest',
  '/realtime',
  '/storage',
  '/functions',
]) {
  assert.equal(
    intercepted(listeners, path),
    false,
    `${path} must bypass the service worker`,
  );
  assert.equal(
    intercepted(listeners, `${path}/x`),
    false,
    `${path}/x must bypass the service worker`,
  );
}

assert.equal(intercepted(listeners, '/movie/123'), true);
for (const path of [
  '/assets/token=LOCAL-SECRET/poster.png',
  '/assets/api-key:LOCAL-SECRET/poster.png',
  '/assets/alldebrid=LOCAL-SECRET/poster.png',
  '/assets/a94f2c8e7d1b4a6c9e0f123456789abc/poster.png',
  '/assets/AbCdEfGhIjKlMnOpQrStUvWx12345678/poster.png',
  '/assets/550e8400-e29b-41d4-a716-446655440000/poster.png',
]) {
  assert.equal(
    intercepted(listeners, path),
    false,
    `${path} must bypass the service worker cache`,
  );
}

assert.equal(
  intercepted(listeners, '/movie/Secret-Garden'),
  true,
  'ordinary path words must not be mistaken for credentials',
);
assert.equal(
  interceptedMedia(
    '/assets/app-1234567890abcdef1234567890abcdef.js',
    'script',
  ),
  true,
  'hashed static filenames with an extension remain cacheable',
);


for (const path of [
  '/movie/123?accessToken=LOCAL-SECRET',
  '/movie/123?config=accessToken%3DLOCAL-SECRET',
  '/assets/app.js?signature=SIGNED-VALUE',
]) {
  assert.equal(
    intercepted(listeners, path),
    false,
    `${path} must bypass the service worker cache`,
  );
}

assert.equal(
  intercepted(listeners, '/movie/123?query=normal-search'),
  true,
);

function interceptedMedia(path, destination, headers = []) {
  let responded = false;
  listeners.fetch({
    request: {
      method: 'GET',
      url: `https://app.example${path}`,
      mode: 'cors',
      destination,
      headers: {
        entries() {
          return headers[Symbol.iterator]();
        },
        has(name) {
          const normalized = String(name).toLowerCase();
          return headers.some(([headerName]) => (
            String(headerName).toLowerCase() === normalized
          ));
        },
      },
    },
    respondWith() {
      responded = true;
    },
  });
  return responded;
}

for (const [destination, path] of [
  ['video', '/media/movie.mp4'],
  ['audio', '/media/audio.m4a'],
]) {
  assert.equal(
    interceptedMedia(path, destination),
    false,
    `${destination} requests must bypass the service worker`,
  );
}

assert.equal(
  interceptedMedia(
    '/media/movie.mp4',
    '',
    [['Range', 'bytes=1000-']],
  ),
  false,
  'range media requests must bypass the service worker',
);

for (const headers of [
  [['Authorization', 'Bearer LOCAL-SECRET']],
  [['X-Api-Key', 'LOCAL-SECRET']],
  [['X-Session-Token', 'LOCAL-SECRET']],
]) {
  assert.equal(
    intercepted(listeners, '/assets/app.js', headers),
    false,
    `${headers[0][0]} must bypass the service worker cache`,
  );
}

console.log('PASS service worker dynamic-route isolation');


async function assertCacheWriteIsPartOfResponse(path, request) {
  const listeners = {};
  let releasePut;
  const putGate = new Promise((resolve) => {
    releasePut = resolve;
  });
  let putCalls = 0;

  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async addAll() {},
        async put() {
          putCalls += 1;
          await putGate;
        },
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'cache-write-test',
    ),
    {
      self,
      caches,
      fetch: async () => new Response('network', {
        status: 200,
        headers: {
          'Content-Type': request.mode === 'navigate'
            ? 'text/html'
            : 'application/javascript',
        },
      }),
      URL,
      Response,
      Promise,
    },
  );

  let responsePromise;
  listeners.fetch({
    request: {
      method: 'GET',
      url: `https://app.example${path}`,
      ...request,
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
  });

  assert(responsePromise, `${path} was not intercepted`);
  let settled = false;
  void responsePromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(putCalls, 1, `${path} did not start a cache write`);
  assert.equal(
    settled,
    false,
    `${path} response settled before its cache write finished`,
  );

  releasePut();
  const response = await responsePromise;
  assert.equal(await response.text(), 'network');
}

await assertCacheWriteIsPartOfResponse('/movie/123', {
  mode: 'navigate',
  destination: 'document',
});

await assertCacheWriteIsPartOfResponse('/assets/app.js', {
  mode: 'cors',
  destination: 'script',
});

console.log('PASS service worker cache writes stay within response lifetime');


async function assertPrivateResponseIsNotCached(path, request) {
  const listeners = {};
  let putCalls = 0;

  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async addAll() {},
        async put() { putCalls += 1; },
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'private-response-test',
    ),
    {
      self,
      caches,
      fetch: async () => new Response('private', {
        status: 200,
        headers: { 'cache-control': 'private, no-store' },
      }),
      URL,
      Response,
      Promise,
    },
  );

  let responsePromise;
  listeners.fetch({
    request: {
      method: 'GET',
      url: `https://app.example${path}`,
      headers: { entries: () => [][Symbol.iterator]() },
      ...request,
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
  });

  assert(responsePromise, `${path} was not intercepted`);
  const response = await responsePromise;
  assert.equal(await response.text(), 'private');
  assert.equal(putCalls, 0, `${path} cached a private/no-store response`);
}

await assertPrivateResponseIsNotCached('/account', {
  mode: 'navigate',
  destination: 'document',
});

await assertPrivateResponseIsNotCached('/assets/private.js', {
  mode: 'cors',
  destination: 'script',
});

console.log('PASS service worker respects private response cache policy');


async function assertNonHtmlNavigationIsNotCached(contentType) {
  const listeners = {};
  let putCalls = 0;

  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async addAll() {},
        async put() { putCalls += 1; },
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'navigation-mime-test',
    ),
    {
      self,
      caches,
      fetch: async () => new Response('unexpected', {
        status: 200,
        headers: { 'content-type': contentType },
      }),
      URL,
      Response,
      Promise,
    },
  );

  let responsePromise;
  listeners.fetch({
    request: {
      method: 'GET',
      url: 'https://app.example/movie/123',
      mode: 'navigate',
      destination: 'document',
      headers: { entries: () => [][Symbol.iterator]() },
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
  });

  assert(responsePromise, 'navigation was not intercepted');
  const response = await responsePromise;
  assert.equal(await response.text(), 'unexpected');
  assert.equal(
    putCalls,
    0,
    `navigation cached unexpected ${contentType} as the app shell`,
  );
}

await assertNonHtmlNavigationIsNotCached(
  'application/json; charset=utf-8',
);
await assertNonHtmlNavigationIsNotCached(
  'text/plain; charset=utf-8',
);

console.log('PASS service worker caches only HTML navigation shells');


async function assertRedirectedSensitiveResponseIsNotCached({
  path,
  destination,
  finalUrl,
  contentType,
}) {
  const listeners = {};
  let putCalls = 0;

  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async addAll() {},
        async put() { putCalls += 1; },
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'redirect-cache-test',
    ),
    {
      self,
      caches,
      fetch: async () => {
        const response = new Response('redirected', {
          status: 200,
          headers: { 'content-type': contentType },
        });
        Object.defineProperty(response, 'url', {
          configurable: true,
          value: finalUrl,
        });
        return response;
      },
      URL,
      Response,
      Promise,
    },
  );

  let responsePromise;
  listeners.fetch({
    request: {
      method: 'GET',
      url: `https://app.example${path}`,
      mode: destination === 'document' ? 'navigate' : 'cors',
      destination,
      headers: { entries: () => [][Symbol.iterator]() },
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
  });

  assert(responsePromise, `${path} was not intercepted`);
  await responsePromise;
  assert.equal(
    putCalls,
    0,
    `${path} cached redirected response ${finalUrl}`,
  );
}

await assertRedirectedSensitiveResponseIsNotCached({
  path: '/movie/123',
  destination: 'document',
  finalUrl: 'https://app.example/auth/callback?token=LOCAL-SECRET',
  contentType: 'text/html; charset=utf-8',
});

await assertRedirectedSensitiveResponseIsNotCached({
  path: '/assets/app.js',
  destination: 'script',
  finalUrl: 'https://cdn.example/app.js',
  contentType: 'application/javascript',
});

await assertRedirectedSensitiveResponseIsNotCached({
  path: '/assets/app.js',
  destination: 'script',
  finalUrl: 'https://app.example/assets/app.js?signature=SIGNED',
  contentType: 'application/javascript',
});

await assertRedirectedSensitiveResponseIsNotCached({
  path: '/assets/poster.png',
  destination: 'image',
  finalUrl:
    'https://app.example/assets/a94f2c8e7d1b4a6c9e0f123456789abc/poster.png',
  contentType: 'image/png',
});

console.log('PASS service worker validates final response URLs before caching');


async function assertHtmlStaticFallbackIsNotCached(path, destination) {
  const listeners = {};
  let putCalls = 0;

  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async addAll() {},
        async put() { putCalls += 1; },
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'html-static-fallback-test',
    ),
    {
      self,
      caches,
      fetch: async () => new Response('<!doctype html><div id="root"></div>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
      URL,
      Response,
      Promise,
    },
  );

  let responsePromise;
  listeners.fetch({
    request: {
      method: 'GET',
      url: `https://app.example${path}`,
      mode: 'cors',
      destination,
      headers: { entries: () => [][Symbol.iterator]() },
    },
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
  });

  assert(responsePromise, `${path} was not intercepted`);
  const response = await responsePromise;
  assert.match(await response.text(), /doctype html/i);
  assert.equal(
    putCalls,
    0,
    `${path} cached an HTML SPA fallback as a ${destination}`,
  );
}

await assertHtmlStaticFallbackIsNotCached(
  '/assets/missing.js',
  'script',
);
await assertHtmlStaticFallbackIsNotCached(
  '/assets/missing.png',
  'image',
);

console.log('PASS service worker rejects HTML static-asset fallbacks');


async function assertNavigationCachesAtOwnKey(path) {
  const listeners = {};
  let putKey = null;

  const self = {
    location: { origin: 'https://app.example' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
  };
  const caches = {
    async match() { return null; },
    async open() {
      return {
        async addAll() {},
        async put(key) { putKey = key; },
      };
    },
    async keys() { return []; },
    async delete() { return true; },
  };

  vm.runInNewContext(
    readFileSync(serviceWorker, 'utf8').replace(
      '__MOVIESTV_BUILD_ID__',
      'navigation-cache-key-test',
    ),
    {
      self,
      caches,
      fetch: async () => new Response('<!doctype html><title>Updates</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
      URL,
      Response,
      Promise,
    },
  );

  const request = {
    method: 'GET',
    url: `https://app.example${path}`,
    mode: 'navigate',
    destination: 'document',
    headers: {
      entries: () => [][Symbol.iterator](),
      has: () => false,
    },
  };

  let responsePromise;
  listeners.fetch({
    request,
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    },
  });

  assert(responsePromise, `${path} was not intercepted`);
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(putKey, request, `${path} was cached under a different key`);
  assert.notEqual(putKey, '/', `${path} overwrote the root app shell`);
}

await assertNavigationCachesAtOwnKey('/updates/');
await assertNavigationCachesAtOwnKey('/movie/123');

console.log('PASS service worker keeps release navigation out of root cache');
