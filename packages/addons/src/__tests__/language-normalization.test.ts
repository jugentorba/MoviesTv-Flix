import { normalizeStreamCandidates } from '../streams';
import { normalizeSubtitleCandidates } from '../subtitles';

test.each([
  ['eng', 'en'],
  ['fra', 'fr'],
  ['fre', 'fr'],
  ['alb', 'sq'],
  ['sqi', 'sq'],
  ['zho', 'zh'],
  ['chi', 'zh'],
  ['pt_BR', 'pt-BR'],
])('normalizes declared provider language %s to %s', (providerLanguage, expected) => {
  const [source] = normalizeStreamCandidates('provider', {
    streams: [{
      id: 'one',
      name: 'Provider stream',
      language: providerLanguage,
      url: 'https://example.invalid/video',
    }],
  });

  expect(source?.language).toBe(expected);
});

test.each([
  ['Movie.1080p.GERMAN.WEB-DL', 'de'],
  ['Movie.1080p.Deutsch.WEB-DL', 'de'],
  ['Movie.1080p.TRUEFRENCH.WEB-DL', 'fr'],
  ['Movie.1080p.VFF.WEB-DL', 'fr'],
  ['Movie.1080p.Shqip.WEB-DL', 'sq'],
])('infers release-name language from %s', (name, expected) => {
  const [source] = normalizeStreamCandidates('provider', {
    streams: [{
      id: 'one',
      name,
      url: 'https://example.invalid/video',
    }],
  });

  expect(source?.language).toBe(expected);
});

test('infers multiple advertised audio languages from a release name', () => {
  const [source] = normalizeStreamCandidates('provider', {
    streams: [{
      id: 'one',
      name: 'Movie.2160p.English.German.WEB-DL',
      url: 'https://example.invalid/video',
    }],
  });

  expect(source?.language).toBe('en');
  expect(source?.audioLanguages).toEqual(['en', 'de']);
});

test('preserves an unknown declared provider language instead of discarding the source', () => {
  const [source] = normalizeStreamCandidates('provider', {
    streams: [{
      id: 'one',
      name: 'Provider stream',
      language: 'Klingon-custom',
      url: 'https://example.invalid/video',
    }],
  });

  expect(source).toBeDefined();
  expect(source?.language).toBe('Klingon-custom');
});

test('normalizes advertised audio-language arrays and removes duplicates without changing order', () => {
  const [source] = normalizeStreamCandidates('provider', {
    streams: [{
      id: 'one',
      name: 'Provider stream',
      audioLanguages: ['eng', 'fra', 'en', 'alb'],
      url: 'https://example.invalid/video',
    }],
  });

  expect(source?.audioLanguages).toEqual(['en', 'fr', 'sq']);
});


test('preserves bounded Stremio proxy request headers for runtime playback', () => {
  const [source] = normalizeStreamCandidates('provider', {
    streams: [{
      id: 'one',
      name: 'Protected stream',
      url: 'https://cdn.example/video.mp4',
      behaviorHints: {
        proxyHeaders: {
          request: {
            Authorization: 'Bearer runtime-only',
            Referer: 'https://provider.example/',
            Cookie: 'must-not-forward',
            Host: 'must-not-forward',
          },
        },
      },
    }],
  });

  expect(source?.headers).toEqual({
    Authorization: 'Bearer runtime-only',
    Referer: 'https://provider.example/',
  });
});

test('accepts loose single-subtitle and top-level array payloads', () => {
  expect(normalizeSubtitleCandidates('provider', {
    subtitle: {
      id: 'single',
      lang: 'fra',
      url: 'https://subs.example/single.vtt',
    },
  })).toEqual([
    expect.objectContaining({
      id: 'provider:single',
      language: 'fr',
      url: 'https://subs.example/single.vtt',
    }),
  ]);

  expect(normalizeSubtitleCandidates('provider', [
    {
      id: 'one',
      lang: 'eng',
      url: 'https://subs.example/one.vtt',
    },
    {
      id: 'two',
      lang: 'de',
      url: 'https://subs.example/two.vtt',
    },
  ])).toHaveLength(2);
});

