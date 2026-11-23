import {
  readBoundedResponseText,
  type HttpResponseLike,
} from '../addons/HttpJsonLoader';

export type CatalogHttpResponseLike = HttpResponseLike;

export type CatalogFetcher = (
  url: string,
  init: {
    method: 'GET';
    redirect: 'follow';
    cache: 'no-store';
    signal?: unknown;
  },
) => Promise<CatalogHttpResponseLike>;

export const DEFAULT_CATALOG_TIMEOUT_MS = 8_000;
export const DEFAULT_CATALOG_MAX_BYTES = 5_242_880;

export const defaultCatalogFetcher: CatalogFetcher = (
  url,
  init,
) => {
  const runtime = globalThis as {
    fetch?: CatalogFetcher;
  };
  if (!runtime.fetch) {
    return Promise.reject(
      new Error('Fetch is unavailable on this device'),
    );
  }
  return runtime.fetch(url, init);
};


function absoluteRequestUrl(
  requestUrl: string,
  responseUrl: string,
): URL | null {
  try {
    return new URL(requestUrl);
  } catch {
    const origin = (
      globalThis as typeof globalThis & {
        location?: { origin?: string };
      }
    ).location?.origin;
    try {
      return new URL(requestUrl, origin || new URL(responseUrl).origin);
    } catch {
      return null;
    }
  }
}

export async function fetchBoundedCatalogJson(
  fetcher: CatalogFetcher,
  url: string,
  timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS,
  maxBytes = DEFAULT_CATALOG_MAX_BYTES,
): Promise<unknown> {
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || !Number.isFinite(maxBytes)
    || maxBytes <= 0
  ) {
    throw new Error('Invalid catalog loading limits');
  }

  const AbortControllerImpl = (globalThis as {
    AbortController?: new () => {
      signal: unknown;
      abort(): void;
    };
  }).AbortController;
  const controller = AbortControllerImpl
    ? new AbortControllerImpl()
    : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('Catalog request timed out'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetcher(url, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      }),
      timeout,
    ]);

    if (response.url) {
      let finalUrl: URL;
      try {
        finalUrl = new URL(response.url);
      } catch {
        throw new Error('Catalog redirect URL is invalid');
      }
      const initialUrl = absoluteRequestUrl(url, response.url);
      if (
        !initialUrl
        || (finalUrl.protocol !== 'https:'
          && finalUrl.protocol !== 'http:')
        || finalUrl.username
        || finalUrl.password
        || (
          initialUrl.protocol === 'https:'
          && finalUrl.protocol !== 'https:'
        )
      ) {
        throw new Error('Catalog redirect is not secure');
      }
    }

    if (!response.ok) {
      throw new Error(
        `Catalog request failed (${response.status}${response.statusText
          ? ` ${response.statusText}`
          : ''})`,
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength) {
      const normalizedLength = declaredLength.trim();
      if (!/^\d+$/.test(normalizedLength)) {
        throw new Error('Catalog response has invalid content length');
      }
      const parsed = Number(normalizedLength);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error('Catalog response has invalid content length');
      }
      if (parsed > maxBytes) {
        throw new Error('Catalog response is too large');
      }
    }

    const contentType = response.headers
      .get('content-type')
      ?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) {
      throw new Error('Catalog response is HTML, not JSON');
    }

    const body = await readBoundedResponseText(
      response,
      maxBytes,
      timeout,
      'Catalog response is too large',
    );

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error('Catalog returned invalid JSON');
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
