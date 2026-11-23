import { dedupeStreamSources } from '@moviestv/addons';
import { playbackSourceFingerprint } from '../playback/playbackSourceIdentity';
import type { StreamSource } from '@moviestv/core';
import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import {
  isLiveTvBrowserChannel,
  liveTvFavoriteKey,
  type LiveTvBrowserChannel,
  type LiveTvChannelVariant,
} from './live-tv-aggregation';

interface LiveTvResolveOptions {
  timeoutMs?: number;
}

interface LiveTvResolver {
  resolveChannel(
    provider: LiveTvProviderDescriptor,
    channel: LiveTvChannel,
    options?: LiveTvResolveOptions,
  ): Promise<StreamSource[]>;
}

export type LiveTvPlaybackStatus = 'idle' | 'resolving' | 'ready' | 'error';

export interface LiveTvPlaybackState {
  status: LiveTvPlaybackStatus;
  channel: LiveTvChannel | null;
  sources: StreamSource[];
  selectedSourceId: string | null;
}

type Listener = (state: LiveTvPlaybackState) => void;

const DEFAULT_LIVE_TV_RESOLVE_BUDGET_MS = 8_000;

function withResolveTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Live TV stream provider timed out')),
      Math.max(1, timeoutMs),
    );
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

const idleState = (): LiveTvPlaybackState => ({
  status: 'idle',
  channel: null,
  sources: [],
  selectedSourceId: null,
});

function validVariant(
  variant: LiveTvChannelVariant | null | undefined,
): variant is LiveTvChannelVariant {
  if (!variant?.provider || !variant.channel) return false;

  const addonId = typeof variant.provider.addonId === 'string'
    ? variant.provider.addonId.trim()
    : '';
  const providerId = typeof variant.channel.providerId === 'string'
    ? variant.channel.providerId.trim()
    : '';
  const remoteId = typeof variant.channel.remoteId === 'string'
    ? variant.channel.remoteId.trim()
    : '';
  const resourceType = typeof variant.channel.resourceType === 'string'
    ? variant.channel.resourceType.trim()
    : '';
  const manifestUrl = typeof variant.provider.manifestUrl === 'string'
    ? variant.provider.manifestUrl.trim()
    : '';
  const streamTypes = variant.provider.liveTv?.streamTypes;
  // A playlist provider has no add-on manifest to validate: its channels carry
  // their own stream URLs, and those are re-validated when the channel is
  // resolved. Requiring a manifest URL here silently dropped every playlist
  // variant, so Live TV listed a user's M3U channels and could never play one.
  const isPlaylistProvider = variant.provider.kind === 'playlist';
  let manifestValid = false;
  if (manifestUrl && manifestUrl.length <= 8_192) {
    try {
      const parsed = new URL(manifestUrl);
      const hostname = parsed.hostname
        .toLowerCase()
        .replace(/^\[|\]$/g, '');
      const loopbackHttp = parsed.protocol === 'http:'
        && ['localhost', '127.0.0.1', '::1'].includes(hostname);
      manifestValid = (
        parsed.protocol === 'https:' || loopbackHttp
      )
        && !parsed.username
        && !parsed.password;
    } catch {
      manifestValid = false;
    }
  }

  return Boolean(
    addonId
    && addonId.length <= 512
    && providerId
    && providerId.length <= 512
    && addonId === providerId
    && remoteId
    && remoteId.length <= 512
    && (resourceType === 'channel' || resourceType === 'tv')
    && (isPlaylistProvider || manifestValid)
    && Array.isArray(streamTypes)
    && streamTypes.includes(resourceType)
  );
}

function normalizeVariants(
  variants: readonly LiveTvChannelVariant[],
): LiveTvChannelVariant[] {
  const candidates = variants.filter(Boolean).slice(0, 1_000);
  return candidates.filter((variant, index, list) => (
    validVariant(variant)
    && list.findIndex((candidate) => (
      validVariant(candidate)
      && candidate.provider.addonId.trim()
        === variant.provider.addonId.trim()
      && candidate.channel.remoteId.trim()
        === variant.channel.remoteId.trim()
      && candidate.channel.resourceType.trim()
        === variant.channel.resourceType.trim()
    )) === index
  ));
}

