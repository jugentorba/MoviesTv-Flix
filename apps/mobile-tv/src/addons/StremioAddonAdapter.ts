import {
  normalizeStreamCandidates,
  toStremioStreamRequests,
  type AddonAdapter,
  type AddonDescriptor,
  type AddonMediaRequest,
  type AddonResolveOptions,
} from '@moviestv/addons';
import type { StreamSource } from '@moviestv/core';
import {
  DEFAULT_PROVIDER_MAX_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  defaultHttpFetcher,
  fetchBoundedJson,
  type HttpFetcher,
} from './HttpJsonLoader';

function providerRequestUrl(manifestUrl: string, requestPath: string): string {
  const manifest = new URL(manifestUrl);
  const hostname = manifest.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const loopbackHttp = manifest.protocol === 'http:'
    && ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (
    (manifest.protocol !== 'https:' && !loopbackHttp)
    || manifest.username
    || manifest.password
  ) {
    throw new Error('Provider manifest URL must be secure HTTPS');
  }
  manifest.hash = '';
  if (!manifest.pathname.endsWith('/manifest.json')) {
    throw new Error('Provider manifest URL is invalid');
  }
  const hasTraversalSegment = requestPath
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
  if (
    !requestPath.startsWith('/')
    || requestPath.includes('\\')
    || hasTraversalSegment
  ) {
    throw new Error('Provider request path is invalid');
  }
  const basePath = manifest.pathname.slice(0, -'/manifest.json'.length);
  return `${manifest.origin}${basePath}${requestPath}${manifest.search}`;
}

export class StremioAddonAdapter implements AddonAdapter {
  constructor(
    private readonly addonDescriptor: AddonDescriptor,
    private readonly fetcher: HttpFetcher = defaultHttpFetcher,
    private readonly timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    private readonly maxBytes = DEFAULT_PROVIDER_MAX_BYTES,
  ) {
    if (!addonDescriptor.manifestUrl) {
      throw new Error('Stremio provider is missing a manifest URL');
    }
  }

  descriptor(): AddonDescriptor {
    return this.addonDescriptor;
  }

  async resolve(
    request: AddonMediaRequest,
    options: AddonResolveOptions = {},
  ): Promise<StreamSource[]> {
    const protocolRequests = toStremioStreamRequests(
      this.addonDescriptor,
      request,
    );
    if (!protocolRequests.length) return [];

    const manifestUrl = this.addonDescriptor.manifestUrl;
    if (!manifestUrl) return [];

    const requestedTimeoutMs = (
      typeof options.timeoutMs === 'number'
      && Number.isFinite(options.timeoutMs)
      && options.timeoutMs > 0
    )
      ? Math.max(1, Math.trunc(options.timeoutMs))
      : this.timeoutMs;
    const effectiveTimeoutMs = Math.min(
      this.timeoutMs,
      requestedTimeoutMs,
    );

    let successfulRequest = false;
    let firstError: unknown;
    const deadline = Date.now() + effectiveTimeoutMs;
    for (
      let index = 0;
      index < protocolRequests.length;
      index += 1
    ) {
      const protocolRequest = protocolRequests[index]!;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const remainingRequests = protocolRequests.length - index;
      const attemptTimeoutMs = Math.max(
        1,
        Math.floor(remainingMs / remainingRequests),
      );

      try {
        const url = providerRequestUrl(
          manifestUrl,
          protocolRequest.path,
        );
        const payload = await fetchBoundedJson(
          this.fetcher,
          url,
          attemptTimeoutMs,
          this.maxBytes,
        );
        successfulRequest = true;
        const sources = normalizeStreamCandidates(
          this.addonDescriptor.id,
          payload,
        );
        if (sources.length) return sources;
      } catch (error) {
        firstError ??= error;
      }
    }

    if (!successfulRequest && firstError) throw firstError;
    return [];
  }
}
