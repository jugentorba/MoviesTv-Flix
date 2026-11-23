import type { GuideProgramme } from '@moviestv/live-tv';
import {
  guideCardRows,
  guideProgrammeLabel,
  guideStaleNotice,
  guideTimelineRows,
} from '../live-tv-guide-view-model';

const START = Date.UTC(2026, 8, 14, 18, 0, 0);

function programme(
  title: string,
  startAtMs: number,
  endAtMs: number,
): GuideProgramme {
  return { channelId: 'fr2', title, startAtMs, endAtMs };
}

describe('Live TV guide view model', () => {
  test('formats programme times in requested locale and timezone', () => {
    const value = programme('Journal', START, START + 45 * 60 * 1000);

    expect(
      guideProgrammeLabel(value, 'en-GB', 'Europe/Paris'),
    ).toEqual({
      time: '20:00–20:45',
      title: 'Journal',
    });
  });

  test('creates compact NOW and NEXT rows', () => {
    const now = programme('Journal', START, START + 45 * 60 * 1000);
    const next = programme(
      'Film',
      START + 45 * 60 * 1000,
      START + 2 * 60 * 60 * 1000,
    );

    expect(
      guideCardRows({ now, next }, 'en-GB', 'Europe/Paris'),
    ).toEqual([
      { kind: 'NOW', time: '20:00–20:45', title: 'Journal' },
      { kind: 'NEXT', time: '20:45–22:00', title: 'Film' },
    ]);
  });

  test('returns stale notice only for stale guide state', () => {
    expect(guideStaleNotice('stale')).toBe('Guide may be outdated');
    expect(guideStaleNotice('ready')).toBeNull();
    expect(guideStaleNotice('unavailable')).toBeNull();
  });

  test('orders timeline current first then upcoming programmes', () => {
    const current = programme('Journal', START, START + 45 * 60 * 1000);
    const next = programme(
      'Film',
      START + 45 * 60 * 1000,
      START + 2 * 60 * 60 * 1000,
    );
    const later = programme(
      'Late film',
      START + 2 * 60 * 60 * 1000,
      START + 3 * 60 * 60 * 1000,
    );
    const past = programme(
      'Past',
      START - 2 * 60 * 60 * 1000,
      START - 60 * 60 * 1000,
    );

    expect(
      guideTimelineRows(
        [later, past, next, current],
        START + 10 * 60 * 1000,
      ).map((item) => item.programme.title),
    ).toEqual(['Journal', 'Film', 'Late film']);
  });
});


test('timeline tie-breaking does not depend on device locale ordering', () => {
  const alpha = programme(
    'Alpha',
    START + 60 * 60 * 1000,
    START + 2 * 60 * 60 * 1000,
  );
  const beta = programme(
    'Beta',
    START + 60 * 60 * 1000,
    START + 2 * 60 * 60 * 1000,
  );
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function localeCompareBlocked() {
    throw new Error('locale-specific ordering must not be used');
  };

  try {
    expect(
      guideTimelineRows([beta, alpha], START)
        .map((row) => row.programme.title),
    ).toEqual(['Alpha', 'Beta']);
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('timeline ignores invalid clocks and malformed programme ranges', () => {
  const bad = { channelId: 'x', title: 'Bad', startAtMs: 20, endAtMs: 10 } as any;
  expect(guideTimelineRows([bad], 15)).toEqual([]);
  expect(guideTimelineRows([bad], Number.NaN)).toEqual([]);
});