function variantIdentity(variant: LiveTvChannelVariant): string {
  return [
    variant.provider.addonId.trim(),
    variant.provider.manifestUrl.trim(),
    variant.channel.remoteId.trim(),
    variant.channel.resourceType.trim(),
  ].join('\u0000');
}

export class LiveTvPlaybackController {
  private activeToken = 0;
  private currentVariants: LiveTvChannelVariant[] = [];
  private currentVariantIndex = -1;
  private preferredProviderId: string | null = null;
  private failedSourceFingerprints = new Set<string>();
  private failedVariantIdentities = new Set<string>();
  private refreshedVariantIdentities = new Set<string>();
  private listeners = new Set<Listener>();
  state: LiveTvPlaybackState = idleState();

  constructor(
    private readonly resolver: LiveTvResolver,
    private readonly orderSources:
      (sources: readonly StreamSource[]) => StreamSource[] = (sources) => [...sources],
    private readonly resolveBudgetMs = DEFAULT_LIVE_TV_RESOLVE_BUDGET_MS,
  ) {}

  getPreferredProviderId(): string | null {
    return this.preferredProviderId;
  }

  getActiveProviderId(): string | null {
    if (
      this.currentVariantIndex < 0
      || this.currentVariantIndex >= this.currentVariants.length
    ) return null;
    return this.currentVariants[this.currentVariantIndex]?.provider.addonId
      ?? null;
  }

  async setPreferredProvider(
    addonId: string | null,
  ): Promise<boolean> {
    const normalized = addonId?.trim() || null;
    if (
      normalized
      && (
        normalized.length > 512
        || /[\u0000-\u001f\u007f]/.test(normalized)
        || !this.currentVariants.some(
          (variant) => variant.provider.addonId.trim() === normalized,
        )
      )
    ) return false;

    this.preferredProviderId = normalized;
    const channel = this.state.channel;
    if (
      !channel
      || !this.currentVariants.length
      || this.state.status === 'idle'
    ) return true;

    const token = ++this.activeToken;
    this.currentVariantIndex = -1;
    this.failedSourceFingerprints.clear();
    this.failedVariantIdentities.clear();
    this.refreshedVariantIdentities.clear();
    this.setState({
      status: 'resolving',
      channel,
      sources: [],
      selectedSourceId: null,
    });
    await this.resolveFromVariant(0, token, channel);
    return token === this.activeToken;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    try { listener(this.state); } catch { /* isolate subscriber failures */ }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(state: LiveTvPlaybackState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch { /* isolate subscriber failures */ }
    }
  }

  async selectChannel(
    provider: LiveTvProviderDescriptor,
    channel: LiveTvChannel,
  ): Promise<void> {
    if (!provider.addonId?.trim() || provider.addonId.trim() !== channel.providerId?.trim() || !channel.remoteId?.trim() || !channel.resourceType?.trim()) {
      this.activeToken += 1;
      this.currentVariants = [];
      this.currentVariantIndex = -1;
      this.setState({
        status: 'error',
        channel,
        sources: [],
        selectedSourceId: null,
      });
      return;
    }
    await this.beginSelection(
      [{ provider, channel }],
      channel,
    );
  }

  async selectLogicalChannel(
    channel: LiveTvBrowserChannel,
  ): Promise<void> {
    if (!channel.id?.trim() || channel.id.trim().length > 512 || !channel.title?.trim() || channel.title.trim().length > 500) return;
    if (!Array.isArray(channel.variants) || !channel.variants.length) {
      this.close();
      return;
    }
    await this.beginSelection(channel.variants, channel);
  }