test.each([
  ['French subtitle', 'https://subs.example/movie.vtt', 'fr'],
  ['Deutsch Untertitel', 'https://subs.example/movie.vtt', 'de'],
  ['Shqip', 'https://subs.example/movie.vtt', 'sq'],
  ['', 'https://subs.example/movie.english.vtt', 'en'],
])(
  'infers missing subtitle language from label or filename',
  (name, url, expected) => {
    const [track] = normalizeSubtitleCandidates('provider', {
      subtitles: [{
        id: 'main',
        ...(name ? { name } : {}),
        url,
      }],
    });

    expect(track?.language).toBe(expected);
  },
);

test('declared subtitle language wins over a misleading filename', () => {
  const [track] = normalizeSubtitleCandidates('provider', {
    subtitles: [{
      id: 'main',
      lang: 'ger',
      name: 'French subtitle',
      url: 'https://subs.example/movie.french.vtt',
    }],
  });

  expect(track?.language).toBe('de');
});

test('duplicate subtitle URLs retain richer later language metadata', () => {
  const tracks = normalizeSubtitleCandidates('provider', {
    subtitles: [
      {
        id: 'first',
        url: 'https://subs.example/shared.vtt',
      },
      {
        id: 'later',
        lang: 'fra',
        name: 'French SD',
        url: 'https://subs.example/shared.vtt',
      },
      {
        id: 'later',
        lang: 'eng',
        name: 'English',
        url: 'https://subs.example/english.vtt',
      },
    ],
  });

  expect(tracks).toEqual([
    {
      id: 'provider:first',
      language: 'fr',
      label: 'French SD',
      url: 'https://subs.example/shared.vtt',
    },
    {
      id: 'provider:later',
      language: 'en',
      label: 'English',
      url: 'https://subs.example/english.vtt',
    },
  ]);
});

test('subtitle runtime ids stay unique and auto-generated ids are prefixed once', () => {
  const tracks = normalizeSubtitleCandidates('provider', {
    subtitles: [
      {
        id: 'main',
        lang: 'eng',
        url: 'https://subs.example/one.vtt',
      },
      {
        id: 'main:2',
        lang: 'fra',
        url: 'https://subs.example/reserved.vtt',
      },
      {
        id: 'main',
        lang: 'alb',
        url: 'https://subs.example/two.vtt',
      },
      {
        lang: 'de',
        url: 'https://subs.example/generated.vtt',
      },
    ],
  });

  expect(tracks.map((track) => track.id)).toEqual([
    'provider:main',
    'provider:main:2',
    'provider:main:3',
    'provider:subtitle:3',
  ]);
  expect(tracks.map((track) => track.language)).toEqual([
    'en',
    'fr',
    'sq',
    'de',
  ]);
});


test('bounds subtitle candidates and sanitizes oversized metadata', () => {
  const subtitles = Array.from({ length: 550 }, (_, index) => ({
    id: index === 0 ? 'x'.repeat(513) : `subtitle-${index}`,
    name: index === 0 ? 'x'.repeat(501) : `Subtitle ${index}`,
    lang: index === 0 ? 'x'.repeat(129) : 'eng',
    url: `https://subs.example/${index}.vtt`,
  }));

  const tracks = normalizeSubtitleCandidates('provider', { subtitles });

  expect(tracks).toHaveLength(500);
  expect(tracks[0]?.id).toBe('provider:subtitle:0');
  expect(tracks[0]?.label).toBe('und');
  expect(tracks[0]?.language).toBe('und');
});

test('rejects invalid subtitle provider ids and credentialed URLs', () => {
  expect(normalizeSubtitleCandidates('bad\u0000provider', {
    subtitles: [{
      id: 'main',
      url: 'https://subs.example/main.vtt',
    }],
  })).toEqual([]);

  expect(normalizeSubtitleCandidates('provider', {
    subtitles: [{
      id: 'main',
      url: 'https://user:pass@subs.example/main.vtt',
    }],
  })).toEqual([]);
});


test('rejects subtitle URLs whose normalized form exceeds the URL ceiling', () => {
  const tracks = normalizeSubtitleCandidates('provider', {
    subtitles: [{
      id: 'main',
      url: `https://subs.example/${'é'.repeat(2_000)}.vtt`,
    }],
  });

  expect(tracks).toEqual([]);
});
