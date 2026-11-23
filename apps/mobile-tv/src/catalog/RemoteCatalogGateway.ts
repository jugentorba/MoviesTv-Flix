import type {
  CatalogGateway,
  CatalogPage,
  CatalogRequestOptions,
  CatalogSection,
  MediaDetails,
  SeriesSeason,
} from '@moviestv/catalog';

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export const DEFAULT_REMOTE_CATALOG_TIMEOUT_MS = 8_000;
export const DEFAULT_REMOTE_CATALOG_MAX_BYTES = 5_242_880;

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

export class RemoteCatalogGateway implements CatalogGateway {
  readonly id = 'tmdb';

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: FetchLike = (
      (input, init) => globalThis.fetch(input, init)
    ) as FetchLike,
    private readonly timeoutMs = DEFAULT_REMOTE_CATALOG_TIMEOUT_MS,
    private readonly maxBytes = DEFAULT_REMOTE_CATALOG_MAX_BYTES,
  ) {}

  getSections(
    options: CatalogRequestOptions = {},
  ): Promise<CatalogSection[]> {
    return this.post<CatalogSection[]>(
      { action: 'sections' },
      options.timeoutMs,
    );
  }

  browse(
    sectionId: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    return this.post<CatalogPage>({
      action: 'browse',
      sectionId,
      cursor,
    }, options.timeoutMs);
  }

  search(
    query: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    return this.post<CatalogPage>({
      action: 'search',
      query,
      cursor,
    }, options.timeoutMs);
  }

  getDetails(
    mediaId: string,
    options: CatalogRequestOptions = {},
  ): Promise<MediaDetails | null> {
    return this.post<MediaDetails | null>({
      action: 'details',
      mediaId,
    }, options.timeoutMs);
  }

  getSeason(
    mediaId: string,
    seasonNumber: number,
    options: CatalogRequestOptions = {},
  ): Promise<SeriesSeason | null> {
    return this.post<SeriesSeason | null>({
      action: 'season',
      mediaId,
      seasonNumber,
    }, options.timeoutMs);
  }

  private async post<T>(
    body: Record<string, unknown>,
    requestedTimeoutMs?: number,
  ): Promise<T> {
    if (
      !Number.isFinite(this.timeoutMs)
      || this.timeoutMs <= 0
      || !Number.isFinite(this.maxBytes)
      || this.maxBytes <= 0
    ) {
      throw new Error('Invalid remote catalog loading limits');
    }

    const effectiveTimeoutMs = (
      typeof requestedTimeoutMs === 'number'
      && Number.isFinite(requestedTimeoutMs)
      && requestedTimeoutMs > 0
    )
      ? Math.min(
          this.timeoutMs,
          Math.max(1, Math.trunc(requestedTimeoutMs)),
        )
      : this.timeoutMs;

    const AbortControllerImpl = (
      globalThis as typeof globalThis & {
        AbortController?: typeof AbortController;
      }
    ).AbortController;
    const controller = AbortControllerImpl
      ? new AbortControllerImpl()
      : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error('Catalog request timed out'));
      }, effectiveTimeoutMs);
    });

    try {
      const requestBody = JSON.stringify(
        Object.fromEntries(
          Object.entries(body).filter(
            ([, value]) => value !== undefined,
          ),
        ),
      );
      const response = await Promise.race([
        this.fetcher(this.baseUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: requestBody,
          ...(controller ? { signal: controller.signal } : {}),
        }),
        timeout,
      ]);

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
          throw new Error(
            'Catalog response has invalid content length',
          );
        }

        const parsed = Number(normalizedLength);
        if (!Number.isSafeInteger(parsed)) {
          throw new Error(
            'Catalog response has invalid content length',
          );
        }
        if (parsed > this.maxBytes) {
          throw new Error('Catalog response is too large');
        }
      }

      const contentType = response.headers
        .get('content-type')
        ?.toLowerCase() ?? '';
      if (contentType.includes('text/html')) {
        throw new Error('Catalog response is HTML, not JSON');
      }

      const payload = await Promise.race([
        response.text(),
        timeout,
      ]);
      if (utf8ByteLength(payload) > this.maxBytes) {
        throw new Error('Catalog response is too large');
      }

      try {
        return JSON.parse(payload) as T;
      } catch {
        throw new Error('Catalog returned invalid JSON');
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