  updateLogicalChannel(channel: LiveTvBrowserChannel): void {
    if (!channel.id?.trim() || !channel.title?.trim() || !Array.isArray(channel.variants) || !channel.variants.length) return;
    const currentChannel = this.state.channel;
    const currentVariantIds = currentChannel && isLiveTvBrowserChannel(currentChannel)
      ? new Set(currentChannel.variants.map((variant) => variant.channel.id))
      : new Set(currentChannel ? [currentChannel.id] : []);
    const refreshedVariantIds = new Set(
      channel.variants.map((variant) => variant.channel.id),
    );
    const sharesProviderVariant = [...currentVariantIds].some(
      (id) => refreshedVariantIds.has(id),
    );

    if (
      !currentChannel
      || (
        currentChannel.id !== channel.id
        && liveTvFavoriteKey(currentChannel) !== liveTvFavoriteKey(channel)
        && !sharesProviderVariant
      )
    ) return;

    if (this.state.status === 'resolving') {
      if (currentChannel === channel) return;
      void this.beginSelection(channel.variants, channel);
      return;
    }

    const currentVariant = this.currentVariantIndex >= 0
      ? this.currentVariants[this.currentVariantIndex]
      : undefined;

    this.currentVariants = normalizeVariants(channel.variants);
    if (
      this.preferredProviderId
      && !this.currentVariants.some((variant) => (
        variant.provider.addonId.trim() === this.preferredProviderId
      ))
    ) {
      this.preferredProviderId = null;
    }
    this.currentVariantIndex = currentVariant
      ? this.currentVariants.findIndex((variant) => (
        variant.provider.addonId === currentVariant.provider.addonId
        && variant.provider.manifestUrl === currentVariant.provider.manifestUrl
        && variant.channel.remoteId === currentVariant.channel.remoteId
        && variant.channel.resourceType === currentVariant.channel.resourceType
      ))
      : -1;

    this.setState({
      ...this.state,
      channel,
    });
  }

  private async beginSelection(
    variants: readonly LiveTvChannelVariant[],
    displayChannel: LiveTvChannel,
  ): Promise<void> {
    if (!displayChannel.id?.trim() || displayChannel.id.trim().length > 512 || !displayChannel.title?.trim() || displayChannel.title.trim().length > 500) return;
    const validVariants = normalizeVariants(variants);
    const token = ++this.activeToken;
    this.currentVariants = validVariants;
    if (!validVariants.length) {
      this.currentVariantIndex = -1;
      this.failedSourceFingerprints.clear();
      this.failedVariantIdentities.clear();
      this.refreshedVariantIdentities.clear();
      this.setState({ status: 'error', channel: displayChannel, sources: [], selectedSourceId: null });
      return;
    }
    this.currentVariantIndex = -1;
    this.failedSourceFingerprints.clear();
    this.failedVariantIdentities.clear();
    this.refreshedVariantIdentities.clear();
    this.setState({
      status: 'resolving',
      channel: displayChannel,
      sources: [],
      selectedSourceId: null,
    });

    await this.resolveFromVariant(0, token, displayChannel);
  }

