const PROXIES = [
  {
    prefix: '/api/cinemeta',
    origin: 'https://v3-cinemeta.strem.io',
  },
  {
    prefix: '/api/nuvio-catalog',
    origin: 'https://catalog.nuvio.tv',
    allowConfigPrefix: true,
  },
];

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}


const MAX_PUBLIC_SUPABASE_URL_LENGTH = 2_048;
const MAX_PUBLIC_SUPABASE_KEY_LENGTH = 8_192;

function publicSupabaseConfig(env) {
  const rawUrl = typeof env.EXPO_PUBLIC_SUPABASE_URL === 'string'
    ? env.EXPO_PUBLIC_SUPABASE_URL.trim()
    : '';
  const publishableKey = typeof env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY === 'string'
    ? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim()
    : '';

  if (
    !rawUrl
    || rawUrl.length > MAX_PUBLIC_SUPABASE_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(rawUrl)
    || !publishableKey
    || publishableKey.length > MAX_PUBLIC_SUPABASE_KEY_LENGTH
    || /[\u0000-\u001f\u007f]/.test(publishableKey)
  ) {
    return {};
  }

  let url = '';
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
    ) {
      url = parsed.href.replace(/\/$/, '');
    }
  } catch {
    url = '';
  }

  let privileged = /^sb_secret_/i.test(publishableKey)
    || /service[-_]?role/i.test(publishableKey);
  let publicKey =
    /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(publishableKey);

  if (!privileged && publishableKey.split('.').length === 3) {
    try {
      const segment = publishableKey.split('.')[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const padded = segment.padEnd(
        Math.ceil(segment.length / 4) * 4,
        '=',
      );
      const payload = JSON.parse(atob(padded));
      privileged = payload?.role !== 'anon';
      publicKey = payload?.role === 'anon';
    } catch {
      privileged = true;
      publicKey = false;
    }
  }

  return url && publishableKey && publicKey && !privileged
    ? { supabaseUrl: url, supabasePublishableKey: publishableKey }
    : {};
}

function runtimeConfigResponse(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError('Method not allowed', 405);
  }

  const body = JSON.stringify(publicSupabaseConfig(env));

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function isCatalogRoute(pathname) {
  return pathname === '/manifest.json'
    || pathname.startsWith('/catalog/')
    || pathname.startsWith('/meta/');
}

function validNuvioConfigSegment(segment) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }

  let config;
  try {
    config = JSON.parse(decoded);
  } catch {
    return false;
  }

  if (
    typeof config !== 'object'
    || config === null
    || Array.isArray(config)
  ) return false;

  const entries = Object.entries(config);
  if (!entries.length || entries.length > 2) return false;

  const allowedKeys = new Set(['language', 'region']);
  return entries.every(([key, value]) => {
    if (!allowedKeys.has(key) || typeof value !== 'string') return false;
    const normalized = value.trim();
    if (
      !normalized
      || normalized.length > 64
      || /[\u0000-\u001f\u007f]/.test(normalized)
    ) return false;

    return key === 'language'
      ? /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized)
      : /^(?:[A-Za-z]{2}|[0-9]{3})$/.test(normalized);
  });
}

function allowedCatalogPath(pathname, allowConfigPrefix = false) {
  if (isCatalogRoute(pathname)) return true;
  if (!allowConfigPrefix) return false;

  const configured = pathname.match(/^\/([^/]+)(\/.*)$/);
  return Boolean(
    configured?.[1]
    && configured?.[2]
    && validNuvioConfigSegment(configured[1])
    && isCatalogRoute(configured[2]),
  );
}

const CATALOG_REDIRECT_STATUSES = new Set([
  301,
  302,
  303,
  307,
  308,
]);
const MAX_CATALOG_REDIRECTS = 3;
const MAX_CATALOG_PATH_CHARS = 4096;
const MAX_CATALOG_QUERY_CHARS = 4096;
const MAX_CATALOG_UPSTREAM_MS = 8_000;
const MAX_CATALOG_UPSTREAM_BYTES = 5_242_880;

