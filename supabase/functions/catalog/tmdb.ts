const TMDB_API_BASE = 'https://api.themoviedb.org/3';

export const DEFAULT_TMDB_TIMEOUT_MS = 8_000;
export const DEFAULT_TMDB_MAX_BYTES = 5_242_880;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class TmdbUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TmdbUpstreamError';
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800
      && code <= 0xdbff
      && index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export async function fetchTmdbJson(
  path: string,
  token: string,
  query: Record<string, string | number | boolean | undefined> = {},
  fetcher: FetchLike = fetch,
  timeoutMs = DEFAULT_TMDB_TIMEOUT_MS,
  maxBytes = DEFAULT_TMDB_MAX_BYTES,
): Promise<unknown> {
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || !Number.isFinite(maxBytes)
    || maxBytes <= 0
  ) {
    throw new Error('Invalid TMDB loading limits');
  }

  const url = new URL(`${TMDB_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TmdbUpstreamError(
        'TMDB request timed out',
        504,
        true,
      ));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetcher(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }),
      timeout,
    ]);

    if (!response.ok) {
      throw new TmdbUpstreamError(
        `TMDB request failed (${response.status})`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength) {
      const normalizedLength = declaredLength.trim();
      if (!/^\d+$/.test(normalizedLength)) {
        throw new TmdbUpstreamError(
          'TMDB response has invalid content length',
          502,
          false,
        );
      }

      const parsedLength = Number(normalizedLength);
      if (!Number.isSafeInteger(parsedLength)) {
        throw new TmdbUpstreamError(
          'TMDB response has invalid content length',
          502,
          false,
        );
      }
      if (parsedLength > maxBytes) {
        throw new TmdbUpstreamError(
          'TMDB response is too large',
          502,
          false,
        );
      }
    }

    const contentType = response.headers
      .get('content-type')
      ?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) {
      throw new TmdbUpstreamError(
        'TMDB response is HTML, not JSON',
        502,
        true,
      );
    }

    const body = await Promise.race([
      response.text(),
      timeout,
    ]);
    if (utf8ByteLength(body) > maxBytes) {
      throw new TmdbUpstreamError(
        'TMDB response is too large',
        502,
        false,
      );
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new TmdbUpstreamError(
        'TMDB returned invalid JSON',
        502,
        true,
      );
    }
  } catch (error) {
    if (error instanceof TmdbUpstreamError) throw error;
    if (controller.signal.aborted) {
      throw new TmdbUpstreamError('TMDB request timed out', 504, true);
    }
    throw new TmdbUpstreamError('TMDB request failed', 502, true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
