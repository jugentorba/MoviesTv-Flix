import { normalizeManifestUrl, type AddonInstallOrigin } from '@moviestv/addons';
import {
  DEFAULT_PROVIDER_MAX_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  defaultHttpFetcher,
  fetchBoundedJson,
  type HttpFetcher,
} from './HttpJsonLoader';

export class ManifestLoader {
  constructor(
    private readonly fetcher: HttpFetcher = defaultHttpFetcher,
    private readonly timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    private readonly maxBytes = DEFAULT_PROVIDER_MAX_BYTES,
  ) {}

  async load(input: string, origin: AddonInstallOrigin): Promise<unknown> {
    const manifestUrl = normalizeManifestUrl(input, origin);
    return fetchBoundedJson(this.fetcher, manifestUrl, this.timeoutMs, this.maxBytes);
  }
}