async function fetchCatalogUpstream(
  initialUrl,
  init,
  allowedOrigin,
  allowConfigPrefix = false,
  signal,
) {
  let current = new URL(initialUrl);

  for (let hop = 0; hop <= MAX_CATALOG_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      ...(signal ? { signal } : {}),
    });

    if (!CATALOG_REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    if (hop >= MAX_CATALOG_REDIRECTS) {
      throw new Error('Catalog upstream redirected too many times');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Catalog upstream redirect is missing Location');
    }

    const next = new URL(location, current);
    if (
      next.protocol !== 'https:'
      || next.username
      || next.password
      || next.origin !== allowedOrigin
      || !allowedCatalogPath(next.pathname, allowConfigPrefix)
    ) {
      throw new Error('Catalog upstream redirect is not allowed');
    }

    current = next;
  }

  throw new Error('Catalog upstream redirect failed');
}

export async function readBoundedCatalogBody(
  response,
  maxBytes = MAX_CATALOG_UPSTREAM_BYTES,
  timeout,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid catalog response size limit');
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      throw new Error('Catalog upstream has invalid content length');
    }
    const parsedLength = Number(normalizedLength);
    if (!Number.isSafeInteger(parsedLength)) {
      throw new Error('Catalog upstream has invalid content length');
    }
    if (parsedLength > maxBytes) {
      throw new Error('Catalog upstream response is too large');
    }
  }

  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const read = reader.read();
      const result = timeout
        ? await Promise.race([read, timeout])
        : await read;
      if (result.done) break;
      if (!result.value) continue;

      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation failures after enforcing the size limit.
        }
        throw new Error('Catalog upstream response is too large');
      }
      chunks.push(result.value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation failures while surfacing the original error.
    }
    throw error;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function proxyCatalog(request, url, proxy) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError('Method not allowed', 405);
  }

  const upstreamPath = url.pathname.slice(proxy.prefix.length) || '/';
  if (
    upstreamPath.length > MAX_CATALOG_PATH_CHARS
    || url.search.length > MAX_CATALOG_QUERY_CHARS
  ) {
    return jsonError('URI too long', 414);
  }
  if (!allowedCatalogPath(upstreamPath, proxy.allowConfigPrefix)) {
    return jsonError('Not found', 404);
  }

  const upstream = new URL(upstreamPath + url.search, proxy.origin);
  const personalizedRequest = Boolean(url.search)
    || (
      proxy.allowConfigPrefix
      && !isCatalogRoute(upstreamPath)
    );
  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  let timeoutId = null;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error('Catalog upstream timed out'));
    }, MAX_CATALOG_UPSTREAM_MS);
  });

  try {
    const upstreamResponse = await Promise.race([
      fetchCatalogUpstream(
        upstream,
        {
          method: request.method,
          headers: { accept: 'application/json' },
        },
        new URL(proxy.origin).origin,
        Boolean(proxy.allowConfigPrefix),
        controller?.signal,
      ),
      timeout,
    ]);

    const headers = new Headers();
    const contentType = upstreamResponse.headers.get('content-type');
    const cacheControl = upstreamResponse.headers.get('cache-control');
    const etag = upstreamResponse.headers.get('etag');
    if (contentType) headers.set('content-type', contentType);
    if (personalizedRequest || !upstreamResponse.ok) {
      headers.set('cache-control', 'no-store');
    } else if (cacheControl) {
      headers.set('cache-control', cacheControl);
    } else {
      headers.set('cache-control', 'public, max-age=300');
    }
    if (etag) headers.set('etag', etag);
    headers.set('x-content-type-options', 'nosniff');

    if (contentType?.toLowerCase().includes('text/html')) {
      throw new Error('Catalog upstream returned HTML');
    }

    const body = request.method === 'HEAD'
      ? null
      : await readBoundedCatalogBody(
        upstreamResponse,
        MAX_CATALOG_UPSTREAM_BYTES,
        timeout,
      );

    return new Response(body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }

}


const UPDATE_RELEASE_REPOSITORY = 'jugentorba/MoviesTv-Flix';
const UPDATE_RELEASE_TAG = 'preview-latest';
const UPDATE_ASSETS = {
  manifest: 'MoviesTv-Flix-update-manifest.json',
  android: 'MoviesTv-Flix-phone-preview.apk',
  'android-tv': 'MoviesTv-Flix-android-tv-preview.apk',
  ios: 'MoviesTv-Flix-ios-resignable-preview.ipa',
  tvos: 'MoviesTv-Flix-tvos-resignable-preview.ipa',
};

