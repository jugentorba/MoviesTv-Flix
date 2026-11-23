import type { AddonMediaRequest } from '../../addons/src';
import { stableTextCompare, type StreamSource } from '../../core/src';
import { rankStreamSources, type PlaybackPreferences } from './ranking';

export interface PlaybackSourceResolver {
  resolve(request: AddonMediaRequest): Promise<StreamSource[]>;
}

export type PlaybackSessionStatus = 'idle' | 'resolving' | 'ready' | 'no-sources' | 'error';

export interface PlaybackSessionState {
  status: PlaybackSessionStatus;
  request: AddonMediaRequest | null;
  sources: StreamSource[];
  selectedSourceId: string | null;
  error: string | null;
}

export type PlaybackSessionListener = (state: Readonly<PlaybackSessionState>) => void;

const idleState = (): PlaybackSessionState => ({
  status: 'idle',
  request: null,
  sources: [],
  selectedSourceId: null,
  error: null,
});

function normalizedHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Array<readonly [string, string]> | null {
  if (!headers) return [];

  const result: Array<readonly [string, string]> = [];
  const seen = new Set<string>();
  let count = 0;

  for (const rawName in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, rawName)) continue;
    count += 1;
    if (count > 16) return null;

    const rawValue = headers[rawName];
    if (typeof rawValue !== 'string') return null;

    const name = rawName.trim().toLowerCase();
    const value = rawValue.trim();
    if (
      !name
      || name.length > 64
      || seen.has(name)
      || !value
      || value.length > 2_048
      || /[\u0000-\u001f\u007f]/.test(name)
      || /[\u0000-\u001f\u007f]/.test(value)
    ) {
      return null;
    }

    seen.add(name);
    result.push([name, value] as const);
  }

  return result.sort(([aName, aValue], [bName, bValue]) => (
    stableTextCompare(aName, bName)
    || stableTextCompare(aValue, bValue)
  ));
}

function sameHeaders(
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined,
): boolean {
  const normalizedLeft = normalizedHeaders(left);
  const normalizedRight = normalizedHeaders(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return JSON.stringify(normalizedLeft)
    === JSON.stringify(normalizedRight);
}

function validSessionSourceIdentity(source: StreamSource): boolean {
  const id = source.id?.trim();
  const rawUrl = source.url?.trim();
  if (
    !id
    || id.length > 512
    || /[\u0000-\u001f\u007f]/.test(id)
    || !rawUrl
    || rawUrl.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(rawUrl)
  ) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username
      && !url.password
      && url.href.length <= 8_192
    );
  } catch {
    return false;
  }
}

function sourceFingerprint(source: StreamSource): string | null {
  const headers = normalizedHeaders(source.headers);
  if (!headers) return null;

  let url = source.url.trim();
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    url = parsed.toString();
  } catch {
    // Keep raw URL for defensive callers; sources are validated upstream.
  }
  return `${url}\u0000${JSON.stringify(headers)}`;
}

function sourceRefreshSignature(source: StreamSource): string | null {
  const fingerprint = sourceFingerprint(source);
  if (!fingerprint) return null;

  return `${fingerprint}\u0000${JSON.stringify({
    filename: source.filename?.trim() || null,
    contentType: source.contentType?.split(';', 1)[0]?.trim().toLowerCase() || null,
    codec: source.codec?.trim().toLowerCase() || null,
    codecDetail: source.codecDetail?.trim().toLowerCase() || null,
    audioCodec: source.audioCodec ?? null,
    dynamicRange: source.dynamicRange ?? null,
    webReady: source.webReady ?? null,
  })}`;
}

function uniqueSources(sources: readonly StreamSource[]): StreamSource[] {
  const seenIds = new Set<string>();
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!validSessionSourceIdentity(source)) return false;
    const id = source.id.trim();
    const key = sourceFingerprint(source);
    if (!key || seenIds.has(id) || seen.has(key)) return false;
    seenIds.add(id);
    seen.add(key);
    return true;
  });
}

function errorMessage(error: unknown): string {
  const fallback = 'Playback sources could not be resolved';
  const message = error instanceof Error
    ? error.message.replace(/\s+/g, ' ').trim()
    : '';
  if (!message) return fallback;

  const sensitive = [
    /https?:\/\/\S+/i,
    /\bauthorization\s*[:=]\s*\S+/i,
    /\b(?:set-)?cookie\s*[:=]\s*\S+/i,
    /\bbearer\s+\S+/i,
    /\b(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|credential|session|debrid)\s*[:=]\s*\S+/i,
    /\/[A-Za-z0-9_-]{24,}\//i,
  ];
  if (sensitive.some((pattern) => pattern.test(message))) {
    return fallback;
  }

  return message.length <= 240
    ? message
    : `${message.slice(0, 239)}…`;
}

export class PlaybackSessionController {
  private state: PlaybackSessionState = idleState();
  private generation = 0;
  private readonly listeners = new Set<PlaybackSessionListener>();

  constructor(
    private readonly resolver: PlaybackSourceResolver,
    private readonly preferences: () => PlaybackPreferences,
  ) {}

  getState(): Readonly<PlaybackSessionState> {
    return this.state;
  }

  subscribe(listener: PlaybackSessionListener): () => void {
    this.listeners.add(listener);
    try { listener(this.state); } catch { /* isolate subscriber failures */ }
    return () => {
      this.listeners.delete(listener);
    };
  }

