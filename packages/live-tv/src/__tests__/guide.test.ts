import {
  guideNowNext,
  matchGuideChannels,
  pruneGuideProgrammes,
  type GuideChannel,
  type GuideMatchCandidate,
  type GuideProgramme,
} from '../guide';

const HOUR = 60 * 60 * 1000;

function logical(overrides: Partial<GuideMatchCandidate> = {}): GuideMatchCandidate {
  return {
    id: 'live:fr2',
    title: 'France 2',
    countryCode: 'FR',
    remoteIds: ['fr2.remote'],
    ...overrides,
  };
}

function guide(overrides: Partial<GuideChannel> = {}): GuideChannel {
  return {
    id: 'fr2.xmltv',
    displayNames: ['France 2'],
    countryCode: 'FR',
    ...overrides,
  };
}

function programme(
  title: string,
  startAtMs: number,
  endAtMs: number,
  channelId = 'fr2.xmltv',
): GuideProgramme {
  return { channelId, title, startAtMs, endAtMs };
}

describe('Live TV guide model', () => {
  test('matches an exact provider remote id before names', () => {
    const channels = [logical({
      title: 'Different display title',
      remoteIds: ['fr2.xmltv'],
    })];
    const guides = [guide({ displayNames: ['Completely Different'] })];

    expect(matchGuideChannels(channels, guides).get('live:fr2')).toBe('fr2.xmltv');
  });

  test('matches normalized display name when explicit countries agree', () => {
    const channels = [logical({ title: 'Frànce-2 HD', remoteIds: [] })];
    const guides = [guide({ displayNames: ['FRANCE 2 HD'], countryCode: 'FR' })];

    expect(matchGuideChannels(channels, guides).get('live:fr2')).toBe('fr2.xmltv');
  });

  test('matches normalized country aliases used by Live TV providers', () => {
    const kosovo = matchGuideChannels(
      [logical({
        id: 'live:rtk',
        title: 'RTK 1',
        countryCode: 'XK',
        remoteIds: [],
      })],
      [guide({
        id: 'rtk.xmltv',
        displayNames: ['RTK 1'],
        countryCode: 'KS',
      })],
    );
    const uk = matchGuideChannels(
      [logical({
        id: 'live:bbc',
        title: 'BBC One',
        countryCode: 'GB',
        remoteIds: [],
      })],
      [guide({
        id: 'bbc.xmltv',
        displayNames: ['BBC One'],
        countryCode: 'UK',
      })],
    );

    expect(kosovo.get('live:rtk')).toBe('rtk.xmltv');
    expect(uk.get('live:bbc')).toBe('bbc.xmltv');
  });

  test('does not match the same normalized name when explicit countries differ', () => {
    const channels = [logical({ remoteIds: [] })];
    const guides = [guide({ countryCode: 'AL' })];

    expect(matchGuideChannels(channels, guides).has('live:fr2')).toBe(false);
  });

  test('allows a countryless normalized-name match only when unique on both sides', () => {
    const unique = matchGuideChannels(
      [logical({ countryCode: undefined, remoteIds: [] })],
      [guide({ countryCode: undefined })],
    );
    expect(unique.get('live:fr2')).toBe('fr2.xmltv');

    const ambiguous = matchGuideChannels(
      [
        logical({ id: 'live:a', countryCode: undefined, remoteIds: [] }),
        logical({ id: 'live:b', countryCode: undefined, remoteIds: [] }),
      ],
      [guide({ countryCode: undefined })],
    );
    expect(ambiguous.size).toBe(0);
  });

  test('rejects ambiguous duplicate guide ids instead of guessing', () => {
    const channels = [logical({ remoteIds: ['same-id'] })];
    const guides = [
      guide({ id: 'same-id', displayNames: ['One'] }),
      guide({ id: 'same-id', displayNames: ['Two'] }),
    ];

    expect(matchGuideChannels(channels, guides).size).toBe(0);
  });

  test('matches correctly in a large indexed guide without confusing names', () => {
    const guides = Array.from({ length: 2_000 }, (_, index): GuideChannel => ({
      id: `channel-${index}`,
      displayNames: [`Channel ${index}`],
      countryCode: index % 2 === 0 ? 'FR' : 'AL',
    }));
    guides.push({
      id: 'fr2.remote',
      displayNames: ['France 2'],
      countryCode: 'FR',
    });

    const channels = Array.from({ length: 1_000 }, (_, index): GuideMatchCandidate => ({
      id: `live:${index}`,
      title: `Channel ${index}`,
      countryCode: index % 2 === 0 ? 'FR' : 'AL',
      remoteIds: [],
    }));
    channels.push(logical());

    const matches = matchGuideChannels(channels, guides);

    expect(matches.get('live:fr2')).toBe('fr2.remote');
    expect(matches.get('live:10')).toBe('channel-10');
    expect(matches.get('live:11')).toBe('channel-11');
  });

  test('selects now and next with an exclusive end boundary', () => {
    const base = Date.UTC(2026, 8, 14, 18, 0, 0);
    const journal = programme('Journal', base, base + 45 * 60 * 1000);
    const film = programme('Film', base + 45 * 60 * 1000, base + 2 * HOUR);

    expect(
      guideNowNext([film, journal, { ...journal }], 'fr2.xmltv', base + 30 * 60 * 1000),
    ).toEqual({
      now: journal,
      next: film,
    });
    expect(
      guideNowNext([film, journal], 'fr2.xmltv', base + 45 * 60 * 1000),
    ).toEqual({
      now: film,
      next: undefined,
    });
  });

  test('programme tie-breaking does not depend on device locale ordering', () => {
    const base = Date.UTC(2026, 8, 14, 18, 0, 0);
    const alpha = programme('Alpha', base, base + HOUR);
    const beta = programme('Beta', base, base + HOUR);
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = function localeCompareBlocked() {
      throw new Error('locale-specific ordering must not be used');
    };

    try {
      expect(
        guideNowNext([beta, alpha], 'fr2.xmltv', base + 1),
      ).toEqual({
        now: alpha,
        next: undefined,
      });
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  test('uses earliest future programme as next when nothing is currently airing', () => {
    const base = Date.UTC(2026, 8, 14, 18, 0, 0);
    const later = programme('Later', base + HOUR, base + 2 * HOUR);

    expect(guideNowNext([later], 'fr2.xmltv', base)).toEqual({
      now: undefined,
      next: later,
    });
  });

  test('prunes programmes outside the cache window', () => {
    const now = Date.UTC(2026, 8, 14, 18, 0, 0);
    const old = programme('Old', now - 4 * HOUR, now - 3 * HOUR);
    const recent = programme('Recent', now - 3 * HOUR, now - HOUR);
    const future = programme('Future', now + 11 * HOUR, now + 11.5 * HOUR);
    const tooFar = programme('Too far', now + 13 * HOUR, now + 14 * HOUR);

    expect(
      pruneGuideProgrammes([old, recent, future, tooFar], now)
        .map((item) => item.title),
    ).toEqual(['Recent', 'Future']);
  });

  test('guide channel identity does not depend on device locale casing', () => {
    const original = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function toLocaleLowerCaseBlocked() {
      throw new Error('locale-specific casing must not be used');
    };

    try {
      expect(matchGuideChannels(
        [logical({
          id: 'live:italia',
          title: 'ITALIA 1',
          countryCode: 'IT',
          remoteIds: [],
        })],
        [guide({
          id: 'italia.xmltv',
          displayNames: ['Italia 1'],
          countryCode: 'IT',
        })],
      ).get('live:italia')).toBe('italia.xmltv');
    } finally {
      String.prototype.toLocaleLowerCase = original;
    }
  });

  test('matches Unicode channel names without dropping non-Latin letters', () => {
    const channels = [logical({
      id: 'live:ru',
      title: 'Новости 24',
      countryCode: 'RU',
      remoteIds: [],
    })];
    const guides = [guide({
      id: 'ru.xmltv',
      displayNames: ['НОВОСТИ-24'],
      countryCode: 'RU',
    })];

    expect(matchGuideChannels(channels, guides).get('live:ru'))
      .toBe('ru.xmltv');
  });

});
