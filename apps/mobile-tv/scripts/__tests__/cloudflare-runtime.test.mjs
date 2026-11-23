import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const workerSourcePath = join(repoRoot, 'worker', 'index.js');
const pagesSourcePath = join(repoRoot, 'functions', 'api', '[[path]].js');

const work = mkdtempSync(join(tmpdir(), 'moviestv-cloudflare-'));

function freshUrl(path) {
  return `${pathToFileURL(path).href}?v=${Date.now()}-${Math.random()}`;
}

async function loadModules() {
  const workerModulePath = join(work, 'worker.mjs');
  writeFileSync(workerModulePath, readFileSync(workerSourcePath, 'utf8'));

  const workerUrl = freshUrl(workerModulePath);
  const workerModule = await import(workerUrl);
  const worker = workerModule.default;

  const pagesModulePath = join(work, 'pages.mjs');
  const pagesSource = readFileSync(pagesSourcePath, 'utf8')
    .replace(
      "import worker from '../../worker/index.js';",
      `import worker from ${JSON.stringify(workerUrl)};`,
    );
  writeFileSync(pagesModulePath, pagesSource);
  const pages = await import(freshUrl(pagesModulePath));

  return {
    worker,
    pages,
    readBoundedCatalogBody: workerModule.readBoundedCatalogBody,
  };
}

async function json(response) {
  return JSON.parse(await response.text());
}

