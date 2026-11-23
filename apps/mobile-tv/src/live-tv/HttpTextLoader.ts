import {
  defaultHttpFetcher,
  readBoundedResponseText,
  type HttpFetcher,
  type HttpResponseLike,
} from '../addons/HttpJsonLoader';

export const DEFAULT_GUIDE_TIMEOUT_MS = 10_000;
export const DEFAULT_GUIDE_MAX_BYTES = 5_242_880;
export const DEFAULT_GUIDE_MAX_URL_LENGTH = 4_096;


export interface BoundedTextOptions {
  /**
   * Accept `http:` in addition to `https:`. Default `false`.
   *
   * Only M3U playlists set this: most IPTV providers publish their playlist
   * over cleartext HTTP, and the app already ships an intentional cleartext
   * media exception for IPTV (`plugins/withNativeHttpMedia.js`). The body is
   * still size-capped and URL-credential-free.
   */
  allowHttp?: boolean;
  /** Noun used in error messages. Defaults to `Guide`. */
  label?: string;
}

export async function fetchBoundedText(
  fetcher: HttpFetcher = defaultHttpFetcher,
  url: string,
  timeoutMs = DEFAULT_GUIDE_TIMEOUT_MS,
  maxBytes = DEFAULT_GUIDE_MAX_BYTES,
  options: BoundedTextOptions = {},
): Promise<string> {
  const label = options.label?.trim() || 'Guide';
  const allowHttp = options.allowHttp === true;
  const secureProtocols = allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error(`Invalid ${label.toLowerCase()} loading limits`);
  }

  let parsedUrl: URL;
  try {
    const normalizedUrl = url.trim();
    if (
      !normalizedUrl
      || normalizedUrl.length > DEFAULT_GUIDE_MAX_URL_LENGTH
    ) {
      throw new Error('invalid');
    }
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }
  if (
    !secureProtocols.includes(parsedUrl.protocol)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.href.length > DEFAULT_GUIDE_MAX_URL_LENGTH
  ) {
    throw new Error(
      allowHttp
        ? `${label} URL must be HTTP or HTTPS without embedded credentials`
        : `${label} URL must be HTTPS without embedded credentials`,
    );
  }

  const AbortControllerImpl = (globalThis as {
    AbortController?: new () => { signal: unknown; abort(): void };
  }).AbortController;
  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`${label} request timed out`));
    }, timeoutMs);
  });

  try {
    const request = fetcher(parsedUrl.href, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    const response: HttpResponseLike = await Promise.race([request, timeout]);

    if (response.url) {
      let finalUrl: URL;
      try {
        if (response.url.length > DEFAULT_GUIDE_MAX_URL_LENGTH) {
          throw new Error('invalid');
        }
        finalUrl = new URL(response.url);
      } catch {
        throw new Error(`${label} redirect URL is invalid`);
      }
      if (
        !secureProtocols.includes(finalUrl.protocol)
        || finalUrl.username
        || finalUrl.password
        || finalUrl.href.length > DEFAULT_GUIDE_MAX_URL_LENGTH
      ) {
        throw new Error(
          allowHttp
            ? `${label} redirect must remain HTTP or HTTPS`
            : `${label} redirect must remain secure HTTPS`,
        );
      }
    }

    if (!response.ok) {
      throw new Error(
        `${label} request failed with ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength) {
      const normalizedLength = declaredLength.trim();
      if (!/^\d+$/.test(normalizedLength)) {
        throw new Error(`${label} response has invalid content length`);
      }
      const parsed = Number(normalizedLength);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error(`${label} response has invalid content length`);
      }
      if (parsed > maxBytes) {
        throw new Error(`${label} feed is too large`);
      }
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) throw new Error(`${label} response is HTML`);

    const body = await readBoundedResponseText(
      response,
      maxBytes,
      timeout,
      `${label} feed is too large`,
    );
    if (!body.trim()) throw new Error(`${label} feed is empty`);
    return body;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
