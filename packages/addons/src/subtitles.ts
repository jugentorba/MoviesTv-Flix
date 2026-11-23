import {
  inferMediaLanguages,
  normalizeLanguageTag,
  type SubtitleTrack,
} from '@moviestv/core';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return undefined;
  return normalized;
}

function safeHttpsUrl(value: unknown): string | null {
  const normalized = safeString(value, 8_192);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.href.length > 8_192
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeSubtitleCandidates(
  providerId: string,
  payload: unknown,
): SubtitleTrack[] {
  const normalizedProviderId = safeString(providerId, 512);
  const root = asRecord(payload);
  if (!normalizedProviderId) return [];

  const nestedSubtitles = root?.subtitles;
  const nestedSubtitle = root?.subtitle;
  const subtitles = Array.isArray(payload)
    ? payload.slice(0, 500)
    : Array.isArray(nestedSubtitles)
      ? nestedSubtitles.slice(0, 500)
      : asRecord(nestedSubtitles)
        ? [nestedSubtitles]
        : asRecord(nestedSubtitle)
          ? [nestedSubtitle]
          : root && safeHttpsUrl(root.url)
            ? [root]
            : [];

  const trackIndexByUrl = new Map<string, number>();
  const usedIds = new Set<string>();
  const result: SubtitleTrack[] = [];

  const uniqueId = (baseId: string): string => {
    if (!usedIds.has(baseId)) {
      usedIds.add(baseId);
      return baseId;
    }

    let suffix = 2;
    let id = `${baseId}:${suffix}`;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `${baseId}:${suffix}`;
    }
    usedIds.add(id);
    return id;
  };

  subtitles.forEach((candidate, index) => {
    const record = asRecord(candidate);
    if (!record) return;

    const url = safeHttpsUrl(record.url);
    if (!url) return;

    const label = safeString(record.name, 500)
      ?? safeString(record.title, 500)
      ?? '';
    const declaredLanguage = safeString(record.lang, 128)
      ?? safeString(record.language, 128)
      ?? null;
    const inferredLanguage = declaredLanguage
      ? undefined
      : inferMediaLanguages(`${label} ${url}`)[0];
    const rawLanguage = declaredLanguage ?? inferredLanguage ?? 'und';
    const language = normalizeLanguageTag(rawLanguage)
      ?? rawLanguage.toLowerCase();
    const displayLabel = label || language;
    const existingIndex = trackIndexByUrl.get(url);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      if (!existing) return;
      const richerLanguage = existing.language === 'und' && language !== 'und'
        ? language
        : existing.language;
      const richerLabel = (
        existing.label === existing.language
        && label
      )
        ? label
        : existing.label;
      result[existingIndex] = {
        ...existing,
        language: richerLanguage,
        label: richerLabel,
      };
      return;
    }

    const rawId = safeString(record.id, 512)
      ?? `subtitle:${index}`;
    const id = uniqueId(`${normalizedProviderId}:${rawId}`);
    trackIndexByUrl.set(url, result.length);
    result.push({
      id,
      language,
      label: displayLabel,
      url,
    });
  });

  return result;
}
