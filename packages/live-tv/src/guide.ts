export interface GuideChannel {
  id: string;
  displayNames: string[];
  countryCode?: string;
}

export interface GuideProgramme {
  channelId: string;
  title: string;
  subtitle?: string;
  description?: string;
  startAtMs: number;
  endAtMs: number;
}

export interface GuideSnapshot {
  channels: GuideChannel[];
  programmes: GuideProgramme[];
  fetchedAtMs: number;
  sourceRevision: number;
}

export interface GuideMatchCandidate {
  id: string;
  title: string;
  countryCode?: string;
  remoteIds: readonly string[];
}

export interface GuideNowNext {
  now: GuideProgramme | undefined;
  next: GuideProgramme | undefined;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export function normalizeGuideChannelName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedCountry(value: string | undefined): string | undefined {
  if (!value || !/^[A-Za-z]{2}$/.test(value)) return undefined;
  const code = value.toUpperCase();
  if (code === 'UK') return 'GB';
  if (code === 'KS' || code === 'KV') return 'XK';
  return code;
}

export function matchGuideChannels(
  logicalChannels: readonly GuideMatchCandidate[],
  guideChannels: readonly GuideChannel[],
): Map<string, string> {
  const result = new Map<string, string>();
  const guideIdCounts = new Map<string, number>();
  const guideById = new Map<string, GuideChannel[]>();
  const guideByCountryAndName = new Map<string, GuideChannel[]>();
  const countrylessGuideByName = new Map<string, GuideChannel[]>();
  const remoteClaimCounts = new Map<string, number>();

  for (const channel of guideChannels) {
    guideIdCounts.set(channel.id, (guideIdCounts.get(channel.id) ?? 0) + 1);
    const byId = guideById.get(channel.id);
    if (byId) byId.push(channel);
    else guideById.set(channel.id, [channel]);

    const country = normalizedCountry(channel.countryCode);
    const names = new Set(
      channel.displayNames
        .map(normalizeGuideChannelName)
        .filter(Boolean),
    );
    for (const name of names) {
      if (country) {
        const key = `${country}\u0000${name}`;
        const matches = guideByCountryAndName.get(key);
        if (matches) matches.push(channel);
        else guideByCountryAndName.set(key, [channel]);
      } else {
        const matches = countrylessGuideByName.get(name);
        if (matches) matches.push(channel);
        else countrylessGuideByName.set(name, [channel]);
      }
    }
  }

  for (const channel of logicalChannels) {
    for (const remoteId of new Set(channel.remoteIds)) {
      remoteClaimCounts.set(
        remoteId,
        (remoteClaimCounts.get(remoteId) ?? 0) + 1,
      );
    }
  }

  const normalizedLogicalNameCounts = new Map<string, number>();
  for (const channel of logicalChannels) {
    const name = normalizeGuideChannelName(channel.title);
    if (name) {
      normalizedLogicalNameCounts.set(
        name,
        (normalizedLogicalNameCounts.get(name) ?? 0) + 1,
      );
    }
  }

  const usedGuideIds = new Set<string>();

  for (const logical of logicalChannels) {
    const normalizedName = normalizeGuideChannelName(logical.title);
    if (!normalizedName) continue;

    const remoteIds = new Set(logical.remoteIds.filter(Boolean));
    const exact: GuideChannel[] = [];
    for (const remoteId of remoteIds) {
      if (
        guideIdCounts.get(remoteId) !== 1
        || remoteClaimCounts.get(remoteId) !== 1
        || usedGuideIds.has(remoteId)
      ) continue;
      const candidates = guideById.get(remoteId) ?? [];
      if (candidates.length === 1) exact.push(candidates[0]!);
    }

    if (exact.length === 1) {
      result.set(logical.id, exact[0]!.id);
      usedGuideIds.add(exact[0]!.id);
      continue;
    }
    if (exact.length > 1) continue;

    const logicalCountry = normalizedCountry(logical.countryCode);
    if (logicalCountry) {
      const countryMatches = (
        guideByCountryAndName.get(
          `${logicalCountry}\u0000${normalizedName}`,
        ) ?? []
      ).filter((candidate) => !usedGuideIds.has(candidate.id));
      if (countryMatches.length === 1) {
        result.set(logical.id, countryMatches[0]!.id);
        usedGuideIds.add(countryMatches[0]!.id);
        continue;
      }
      if (countryMatches.length > 1) continue;
    }

    if (normalizedLogicalNameCounts.get(normalizedName) !== 1) continue;
    const countrylessMatches = (
      countrylessGuideByName.get(normalizedName) ?? []
    ).filter((candidate) => !usedGuideIds.has(candidate.id));
    if (countrylessMatches.length === 1) {
      result.set(logical.id, countrylessMatches[0]!.id);
      usedGuideIds.add(countrylessMatches[0]!.id);
    }
  }

  return result;
}

function stableTextCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function programmeKey(programme: GuideProgramme): string {
  return [
    programme.channelId,
    programme.startAtMs,
    programme.endAtMs,
    programme.title,
    programme.subtitle ?? '',
    programme.description ?? '',
  ].join('\u0000');
}

function orderedUniqueProgrammes(programmes: readonly GuideProgramme[]): GuideProgramme[] {
  const seen = new Set<string>();
  return programmes
    .filter((programme) =>
      Number.isFinite(programme.startAtMs)
      && Number.isFinite(programme.endAtMs)
      && programme.endAtMs > programme.startAtMs
      && programme.channelId.trim().length > 0
      && programme.title.trim().length > 0,
    )
    .slice()
    .sort((left, right) =>
      left.startAtMs - right.startAtMs
      || left.endAtMs - right.endAtMs
      || stableTextCompare(left.title, right.title),
    )
    .filter((programme) => {
      const key = programmeKey(programme);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function guideNowNext(
  programmes: readonly GuideProgramme[],
  channelId: string,
  nowMs: number,
): GuideNowNext {
  const ordered = orderedUniqueProgrammes(
    programmes.filter((programme) => programme.channelId === channelId),
  );
  const now = ordered.find(
    (programme) => programme.startAtMs <= nowMs && nowMs < programme.endAtMs,
  );
  const next = now
    ? ordered.find((programme) => programme.startAtMs >= now.endAtMs)
    : ordered.find((programme) => programme.startAtMs > nowMs);
  return { now, next };
}

export function pruneGuideProgrammes(
  programmes: readonly GuideProgramme[],
  referenceMs: number,
): GuideProgramme[] {
  const earliestEnd = referenceMs - TWO_HOURS_MS;
  const latestStart = referenceMs + TWELVE_HOURS_MS;
  return orderedUniqueProgrammes(programmes).filter(
    (programme) => programme.endAtMs >= earliestEnd && programme.startAtMs <= latestStart,
  );
}