  private async resolveVariantIndexes(
    indexes: readonly number[],
    token: number,
    displayChannel: LiveTvChannel,
  ): Promise<void> {
    const totalBudgetMs = (
      Number.isFinite(this.resolveBudgetMs)
      && this.resolveBudgetMs > 0
    )
      ? Math.max(1, Math.trunc(this.resolveBudgetMs))
      : 1;
    const deadline = Date.now() + totalBudgetMs;

    for (let position = 0; position < indexes.length; position += 1) {
      const index = indexes[position]!;
      const variant = this.currentVariants[index];
      if (!variant) continue;
      const variantKey = variantIdentity(variant);
      if (this.failedVariantIdentities.has(variantKey)) continue;

      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error('Live TV stream provider timed out');
        }
        const remainingVariants = Math.max(
          1,
          indexes.length - position,
        );
        const attemptTimeoutMs = Math.max(
          1,
          Math.floor(remainingMs / remainingVariants),
        );
        const resolved = await withResolveTimeout(
          this.resolver.resolveChannel(
            variant.provider,
            variant.channel,
            { timeoutMs: attemptTimeoutMs },
          ),
          attemptTimeoutMs,
        );
        if (token !== this.activeToken) return;

        const ordered = this.orderSources(
          Array.isArray(resolved) ? resolved : [],
        );
        const seenRawIds = new Set<string>();
        const uniqueIdCandidates = (
          Array.isArray(ordered) ? ordered : []
        )
          .slice(0, 1_000)
          .filter((candidate) => {
            if (
              !candidate
              || typeof candidate !== 'object'
              || typeof candidate.id !== 'string'
            ) return false;
            const id = candidate.id.trim();
            if (
              !id
              || id.length > 512
              || /[\u0000-\u001f\u007f]/.test(id)
              || seenRawIds.has(id)
            ) return false;
            seenRawIds.add(id);
            return true;
          });
        const normalized = dedupeStreamSources([
          uniqueIdCandidates,
        ]);
        const seen = new Set<string>();
        const sources = normalized.filter((source) => {
          const fingerprint = playbackSourceFingerprint(source);
          if (
            seen.has(fingerprint)
            || this.failedSourceFingerprints.has(fingerprint)
          ) return false;
          seen.add(fingerprint);
          return true;
        });
        if (!sources.length) {
          this.failedVariantIdentities.add(variantKey);
          continue;
        }

        this.currentVariantIndex = index;
        this.setState({
          status: 'ready',
          channel: displayChannel,
          sources,
          selectedSourceId: sources[0]!.id,
        });
        return;
      } catch {
        if (token !== this.activeToken) return;
        this.failedVariantIdentities.add(variantKey);
      }
    }

    if (token !== this.activeToken) return;
    this.currentVariantIndex = this.currentVariants.length;
    this.setState({
      status: 'error',
      channel: displayChannel,
      sources: [],
      selectedSourceId: null,
    });
  }

  private async resolveFromVariant(
    startIndex: number,
    token: number,
    displayChannel: LiveTvChannel,
  ): Promise<void> {
    const indexes = Array.from(
      { length: Math.max(0, this.currentVariants.length - startIndex) },
      (_value, offset) => startIndex + offset,
    );

    const preferredIndex = this.preferredProviderId
      ? this.currentVariants.findIndex((variant) => (
          variant.provider.addonId.trim() === this.preferredProviderId
        ))
      : -1;
    const orderedIndexes = preferredIndex >= startIndex
      ? [
          preferredIndex,
          ...indexes.filter((index) => index !== preferredIndex),
        ]
      : indexes;

    await this.resolveVariantIndexes(
      orderedIndexes,
      token,
      displayChannel,
    );
  }

  async retry(): Promise<void> {
    if (this.state.status === 'resolving' || this.state.status === 'idle') return;
    const channel = this.state.channel;
    if (!channel || !this.currentVariants.length) return;

    const token = ++this.activeToken;
    this.currentVariantIndex = -1;
    this.failedSourceFingerprints.clear();
    this.failedVariantIdentities.clear();
    this.refreshedVariantIdentities.clear();
    this.setState({
      status: 'resolving',
      channel,
      sources: [],
      selectedSourceId: null,
    });

    await this.resolveFromVariant(0, token, channel);
  }

  close(): void {
    this.activeToken += 1;
    this.currentVariants = [];
    this.currentVariantIndex = -1;
    this.failedSourceFingerprints.clear();
    this.failedVariantIdentities.clear();
    this.refreshedVariantIdentities.clear();
    this.setState(idleState());
  }

  selectSource(sourceId: string): void {
    if (this.state.status !== 'ready' || !sourceId.trim()) return;
    const normalizedSourceId = sourceId.trim();
    const source = this.state.sources.find(
      (candidate) => candidate.id === normalizedSourceId,
    );
    if (!source) return;

    this.failedSourceFingerprints.delete(playbackSourceFingerprint(source));
    this.setState({ ...this.state, selectedSourceId: normalizedSourceId });
  }

  sourceFailed(sourceId: string, expectedSource?: StreamSource): void {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) return;
    if (
      this.state.status !== 'ready'
      || this.state.selectedSourceId !== normalizedSourceId
    ) return;

    const failedSource = this.state.sources.find(
      (source) => source.id === normalizedSourceId,
    );
    if (!failedSource) return;
    if (
      expectedSource
      && playbackSourceFingerprint(failedSource) !== playbackSourceFingerprint(expectedSource)
    ) return;

    this.failedSourceFingerprints.add(
      playbackSourceFingerprint(failedSource),
    );

    const currentIndex = this.state.sources.findIndex(
      (source) => source.id === normalizedSourceId,
    );
    const laterSources = currentIndex >= 0
      ? this.state.sources.slice(currentIndex + 1)
      : [];
    const earlierSources = currentIndex > 0
      ? this.state.sources.slice(0, currentIndex)
      : [];
    const nextSource = [...laterSources, ...earlierSources].find(
      (source) => !this.failedSourceFingerprints.has(playbackSourceFingerprint(source)),
    );

    if (nextSource) {
      this.setState({
        ...this.state,
        selectedSourceId: nextSource.id,
      });
      return;
    }

    const exhaustedVariant = this.currentVariantIndex >= 0
      ? this.currentVariants[this.currentVariantIndex]
      : undefined;
    const exhaustedVariantKey = exhaustedVariant
      ? variantIdentity(exhaustedVariant)
      : null;

    const channel = this.state.channel;
    if (channel && this.currentVariants.length) {
      const failedVariantIndex = this.currentVariantIndex;
      const remainingVariantIndexes = this.currentVariants
        .map((_variant, index) => index)
        .filter((index) => index !== failedVariantIndex);

      if (
        exhaustedVariant
        && exhaustedVariantKey
        && !this.refreshedVariantIdentities.has(exhaustedVariantKey)
      ) {
        // Live TV URLs are commonly short-lived. Re-resolve the active
        // provider once before abandoning it. Previously failed source
        // fingerprints stay blocked, so an unchanged broken URL cannot loop;
        // a freshly signed URL can take over immediately.
        this.refreshedVariantIdentities.add(exhaustedVariantKey);
        const token = this.activeToken;
        this.currentVariantIndex = -1;
        this.setState({
          status: 'resolving',
          channel,
          sources: [],
          selectedSourceId: null,
        });
        void this.resolveVariantIndexes(
          [failedVariantIndex, ...remainingVariantIndexes]
            .filter((index) => index >= 0),
          token,
          channel,
        );
        return;
      }

      if (exhaustedVariantKey) {
        this.failedVariantIdentities.add(exhaustedVariantKey);
      }

      if (remainingVariantIndexes.length) {
        const token = this.activeToken;
        this.currentVariantIndex = -1;
        this.setState({
          status: 'resolving',
          channel,
          sources: [],
          selectedSourceId: null,
        });
        void this.resolveVariantIndexes(
          remainingVariantIndexes,
          token,
          channel,
        );
        return;
      }
    }

    this.setState({
      status: 'error',
      channel,
      sources: this.state.sources,
      selectedSourceId: null,
    });
  }

  async previous(
    visibleChannels: readonly LiveTvChannel[],
    providers: readonly LiveTvProviderDescriptor[],
  ): Promise<void> {
    await this.selectNeighbor(-1, visibleChannels, providers);
  }

  async next(
    visibleChannels: readonly LiveTvChannel[],
    providers: readonly LiveTvProviderDescriptor[],
  ): Promise<void> {
    await this.selectNeighbor(1, visibleChannels, providers);
  }

  private async selectNeighbor(
    direction: -1 | 1,
    visibleChannels: readonly LiveTvChannel[],
    providers: readonly LiveTvProviderDescriptor[],
  ): Promise<void> {
    const currentChannel = this.state.channel;
    if (!currentChannel?.id?.trim()) return;
    const currentKey = liveTvFavoriteKey(currentChannel);
    if (!currentKey?.trim()) return;

    if (!visibleChannels.length || visibleChannels.length > 100_000 || !providers.length || providers.length > 10_000) return;
    const index = visibleChannels.findIndex(
      (channel) => channel?.id?.trim() && liveTvFavoriteKey(channel) === currentKey,
    );
    if (index < 0) return;

    if (visibleChannels.length < 2) return;
    if (direction !== -1 && direction !== 1) return;

    const wrapIndex = (offset: number) => ((index + offset) % visibleChannels.length + visibleChannels.length) % visibleChannels.length;
    const target = wrapIndex(direction);
    let channel = visibleChannels[target];
    if (!channel) return;
    if (liveTvFavoriteKey(channel) === currentKey) {
      for (let offset = 2; offset <= visibleChannels.length; offset += 1) {
        const candidateIndex = wrapIndex(direction * offset);
        const candidate = visibleChannels[candidateIndex];
        if (candidate?.id?.trim() && candidate.title?.trim() && liveTvFavoriteKey(candidate) !== currentKey) { channel = candidate; break; }
      }
    }
    if (liveTvFavoriteKey(channel) === currentKey) return;

    if (isLiveTvBrowserChannel(channel)) {
      await this.selectLogicalChannel(channel);
      return;
    }

    const providerId = channel.providerId?.trim();
    if (!providerId) return;
    const provider = providers.slice(0, 1_000).find(
      (candidate) => candidate.addonId?.trim() === providerId,
    );
    if (!provider) return;
    await this.selectChannel(provider, channel);
  }
}
