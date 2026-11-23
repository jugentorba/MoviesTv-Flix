import type { StreamSource } from '@moviestv/core';

export type ResolutionBucket = '4k' | '1080' | '720' | 'sd' | 'unknown';

export interface SourceGroup {
  bucket: ResolutionBucket;
  /** `2160p`, `1080p`, … — what the card headline reads. */
  label: string;
  /** Dominant release tag inside the group: BluRay, WEB-DL, … */
  tag?: string;
  count: number;
  /** Size of the best-ranked source that declares one. */
  sizeBytes?: number;
  sources: StreamSource[];
}

export interface ProviderOption {
  id: string;
  label: string;
  count: number;
}

const BUCKET_LABEL: Record<ResolutionBucket, string> = {
  '4k': '2160p',
  '1080': '1080p',
  '720': '720p',
  sd: '480p',
  unknown: 'Other',
};

/**
 * Providers label the same resolution differently (2160p, 4K, UHD, 1080p,
 * FHD), so read the quality field first, then the filename, then the codec
 * detail.
 */
export function resolutionBucket(source: StreamSource): ResolutionBucket {
  const label = [
    source.quality ?? '',
    source.filename ?? '',
    source.codecDetail ?? '',
    source.name ?? '',
  ].join(' ').toLowerCase();
  // No trailing word boundary: "2160p" and "1080p" end in a letter, so `\b2160\b`
  // never matched and every provider spelling the resolution with a `p` was
  // bucketed as unknown.
  if (/(?:^|[^0-9])(?:2160|4k|uhd)(?![0-9])/.test(label)) return '4k';
  if (/(?:^|[^0-9])1080(?![0-9])|(?:^|[^a-z0-9])fhd(?![a-z0-9])/.test(label)) return '1080';
  if (/(?:^|[^0-9])720(?![0-9])|(?:^|[\s._-])hd(?:$|[\s._-])/.test(label)) return '720';
  if (/(?:^|[^0-9])(?:480|360|240)(?![0-9])|(?:^|[^a-z0-9])sd(?![a-z0-9])/.test(label)) return 'sd';
  return 'unknown';
}

export function qualityLabel(bucket: ResolutionBucket): string {
  return BUCKET_LABEL[bucket];
}

const TAGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bremux\b/, 'Remux'],
  [/\bblu-?ray\b|\bbdrip\b|\bbrrip\b/, 'BluRay'],
  [/\bweb-?dl\b/, 'WEB-DL'],
  [/\bweb-?rip\b/, 'WEBRip'],
  [/\bhdrip\b/, 'HDRip'],
  [/\bdvdrip\b/, 'DVDRip'],
  [/\b(?:cam|hdcam)\b/, 'CAM'],
  [/\bts\b|\btelesync\b/, 'TS'],
];

/** The release tag a provider put in the name, if any. */
export function sourceTag(source: StreamSource): string | undefined {
  const text = `${source.name ?? ''} ${source.filename ?? ''} ${source.quality ?? ''}`
    .toLowerCase();
  for (const [pattern, tag] of TAGS) {
    if (pattern.test(text)) return tag;
  }
  return undefined;
}

export function formatBytes(value?: number): string | undefined {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

/**
 * `com.stremio.torrentio.addon` → `Torrentio`.
 *
 * Providers are identified by reverse-domain ids; the raw string is unreadable
 * in a chip and only the last meaningful segment carries the name.
 */
export function providerLabel(providerId: string): string {
  const segments = providerId
    .split(/[./]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !['com', 'org', 'io', 'net', 'addon', 'stremio'].includes(segment.toLowerCase()));
  const name = segments[segments.length - 1] ?? providerId;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function providerOptions(
  sources: readonly StreamSource[],
): ProviderOption[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const id = source.providerId?.trim() || 'unknown';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: providerLabel(id), count }))
    .sort((left, right) => (
      right.count - left.count || left.label.localeCompare(right.label)
    ));
}

/**
 * Groups sources by resolution while preserving ranking.
 *
 * Groups are ordered by the position of their best-ranked source, never by a
 * fixed 4K→480p order: the resolver already ranked every source, and a group
 * appearing first must mean it holds the best source, not merely the largest
 * number.
 */
export function groupSources(
  sources: readonly StreamSource[],
): SourceGroup[] {
  const groups = new Map<ResolutionBucket, SourceGroup>();

  for (const source of sources) {
    const bucket = resolutionBucket(source);
    const existing = groups.get(bucket);
    if (existing) {
      existing.sources.push(source);
      existing.count += 1;
      // Keep the size of the best-ranked source that has one.
      if (existing.sizeBytes === undefined && source.sizeBytes && source.sizeBytes > 0) {
        existing.sizeBytes = source.sizeBytes;
      }
      continue;
    }
    groups.set(bucket, {
      bucket,
      label: qualityLabel(bucket),
      count: 1,
      ...(source.sizeBytes && source.sizeBytes > 0 ? { sizeBytes: source.sizeBytes } : {}),
      sources: [source],
    });
  }

  return [...groups.values()].map((group) => {
    const tagCounts = new Map<string, number>();
    for (const source of group.sources) {
      const tag = sourceTag(source);
      if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    const tag = [...tagCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
    return tag ? { ...group, tag } : group;
  });
}
