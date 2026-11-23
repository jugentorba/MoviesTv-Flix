import {
  activeSkipSegment,
  fetchSkipSegments,
  parseSkipSegments,
  skipSegmentsUrl,
} from '../skipSegments';

const payload = {
  intro: { start_sec: 41, end_sec: 58 },
  recap: { start_sec: 0, end_sec: 40 },
  outro: { start_sec: 2400, end_sec: 2470 },
  credits: { start_sec: 2470, end_sec: 2500 },
};

test('reads the four segment shapes the player can act on', () => {
  const parsed = parseSkipSegments(payload);
  expect(parsed.segments.map((segment) => segment.kind))
    .toEqual(['recap', 'intro', 'outro', 'credits']);
});

test('a backwards or zero-length range is ignored, not clamped', () => {
  const parsed = parseSkipSegments({
    intro: { start_sec: 50, end_sec: 50 },
    outro: { start_sec: 90, end_sec: 60 },
  });
  expect(parsed.segments).toEqual([]);
});

test('garbage never reaches the player', () => {
  expect(parseSkipSegments(null).segments).toEqual([]);
  expect(parseSkipSegments('nope').segments).toEqual([]);
  expect(parseSkipSegments({ intro: { start_sec: '2', end_sec: 9 } }).segments).toEqual([]);
  expect(parseSkipSegments({ intro: { start_sec: -5, end_sec: 9 } }).segments).toEqual([]);
  expect(parseSkipSegments({ intro: { start_sec: 1, end_sec: 99_999_999 } }).segments).toEqual([]);
});

test('only the active segment is offered, and it disappears before the cut', () => {
  const { segments } = parseSkipSegments(payload);

  expect(activeSkipSegment(segments, 10)?.kind).toBe('recap');
  expect(activeSkipSegment(segments, 45)?.kind).toBe('intro');
  expect(activeSkipSegment(segments, 120)).toBeNull();
  // One second before the end the pill is gone, so a tap cannot over-seek.
  expect(activeSkipSegment(segments, 57)).toBeNull();
});

test('the URL is only built for a real IMDb id', () => {
  expect(skipSegmentsUrl({ imdbId: 'tt0944947', season: 1, episode: 1 }))
    .toBe('https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
  expect(skipSegmentsUrl({ imdbId: 'batman' })).toBeNull();
  expect(skipSegmentsUrl({ imdbId: 'tt0944947' }))
    .toBe('https://api.introdb.app/segments?imdb_id=tt0944947');
});

test('a failing or slow provider resolves to no segments', async () => {
  const failing = jest.fn(async () => { throw new Error('offline'); });
  expect(await fetchSkipSegments({ imdbId: 'tt0944947', season: 1, episode: 1 }, failing as never))
    .toEqual({ segments: [] });

  const notOk = jest.fn(async () => ({ ok: false, text: async () => '' })) as never;
  expect(await fetchSkipSegments({ imdbId: 'tt0944947' }, notOk))
    .toEqual({ segments: [] });

  const oversized = jest.fn(async () => ({
    ok: true,
    text: async () => 'x'.repeat(9 * 1024),
  })) as never;
  expect(await fetchSkipSegments({ imdbId: 'tt0944947' }, oversized))
    .toEqual({ segments: [] });
});

test('a good response is parsed', async () => {
  const ok = jest.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(payload),
  })) as never;
  const result = await fetchSkipSegments({ imdbId: 'tt0944947' }, ok);
  expect(result.segments).toHaveLength(4);
});