async function run() {
  const { worker, pages, readBoundedCatalogBody } = await loadModules();
  assert.equal(
    typeof readBoundedCatalogBody,
    'function',
    'worker must expose its bounded catalog body reader for regression tests',
  );

  const publicEnv = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co/',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture12345678',
  };

  const config = await worker.fetch(
    new Request('https://app.example/api/runtime-config'),
    publicEnv,
  );
  assert.equal(config.status, 200);
  assert.deepEqual(await json(config), {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_fixture12345678',
  });
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal(
    config.headers.get('content-type'),
    'application/json; charset=utf-8',
  );
  assert.equal(config.headers.get('x-content-type-options'), 'nosniff');

  const invalidPublicKey = await worker.fetch(
    new Request('https://app.example/api/runtime-config'),
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
    },
  );
  assert.deepEqual(await json(invalidPublicKey), {});

  const secret = await worker.fetch(
    new Request('https://app.example/api/runtime-config'),
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_expose',
    },
  );
  assert.deepEqual(await json(secret), {});

  const encodeJwtPart = (value) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  const serviceRoleJwt = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({ role: 'service_role' }),
    'signature',
  ].join('.');
  const serviceRole = await worker.fetch(
    new Request('https://app.example/api/runtime-config'),
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
    },
  );
  assert.deepEqual(await json(serviceRole), {});

  const privilegedRoleJwt = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({ role: 'supabase_admin' }),
    'signature',
  ].join('.');
  const privilegedRole = await worker.fetch(
    new Request('https://app.example/api/runtime-config'),
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: privilegedRoleJwt,
    },
  );
  assert.deepEqual(await json(privilegedRole), {});

  const anonRoleJwt = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({ role: 'anon' }),
    'signature',
  ].join('.');
  const anonRole = await worker.fetch(
    new Request('https://app.example/api/runtime-config'),
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonRoleJwt,
    },
  );
  assert.deepEqual(await json(anonRole), {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: anonRoleJwt,
  });

  for (const env of [
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_URL:
        `https://example.supabase.co/${'x'.repeat(2_100)}`,
    },
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'x'.repeat(8_193),
    },
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_URL:
        'https://example.supabase.co/\u0000bad',
    },
    {
      ...publicEnv,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        'public\u0000bad',
    },
  ]) {
    const unsafe = await worker.fetch(
      new Request('https://app.example/api/runtime-config'),
      env,
    );
    assert.deepEqual(await json(unsafe), {});
  }

  const post = await worker.fetch(
    new Request('https://app.example/api/runtime-config', { method: 'POST' }),
    publicEnv,
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('cache-control'), 'no-store');
  assert.equal(post.headers.get('x-content-type-options'), 'nosniff');

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ metas: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: '"catalog-v1"',
      },
    });
  };

  try {
    const catalog = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/top.json?genre=Drama',
      ),
      {},
    );
    assert.equal(catalog.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'https://v3-cinemeta.strem.io/catalog/movie/top.json?genre=Drama',
    );
    assert.equal(requests[0].init?.headers?.accept, 'application/json');
    assert.equal(requests[0].init?.redirect, 'manual');
    assert.ok(
      requests[0].init?.signal,
      'catalog upstream requests must carry an abort signal',
    );
    assert.equal(catalog.headers.get('cache-control'), 'no-store');
    assert.equal(catalog.headers.get('x-content-type-options'), 'nosniff');

    const publicCatalog = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/top.json',
      ),
      {},
    );
    assert.equal(publicCatalog.status, 200);
    assert.equal(publicCatalog.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(
      publicCatalog.headers.get('x-content-type-options'),
      'nosniff',
    );
    assert.equal(requests.length, 2);

    const blocked = await worker.fetch(
      new Request('https://app.example/api/cinemeta/stream/movie/tt123.json'),
      {},
    );
    assert.equal(blocked.status, 404);
    assert.equal(requests.length, 2);

    const configuredNuvio = await worker.fetch(
      new Request(
        'https://app.example/api/nuvio-catalog/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D/catalog/movie/trending-movies.json',
      ),
      {},
    );
    assert.equal(configuredNuvio.status, 200);
    assert.equal(configuredNuvio.headers.get('cache-control'), 'no-store');
    assert.equal(requests.length, 3);
    assert.equal(
      requests[2].url,
      'https://catalog.nuvio.tv/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D/catalog/movie/trending-movies.json',
    );

    // Nuvio search pagination path extras must survive the PWA proxy
    // verbatim because Stremio encodes search/skip inside the catalog path.
    const pagedNuvioSearch = await worker.fetch(
      new Request(
        'https://app.example/api/nuvio-catalog/catalog/movie/popular-movies/search=Dune%20Part%20Two&skip=20.json',
      ),
      {},
    );
    assert.equal(pagedNuvioSearch.status, 200);
    assert.equal(requests.length, 4);
    assert.equal(
      requests[3].url,
      'https://catalog.nuvio.tv/catalog/movie/popular-movies/search=Dune%20Part%20Two&skip=20.json',
    );

    // Nuvio genre pagination path extras must survive the configured
    // proxy prefix exactly, including encoded spaces in genre values.
    const pagedNuvioGenre = await worker.fetch(
      new Request(
        'https://app.example/api/nuvio-catalog/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D/catalog/movie/trending-movies/genre=Science%20Fiction&skip=20.json',
      ),
      {},
    );
    assert.equal(pagedNuvioGenre.status, 200);
    assert.equal(requests.length, 5);
    assert.equal(
      requests[4].url,
      'https://catalog.nuvio.tv/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D/catalog/movie/trending-movies/genre=Science%20Fiction&skip=20.json',
    );

    const blockedNuvioStream = await worker.fetch(
      new Request(
        'https://app.example/api/nuvio-catalog/%7B%22language%22%3A%22fr-FR%22%7D/stream/movie/tt123.json',
      ),
      {},
    );
    assert.equal(blockedNuvioStream.status, 404);
    assert.equal(requests.length, 5);

    for (const unsafePath of [
      '/api/nuvio-catalog/not-json/catalog/movie/trending-movies.json',
      '/api/nuvio-catalog/%7B%22token%22%3A%22secret%22%7D/catalog/movie/trending-movies.json',
      '/api/nuvio-catalog/%7B%22language%22%3A%22token%3Dsecret%22%7D/catalog/movie/trending-movies.json',
      '/api/nuvio-catalog/%7B%22region%22%3A%22FRANCE%22%7D/catalog/movie/trending-movies.json',
      '/api/nuvio-catalog/%5B%22fr-FR%22%5D/catalog/movie/trending-movies.json',
      '/api/nuvio-catalog/%7B%22language%22%3A%22fr-FR%22%7D/extra/catalog/movie/trending-movies.json',
    ]) {
      const unsafeConfiguredNuvio = await worker.fetch(
        new Request(`https://app.example${unsafePath}`),
        {},
      );
      assert.equal(unsafeConfiguredNuvio.status, 404);
      assert.equal(
        requests.length,
        5,
        `unsafe Nuvio config reached the upstream: ${unsafePath}`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'temporary failure' }),
    {
      status: 503,
      headers: { 'content-type': 'application/json' },
    },
  );

  try {
    const failedCatalog = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/failing.json',
      ),
      {},
    );
    assert.equal(failedCatalog.status, 503);
    assert.equal(failedCatalog.headers.get('cache-control'), 'no-store');
    assert.equal(
      failedCatalog.headers.get('x-content-type-options'),
      'nosniff',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  await assert.rejects(
    () => readBoundedCatalogBody(
      new Response('{}', {
        headers: { 'content-length': '1e3' },
      }),
      1024,
      new Promise(() => {}),
    ),
    /invalid content length/,
  );

  await assert.rejects(
    () => readBoundedCatalogBody(
      new Response(new Uint8Array(11)),
      10,
      new Promise(() => {}),
    ),
    /too large/,
  );

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start() {
        // Headers arrive, but the body never produces a chunk or closes.
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
  globalThis.setTimeout = (handler, delay, ...args) => (
    originalSetTimeout(handler, delay === 8_000 ? 1 : delay, ...args)
  );

  try {
    const stalledBody = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/stalled.json',
      ),
      {},
    );
    assert.equal(stalledBody.status, 502);
    assert.deepEqual(await json(stalledBody), {
      error: 'Catalog upstream unavailable',
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
  }

  let oversizedCatalogFetches = 0;
  globalThis.fetch = async () => {
    oversizedCatalogFetches += 1;
    return new Response(JSON.stringify({ metas: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const oversizedQuery = await worker.fetch(
      new Request(
        `https://app.example/api/cinemeta/catalog/movie/top.json?genre=${'A'.repeat(5000)}`,
      ),
      {},
    );
    assert.equal(oversizedQuery.status, 414);

    const oversizedPath = await worker.fetch(
      new Request(
        `https://app.example/api/cinemeta/catalog/movie/${'x'.repeat(5000)}.json`,
      ),
      {},
    );
    assert.equal(oversizedPath.status, 414);
    assert.equal(oversizedCatalogFetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const redirectRequests = [];
  globalThis.fetch = async (input, init) => {
    const requestUrl = String(input);
    redirectRequests.push({ url: requestUrl, init });
    if (requestUrl.endsWith('/catalog/movie/top.json')) {
      return new Response(null, {
        status: 302,
        headers: {
          location: '/catalog/movie/redirected.json',
        },
      });
    }
    return new Response(JSON.stringify({ metas: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const redirected = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/top.json',
      ),
      {},
    );
    assert.equal(redirected.status, 200);
    assert.deepEqual(
      redirectRequests.map((entry) => entry.url),
      [
        'https://v3-cinemeta.strem.io/catalog/movie/top.json',
        'https://v3-cinemeta.strem.io/catalog/movie/redirected.json',
      ],
    );
    assert.ok(
      redirectRequests.every(
        (entry) => entry.init?.redirect === 'manual',
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const location of [
    'https://evil.example/catalog/movie/top.json',
    'http://v3-cinemeta.strem.io/catalog/movie/top.json',
    'https://user:pass@v3-cinemeta.strem.io/catalog/movie/top.json',
  ]) {
    let redirectFetches = 0;
    globalThis.fetch = async () => {
      redirectFetches += 1;
      return new Response(null, {
        status: 302,
        headers: { location },
      });
    };

    try {
      const blockedRedirect = await worker.fetch(
        new Request(
          'https://app.example/api/cinemeta/catalog/movie/top.json',
        ),
        {},
      );
      assert.equal(blockedRedirect.status, 502);
      assert.equal(redirectFetches, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  let routeEscapeFetches = 0;
  globalThis.fetch = async () => {
    routeEscapeFetches += 1;
    return new Response(null, {
      status: 302,
      headers: {
        location: '/stream/movie/tt123.json',
      },
    });
  };
  try {
    const escapedRoute = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/top.json',
      ),
      {},
    );
    assert.equal(escapedRoute.status, 502);
    assert.equal(routeEscapeFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let loopFetches = 0;
  globalThis.fetch = async () => {
    loopFetches += 1;
    return new Response(null, {
      status: 302,
      headers: {
        location: '/catalog/movie/top.json',
      },
    });
  };
  try {
    const redirectLoop = await worker.fetch(
      new Request(
        'https://app.example/api/cinemeta/catalog/movie/top.json',
      ),
      {},
    );
    assert.equal(redirectLoop.status, 502);
    assert.equal(loopFetches, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let workerAssetFetches = 0;
  const workerBlocked = await worker.fetch(
    new Request('https://app.example/api/not-a-real-endpoint'),
    {
      ASSETS: {
        fetch: async () => {
          workerAssetFetches += 1;
          return new Response('<html>spa</html>', { status: 200 });
        },
      },
    },
  );
  assert.equal(workerBlocked.status, 404);
  assert.equal(workerBlocked.headers.get('cache-control'), 'no-store');
  assert.equal(workerBlocked.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(workerAssetFetches, 0);
  assert.deepEqual(await json(workerBlocked), { error: 'Not found' });

  const pagesConfig = await pages.onRequest({
    request: new Request('https://app.example/api/runtime-config'),
    env: publicEnv,
  });
  assert.equal(pagesConfig.status, 200);
  assert.equal(pagesConfig.headers.get('cache-control'), 'no-store');
  assert.equal(pagesConfig.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await json(pagesConfig), {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_fixture12345678',
  });

  const pagesBlocked = await pages.onRequest({
    request: new Request('https://app.example/api/other'),
    env: publicEnv,
  });
  assert.equal(pagesBlocked.status, 404);

  console.log('PASS Cloudflare Worker and Pages API runtime smoke tests');
}

try {
  await run();
} finally {
  rmSync(work, { recursive: true, force: true });
}