  async resolve(request: AddonMediaRequest): Promise<boolean> {
    if (!request.mediaId?.trim()) return false;
    const safeRequest = { ...request, externalIds: { ...(request.externalIds ?? {}) } };
    const generation = ++this.generation;
    this.publish({
      status: 'resolving',
      request: safeRequest,
      sources: [],
      selectedSourceId: null,
      error: null,
    });

    try {
      const resolved = await this.resolver.resolve(safeRequest);
      if (generation !== this.generation) return false;

      const sources = uniqueSources(rankStreamSources(resolved, this.preferences())
        .map(({ source }) => source));

      if (sources.length === 0) {
        this.publish({
          status: 'no-sources',
          request: safeRequest,
          sources: [],
          selectedSourceId: null,
          error: null,
        });
        return false;
      }

      this.publish({
        status: 'ready',
        request: safeRequest,
        sources,
        selectedSourceId: sources[0]?.id ?? null,
        error: null,
      });
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.publish({
        status: 'error',
        request: safeRequest,
        sources: [],
        selectedSourceId: null,
        error: errorMessage(error),
      });
      return false;
    }
  }

  async refresh(): Promise<boolean> {
    const current = this.state;
    if (current.status !== 'ready' || !current.request || current.sources.length === 0) return false;

    const generation = ++this.generation;
    const request = { ...current.request, externalIds: { ...(current.request.externalIds ?? {}) } };
    const requestMediaId = request.mediaId;
    const requestKind = request.kind;
    const selectedAtStart = current.sources.find(
      (source) => source.id === current.selectedSourceId,
    ) ?? null;
    const selectedAtStartFingerprint = selectedAtStart
      ? sourceFingerprint(selectedAtStart)
      : null;

    try {
      const resolved = await this.resolver.resolve(request);
      if (generation !== this.generation) return false;
      const latest = this.state;
      if (
        latest.status !== 'ready'
        || latest.request?.mediaId !== requestMediaId
        || latest.request?.kind !== requestKind
      ) return false;

      const selectionChangedDuringRefresh =
        latest.selectedSourceId !== current.selectedSourceId;
      const selected = latest.sources.find(
        (source) => source.id === latest.selectedSourceId,
      ) ?? null;
      const selectedFingerprint = selected
        ? sourceFingerprint(selected)
        : null;

      const sources = uniqueSources(rankStreamSources(resolved, this.preferences())
        .map(({ source }) => source));
      if (sources.length === 0) return false;
      const previousFingerprints = new Set(
        latest.sources
          .map(sourceFingerprint)
          .filter((value): value is string => Boolean(value)),
      );
      const freshSources = sources.filter((source) => {
        const fingerprint = sourceFingerprint(source);
        return Boolean(
          fingerprint
          && !previousFingerprints.has(fingerprint),
        );
      });
      const orderChanged = sources.length !== latest.sources.length
        || sources.some((source, index) => (
          sourceRefreshSignature(source)
          !== sourceRefreshSignature(latest.sources[index]!)
        ));
      if (!freshSources.length && !orderChanged) return false;

      const latestSelectionById = selected
        ? sources.find((source) => source.id === selected.id)
        : undefined;
      const renewedSelection = selected ? sources.find((source) => (
        source.id === selected.id
        && sourceFingerprint(source) !== selectedFingerprint
      )) : undefined;
      const preserved = selected ? sources.find((source) => (
        sourceFingerprint(source) === selectedFingerprint
        || (source.url === selected.url && sameHeaders(source.headers, selected.headers))
      )) : undefined;
      const startSelectionRenewed = selectedAtStart ? sources.find((source) => (
        source.id === selectedAtStart.id
        && sourceFingerprint(source) !== selectedAtStartFingerprint
      )) : undefined;

      // A manual choice made while refresh is running must win over automatic
      // failover. Otherwise, prefer a renewed version of the source that was
      // selected when refresh began, then a genuinely fresh source, then an
      // unchanged preserved selection.
      const selectedSourceId = (
        selectionChangedDuringRefresh
          ? latestSelectionById?.id ?? preserved?.id
          : startSelectionRenewed?.id
            ?? renewedSelection?.id
            ?? freshSources[0]?.id
            ?? preserved?.id
      )
        ?? sources[0]?.id
        ?? null;

      this.publish({
        status: 'ready',
        request,
        sources,
        selectedSourceId,
        error: null,
      });
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      const message = errorMessage(error);
      if (message === 'Playback providers are unavailable') {
        this.publish({
          status: 'error',
          request,
          sources: [],
          selectedSourceId: null,
          error: message,
        });
      }
      return false;
    }
  }

  selectSource(sourceId: string): boolean {
    if (!sourceId.trim()) return false;
    if (!this.state.sources.some((source) => source.id === sourceId)) return false;
    if (this.state.selectedSourceId === sourceId) return true;

    this.publish({ ...this.state, selectedSourceId: sourceId });
    return true;
  }

  reset(): void {
    this.generation += 1;
    this.publish(idleState());
  }

  private publish(next: PlaybackSessionState): void {
    this.state = next;
    for (const listener of [...this.listeners]) {
      try { listener(this.state); } catch { /* isolate subscriber failures */ }
    }
  }
}