function githubReleaseToken(env) {
  const value = typeof env.GITHUB_RELEASE_TOKEN === 'string'
    ? env.GITHUB_RELEASE_TOKEN.trim()
    : '';
  return value
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : '';
}

function githubReleaseHeaders(token, accept) {
  return {
    accept,
    authorization: `Bearer ${token}`,
    'user-agent': 'MoviesTv-Flix-Updater',
    'x-github-api-version': '2022-11-28',
  };
}

async function githubPreviewRelease(env) {
  const token = githubReleaseToken(env);
  if (!token) return null;

  const response = await fetch(
    `https://api.github.com/repos/${UPDATE_RELEASE_REPOSITORY}/releases/tags/${UPDATE_RELEASE_TAG}`,
    {
      headers: githubReleaseHeaders(
        token,
        'application/vnd.github+json',
      ),
    },
  );
  if (!response.ok) {
    throw new Error('GitHub preview release is unavailable');
  }
  const release = await response.json();
  return {
    token,
    assets: Array.isArray(release?.assets) ? release.assets : [],
  };
}

function updateContentType(platform) {
  if (platform === 'manifest') return 'application/json; charset=utf-8';
  if (platform === 'android' || platform === 'android-tv') {
    return 'application/vnd.android.package-archive';
  }
  return 'application/octet-stream';
}

async function staticUpdateManifest(request, env) {
  const url = new URL('/updates/latest.json', request.url);
  const staticRequest = new Request(url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: { accept: 'application/json' },
  });
  if (env.ASSETS?.fetch) return env.ASSETS.fetch(staticRequest);
  return fetch(staticRequest);
}

async function releaseUpdateAsset(request, env, platform) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError('Method not allowed', 405);
  }
  const assetName = UPDATE_ASSETS[platform];
  if (!assetName) return jsonError('Not found', 404);

  let release;
  try {
    release = await githubPreviewRelease(env);
  } catch {
    release = null;
  }

  if (!release) {
    if (platform === 'manifest') {
      return staticUpdateManifest(request, env);
    }
    return jsonError('Update package is not published yet', 503);
  }

  const asset = release.assets.find(
    (candidate) => candidate?.name === assetName
      && typeof candidate?.url === 'string',
  );
  if (!asset) {
    if (platform === 'manifest') {
      return staticUpdateManifest(request, env);
    }
    return jsonError('Update package is not published yet', 404);
  }

  const upstream = await fetch(asset.url, {
    method: 'GET',
    redirect: 'follow',
    headers: githubReleaseHeaders(
      release.token,
      'application/octet-stream',
    ),
  });
  if (!upstream.ok) {
    if (platform === 'manifest') {
      return staticUpdateManifest(request, env);
    }
    return jsonError('Update package is unavailable', 502);
  }

  const headers = new Headers();
  headers.set('content-type', updateContentType(platform));
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('content-length', contentLength);
  if (platform !== 'manifest') {
    headers.set(
      'content-disposition',
      `attachment; filename="${assetName.replace(/"/g, '')}"`,
    );
  }

  return new Response(
    request.method === 'HEAD' ? null : upstream.body,
    {
      status: 200,
      headers,
    },
  );
}

function updatePlatformFromPath(pathname) {
  if (pathname === '/api/app-update/manifest') return 'manifest';
  if (pathname === '/api/app-update/android.apk') return 'android';
  if (pathname === '/api/app-update/android-tv.apk') return 'android-tv';
  if (pathname === '/api/app-update/ios.ipa') return 'ios';
  if (pathname === '/api/app-update/tvos.ipa') return 'tvos';
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/runtime-config') {
      return runtimeConfigResponse(request, env);
    }

    const updatePlatform = updatePlatformFromPath(url.pathname);
    if (updatePlatform) {
      return releaseUpdateAsset(request, env, updatePlatform);
    }

    const proxy = PROXIES.find(
      (candidate) => url.pathname === candidate.prefix || url.pathname.startsWith(candidate.prefix + '/'),
    );

    if (proxy) {
      try {
        return await proxyCatalog(request, url, proxy);
      } catch {
        return jsonError('Catalog upstream unavailable', 502);
      }
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return jsonError('Not found', 404);
    }

    return env.ASSETS.fetch(request);
  },
};
