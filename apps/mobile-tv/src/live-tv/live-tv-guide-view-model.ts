import type { GuideNowNext, GuideProgramme } from '@moviestv/live-tv';
import type { LiveTvGuideStatus } from './LiveTvGuideController';

export interface GuideProgrammeLabel {
  time: string;
  title: string;
}

export interface GuideCardRow extends GuideProgrammeLabel {
  kind: 'NOW' | 'NEXT';
}

export interface GuideTimelineRow {
  programme: GuideProgramme;
  isCurrent: boolean;
}

function stableTextCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function timeFormatter(locale?: string, timeZone?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function guideProgrammeLabel(
  programme: GuideProgramme,
  locale?: string,
  timeZone?: string,
): GuideProgrammeLabel {
  if (!Number.isFinite(programme.startAtMs) || !Number.isFinite(programme.endAtMs) || programme.endAtMs <= programme.startAtMs) {
    return { time: '', title: programme.title };
  }
  const formatter = timeFormatter(locale, timeZone);
  return {
    time: `${formatter.format(programme.startAtMs)}–${formatter.format(programme.endAtMs)}`,
    title: programme.title,
  };
}

export function guideCardRows(
  value: GuideNowNext,
  locale?: string,
  timeZone?: string,
): GuideCardRow[] {
  const rows: GuideCardRow[] = [];
  if (value.now) {
    rows.push({
      kind: 'NOW',
      ...guideProgrammeLabel(value.now, locale, timeZone),
    });
  }
  if (value.next) {
    rows.push({
      kind: 'NEXT',
      ...guideProgrammeLabel(value.next, locale, timeZone),
    });
  }
  return rows;
}

export function guideStaleNotice(status: LiveTvGuideStatus): string | null {
  return status === 'stale' ? 'Guide may be outdated' : null;
}

export function guideTimelineRows(
  programmes: readonly GuideProgramme[],
  nowMs: number,
): GuideTimelineRow[] {
  if (!Number.isFinite(nowMs) || nowMs < 0) return [];
  const ordered = programmes
    .filter((programme) => Number.isFinite(programme.startAtMs) && Number.isFinite(programme.endAtMs) && programme.endAtMs > programme.startAtMs && programme.endAtMs > nowMs)
    .slice()
    .sort((left, right) =>
      left.startAtMs - right.startAtMs
      || left.endAtMs - right.endAtMs
      || stableTextCompare(left.title, right.title),
    );

  const current = ordered.find(
    (programme) => programme.startAtMs <= nowMs && nowMs < programme.endAtMs,
  );
  const upcoming = ordered.filter((programme) => programme.startAtMs > nowMs);

  return [
    ...(current ? [{ programme: current, isCurrent: true }] : []),
    ...upcoming.map((programme) => ({ programme, isCurrent: false })),
  ];
}
