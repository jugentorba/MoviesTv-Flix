import type { StreamSource } from '@moviestv/core';
import type { AddonDescriptor, AddonMediaRequest } from './types';
import type { AddonRegistry, RegisteredAddon } from './registry';
import { supportsStreamRequest } from './stremio-request';
import { dedupeStreamSources } from './streams';

const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_PROVIDER_RESOLUTIONS = 8;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Provider timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type ProviderResolution =
  | { ok: true; sources: StreamSource[] }
  | { ok: false };

function supportsRequestedMedia(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): boolean {
  if (descriptor.sourceType === 'stremio-manifest') {
    return supportsStreamRequest(descriptor, request);
  }

  const kind = request.kind === 'movie' ? 'movie' : 'series';
  return Array.isArray(descriptor.supportedMediaKinds)
    && descriptor.supportedMediaKinds.includes(kind);
}

function entrySupportsRequestedMedia(
  entry: RegisteredAddon,
  request: AddonMediaRequest,
): boolean {
  try {
    return supportsRequestedMedia(
      entry.adapter.descriptor(),
      request,
    );
  } catch {
    return false;
  }
}

async function resolveProvider(
  entry: RegisteredAddon,
  request: AddonMediaRequest,
  timeoutMs: number,
): Promise<ProviderResolution> {
  try {
    const sources = await withTimeout(
      entry.adapter.resolve(request, { timeoutMs }),
      timeoutMs,
    );
    if (!Array.isArray(sources)) return { ok: false };
    return {
      ok: true,
      sources,
    };
  } catch {
    return { ok: false };
  }
}


async function resolveProvidersWithinBudget(
  entries: readonly RegisteredAddon[],
  request: AddonMediaRequest,
  timeoutMs: number,
): Promise<ProviderResolution[]> {
  if (!entries.length) return [];

  const outcomes = new Array<ProviderResolution>(entries.length);
  const budgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : 1;
  const concurrency = Math.min(
    MAX_CONCURRENT_PROVIDER_RESOLUTIONS,
    entries.length,
  );
  const waves = Math.max(1, Math.ceil(entries.length / concurrency));
  const attemptBudgetMs = Math.max(1, Math.floor(budgetMs / waves));
  const deadline = Date.now() + budgetMs;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        outcomes[index] = { ok: false };
        continue;
      }

      outcomes[index] = await resolveProvider(
        entries[index]!,
        request,
        Math.max(1, Math.min(attemptBudgetMs, remainingMs)),
      );
    }
  };

  await Promise.all(
    Array.from(
      { length: concurrency },
      () => worker(),
    ),
  );

  return outcomes;
}

export class AddonSourceResolver {
  constructor(
    private readonly registry: AddonRegistry,
    private readonly providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  ) {}

  async resolve(request: AddonMediaRequest): Promise<StreamSource[]> {
    const entries = this.registry.enabledConfigured().filter(
      (entry) => entrySupportsRequestedMedia(entry, request),
    );
    if (!entries.length) return [];

    const outcomes = await resolveProvidersWithinBudget(
      entries,
      request,
      this.providerTimeoutMs,
    );
    const successful = outcomes.filter(
      (outcome): outcome is Extract<ProviderResolution, { ok: true }> => outcome.ok,
    );
    if (!successful.length) {
      throw new Error('Playback providers are unavailable');
    }

    return dedupeStreamSources(
      successful.map((outcome) => outcome.sources),
    );
  }
}
