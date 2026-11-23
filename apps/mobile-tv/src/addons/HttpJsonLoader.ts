import {
  assertRemoteProviderUrl,
  MAX_PROVIDER_URL_LENGTH,
} from '@moviestv/addons';
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  url?: string;
  headers: { get(name: string): string | null };
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?(reason?: unknown): Promise<unknown> | unknown;
    };
  } | null;
  text(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init: {
    method: 'GET';
    redirect: 'follow';
    cache: 'no-store';
    signal?: unknown;
  },
) => Promise<HttpResponseLike>;

export const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;
export const DEFAULT_PROVIDER_MAX_BYTES = 1_048_576;
export const DEFAULT_PROVIDER_MAX_URL_LENGTH = MAX_PROVIDER_URL_LENGTH;

function safeProviderRequestUrl(
  value: string,
  label = 'Provider URL',
): URL {
  const normalized = typeof value === 'string'
    ? value.trim()
    : '';
  if (
    !normalized
    || normalized.length > DEFAULT_PROVIDER_MAX_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }

  try {
    const parsed = assertRemoteProviderUrl(normalized, 'manual');
    if (parsed.href.length > DEFAULT_PROVIDER_MAX_URL_LENGTH) {
      throw new Error('invalid');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/credentials/i.test(message)) {
      throw new Error(`${label} cannot contain credentials`);
    }
    if (/HTTPS/i.test(message)) {
      throw new Error(`${label} must use HTTPS except for loopback development`);
    }
    throw new Error(`${label} is invalid`);
  }
}

export const defaultHttpFetcher: HttpFetcher = (url, init) => {
  const runtime = globalThis as { fetch?: HttpFetcher };
  if (!runtime.fetch) return Promise.reject(new Error('Fetch is unavailable on this device'));
  return runtime.fetch(url, init);
};

export async function readBoundedResponseText(
  response: HttpResponseLike,
  maxBytes: number,
  timeout: Promise<never>,
  tooLargeMessage: string,
): Promise<string> {
  const TextDecoderImpl = (globalThis as typeof globalThis & {
    TextDecoder?: typeof TextDecoder;
  }).TextDecoder;
  const reader = response.body?.getReader?.();

  if (reader && TextDecoderImpl) {
    const decoder = new TextDecoderImpl('utf-8', { fatal: false });
    let totalBytes = 0;
    let text = '';

    try {
      while (true) {
        const result = await Promise.race([reader.read(), timeout]);
        if (result.done) break;
        const chunk = result.value;
        if (!chunk) continue;

        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel?.();
          } catch {
            // Best-effort cancellation after enforcing the hard body limit.
          }
          throw new Error(tooLargeMessage);
        }
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch (error) {
      try {
        await reader.cancel?.(error);
      } catch {
        // Preserve the original timeout/size/network failure.
      }
      throw error;
    }
  }

  const body = await Promise.race([response.text(), timeout]);
  if (utf8ByteLength(body) > maxBytes) {
    throw new Error(tooLargeMessage);
  }
  return body;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export async function fetchBoundedJson(
  fetcher: HttpFetcher,
  url: string,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  maxBytes = DEFAULT_PROVIDER_MAX_BYTES,
): Promise<unknown> {
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || !Number.isFinite(maxBytes)
    || maxBytes <= 0
  ) {
    throw new Error('Invalid provider loading limits');
  }

  const initialUrl = safeProviderRequestUrl(url);
  const AbortControllerImpl = (globalThis as {
    AbortController?: new () => { signal: unknown; abort(): void };
  }).AbortController;
  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const request = fetcher(initialUrl.href, {
    method: 'GET',
    // Provider endpoints commonly redirect to a configured/CDN endpoint. Browsers,
    // especially iOS Safari PWAs, need normal fetch redirect handling here.
    redirect: 'follow',
    // Stream endpoints often return short-lived signed URLs. Avoid the browser
    // HTTP cache so a recovery refresh can actually obtain a renewed URL.
    cache: 'no-store',
    ...(controller ? { signal: controller.signal } : {}),
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('Provider request timed out'));
    }, timeoutMs);
  });

  try {
    const response: HttpResponseLike = await Promise.race([request, timeout]);

    if (response.url) {
      let finalUrl: URL;
      try {
        finalUrl = safeProviderRequestUrl(
          response.url,
          'Provider redirect URL',
        );
      } catch {
        throw new Error('Provider redirect is not secure');
      }

      if (
        initialUrl.protocol === 'https:'
        && finalUrl.protocol !== 'https:'
      ) {
        throw new Error('Provider redirect is not secure');
      }
    }

    if (!response.ok) {
      throw new Error(
        `Provider request failed with ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength) {
      const normalizedLength = declaredLength.trim();
      if (!/^\d+$/.test(normalizedLength)) {
        throw new Error('Provider response has invalid content length');
      }
      const parsed = Number(normalizedLength);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error('Provider response has invalid content length');
      }
      if (parsed > maxBytes) {
        throw new Error('Provider response is too large');
      }
    }

    const body = await readBoundedResponseText(
      response,
      maxBytes,
      timeout,
      'Provider response is too large',
    );

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error('Provider returned invalid JSON');
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
