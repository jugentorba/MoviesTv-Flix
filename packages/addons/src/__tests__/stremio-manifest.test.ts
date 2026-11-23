import * as addons from '../index';

function fn<T extends (...args: any[]) => any>(name: string): T | undefined {
  return (addons as any)[name] as T | undefined;
}

const streamManifest = {
  id: 'org.example.public-domain',
  name: 'Public Domain Example',
  description: 'Authorized public-domain streams.',
  version: '1.2.3',
  resources: [
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
  ],
  types: ['movie', 'series'],
  logo: 'https://example.com/logo.png',
};

const liveTvManifest = {
  id: 'org.example.tv',
  name: 'Example TV',
  version: '1.0.0',
  types: ['channel'],
  catalogs: [{ type: 'channel', id: 'all', name: 'All' }],
  resources: [
    { name: 'catalog', types: ['channel'] },
    { name: 'stream', types: ['channel'] },
  ],
};

describe('manifest URL policy', () => {
  it('normalizes HTTPS addon roots to manifest.json', () => {
    const normalizeManifestUrl = fn<(input: string, origin: 'manual' | 'curated') => string>('normalizeManifestUrl');
    expect(normalizeManifestUrl).toBeDefined();
    expect(normalizeManifestUrl?.(' https://example.com/ ', 'manual')).toBe('https://example.com/manifest.json');
    expect(normalizeManifestUrl?.('https://example.com/addon', 'manual')).toBe('https://example.com/addon/manifest.json');
    expect(normalizeManifestUrl?.('https://example.com/addon/manifest.json', 'manual')).toBe('https://example.com/addon/manifest.json');
  });

  it('accepts shared stremio links by safely translating them to HTTPS', () => {
    const normalizeManifestUrl = fn<(input: string, origin: 'manual' | 'curated') => string>('normalizeManifestUrl');
    expect(normalizeManifestUrl?.('stremio://example.com/addon/manifest.json', 'manual'))
      .toBe('https://example.com/addon/manifest.json');
    expect(normalizeManifestUrl?.('STREMIO://example.com/addon', 'manual'))
      .toBe('https://example.com/addon/manifest.json');
  });

  it('rejects provider URLs that exceed the normalized URL ceiling', () => {
    const normalizeManifestUrl = fn<
      (input: string, origin: 'manual' | 'curated') => string
    >('normalizeManifestUrl');
    expect(normalizeManifestUrl).toBeDefined();

    const expanded = `https://example.com/${'é'.repeat(2_000)}`;
    expect(expanded.length).toBeLessThan(8_192);

    expect(() => normalizeManifestUrl?.(
      expanded,
      'manual',
    )).toThrow('Provider URL is too long');
  });

  it('rejects unsupported schemes and embedded credentials', () => {
    const normalizeManifestUrl = fn<(input: string, origin: 'manual' | 'curated') => string>('normalizeManifestUrl');
    expect(normalizeManifestUrl).toBeDefined();
    expect(() => normalizeManifestUrl?.('file:///tmp/manifest.json', 'manual')).toThrow();
    expect(() => normalizeManifestUrl?.('javascript:alert(1)', 'manual')).toThrow();
    expect(() => normalizeManifestUrl?.('https://user:pass@example.com/manifest.json', 'manual')).toThrow();
    expect(() => normalizeManifestUrl?.('stremio://user:pass@example.com/manifest.json', 'manual')).toThrow();
  });

  it('allows HTTP only for explicit manual loopback development URLs', () => {
    const normalizeManifestUrl = fn<(input: string, origin: 'manual' | 'curated') => string>('normalizeManifestUrl');
    expect(normalizeManifestUrl).toBeDefined();
    expect(normalizeManifestUrl?.('http://127.0.0.1:7000/manifest.json', 'manual')).toBe('http://127.0.0.1:7000/manifest.json');
    expect(normalizeManifestUrl?.('http://localhost:7000/', 'manual')).toBe('http://localhost:7000/manifest.json');
    expect(() => normalizeManifestUrl?.('http://example.com/manifest.json', 'manual')).toThrow();
    expect(() => normalizeManifestUrl?.('http://127.0.0.1:7000/manifest.json', 'curated')).toThrow();
  });

  it('rejects private-network targets from curated entries', () => {
    const normalizeManifestUrl = fn<(input: string, origin: 'manual' | 'curated') => string>('normalizeManifestUrl');
    expect(normalizeManifestUrl).toBeDefined();
    expect(() => normalizeManifestUrl?.('https://192.168.1.10/manifest.json', 'curated')).toThrow();
    expect(() => normalizeManifestUrl?.('https://10.0.0.2/manifest.json', 'curated')).toThrow();
  });
});

describe('Stremio manifest normalization', () => {
  it('drops credential-bearing and normalization-expanded provider logos', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    expect(parseStremioManifest).toBeDefined();

    const signed = parseStremioManifest?.({
      ...streamManifest,
      logo: 'https://images.example/logo.png?token=LOCAL-SECRET',
    }, 'https://example.com/manifest.json');
    expect(signed?.logoUrl).toBeUndefined();

    const expanded = parseStremioManifest?.({
      ...streamManifest,
      logo: `https://images.example/${'é'.repeat(700)}.png`,
    }, 'https://example.com/manifest.json');
    expect(expanded?.logoUrl).toBeUndefined();
    const pathCredential = parseStremioManifest?.({
      ...streamManifest,
      logo: 'https://images.example/token=fixture-value/logo.png',
    }, 'https://example.com/manifest.json');
    expect(pathCredential?.logoUrl).toBeUndefined();

    const encodedFragmentCredential = parseStremioManifest?.({
      ...streamManifest,
      logo: 'https://images.example/logo.png#signature%3Dfixture-value',
    }, 'https://example.com/manifest.json');
    expect(encodedFragmentCredential?.logoUrl).toBeUndefined();

  });

  it('normalizes stream capability, supported kinds and protocol filters', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    expect(parseStremioManifest).toBeDefined();
    const descriptor = parseStremioManifest?.(streamManifest, 'https://example.com/manifest.json');
    expect(descriptor).toEqual(expect.objectContaining({
      id: 'org.example.public-domain',
      name: 'Public Domain Example',
      version: '1.2.3',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      supportedMediaKinds: ['movie', 'series'],
      requiresConfiguration: false,
      manifestUrl: 'https://example.com/manifest.json',
      stream: { types: ['movie', 'series'], idPrefixes: ['tt'] },
    }));
    expect(descriptor?.liveTv).toBeUndefined();
  });



  it('accepts a subtitle-only movie and series provider', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const descriptor = parseStremioManifest?.({
      id: 'org.example.subtitles',
      name: 'Example Subtitles',
      version: '1.0.0',
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      resources: [
        { name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt'] },
      ],
    }, 'https://subs.example/manifest.json');

    expect(descriptor?.capabilities).toEqual(['subtitle']);
    expect(descriptor?.supportedMediaKinds).toEqual(['movie', 'series']);
    expect(descriptor?.subtitle).toEqual({
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
    });
  });

  it('accepts a pure Live TV provider without inventing movie or series support', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const descriptor = parseStremioManifest?.(liveTvManifest, 'https://example.com/manifest.json');
    expect(descriptor?.capabilities).toEqual(['live-tv']);
    expect(descriptor?.supportedMediaKinds).toEqual([]);
    expect(descriptor?.stream).toBeUndefined();
    expect(descriptor?.liveTv).toEqual({
      catalogs: [{ type: 'channel', id: 'all', name: 'All' }],
      streamTypes: ['channel'],
    });
  });

  it('keeps movie/series and Live TV capability on mixed providers', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const descriptor = parseStremioManifest?.({
      id: 'org.example.mixed',
      name: 'Mixed',
      version: '1.0.0',
      types: ['movie', 'series', 'channel'],
      idPrefixes: ['tt'],
      catalogs: [{ type: 'channel', id: 'all', name: 'All' }],
      resources: [
        { name: 'catalog', types: ['channel'] },
        { name: 'stream', types: ['movie', 'series', 'channel'], idPrefixes: ['tt'] },
      ],
    }, 'https://example.com/manifest.json');
    expect(descriptor?.capabilities).toEqual(['stream', 'live-tv']);
    expect(descriptor?.supportedMediaKinds).toEqual(['movie', 'series']);
    expect(descriptor?.stream?.types).toEqual(['movie', 'series']);
    expect(descriptor?.liveTv?.streamTypes).toEqual(['channel']);
  });

  it('does not invent movie/series support from a channel-only scoped stream resource', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const descriptor = parseStremioManifest?.({
      id: 'org.example.channel-only-stream',
      name: 'Channel Only Stream',
      version: '1.0.0',
      types: ['movie', 'series', 'channel'],
      idPrefixes: ['tt'],
      catalogs: [{ type: 'channel', id: 'all', name: 'All' }],
      resources: [
        { name: 'catalog', types: ['channel'] },
        { name: 'stream', types: ['channel'] },
      ],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.capabilities).toEqual(['live-tv']);
    expect(descriptor?.supportedMediaKinds).toEqual([]);
    expect(descriptor?.stream).toBeUndefined();
  });

  it('normalizes config field type casing from loose manifests', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      config: [
        { key: 'token', type: ' PASSWORD ', required: true },
        { key: 'enabled', type: 'BOOLEAN' },
        { key: 'region', type: 'Select', options: ['fr', 'en'] },
      ],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.configurationFields).toEqual([
      expect.objectContaining({ key: 'token', type: 'secret' }),
      expect.objectContaining({ key: 'enabled', type: 'boolean' }),
      expect.objectContaining({ key: 'region', type: 'select' }),
    ]);
  });

  it('maps manifest config fields and detects required configuration', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    expect(parseStremioManifest).toBeDefined();
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      behaviorHints: { configurable: true, configurationRequired: true },
      config: [
        { key: 'region', type: 'select', title: 'Region', options: ['fr', 'al'], required: false },
        { key: 'token', type: 'password', title: 'Access token', required: true },
        { key: 'enabled', type: 'checkbox', title: 'Enabled' },
      ],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.requiresConfiguration).toBe(true);
    expect(descriptor?.configurationFields).toEqual([
      expect.objectContaining({ key: 'region', type: 'select', secret: false, required: false }),
      expect.objectContaining({ key: 'token', type: 'secret', secret: true, required: true }),
      expect.objectContaining({ key: 'enabled', type: 'boolean', secret: false, required: false }),
    ]);
  });

  it('collapses duplicate config keys and lets secret declarations win', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      config: [
        {
          key: 'credential',
          type: 'text',
          title: 'Credential',
          required: false,
          default: 'must-not-survive',
        },
        {
          key: 'credential',
          type: 'password',
          title: 'Private credential',
          required: true,
        },
      ],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.configurationFields).toEqual([
      expect.objectContaining({
        key: 'credential',
        type: 'secret',
        secret: true,
        required: true,
      }),
    ]);
    expect(descriptor?.configurationFields[0]).not.toHaveProperty(
      'defaultValue',
    );
  });

  it('accepts a Nuvio-style movie/series catalog manifest with meta and defaults', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const descriptor = parseStremioManifest?.({
      id: 'com.nuvio.tmdb.catalogs',
      name: 'Nuvio Catalog Addon',
      version: '1.2.0',
      resources: [
        'catalog',
        { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] },
      ],
      types: ['movie', 'series'],
      catalogs: [
        { type: 'movie', id: 'trending-movies', name: 'Trending Movies', extra: [{ name: 'skip', isRequired: false }] },
        { type: 'series', id: 'trending-series', name: 'Trending Series', extra: [{ name: 'skip', isRequired: false }] },
        { type: 'movie', id: 'popular-movies', name: 'Popular Movies', extra: [{ name: 'search', isRequired: false }] },
      ],
      config: [
        { key: 'language', type: 'text', title: 'Language locale', default: 'en-US', required: true },
        { key: 'region', type: 'text', title: 'Region', default: 'US', required: true },
      ],
      behaviorHints: { configurable: true },
    }, 'https://catalog.nuvio.tv/manifest.json');

    expect(descriptor?.capabilities).toEqual(['catalog']);
    expect(descriptor?.supportedMediaKinds).toEqual(['movie', 'series']);
    expect(descriptor?.requiresConfiguration).toBe(false);
    expect(descriptor?.catalog?.meta).toEqual({
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tmdb:'],
    });
    expect(descriptor?.catalog?.catalogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'movie', id: 'trending-movies', name: 'Trending Movies' }),
      expect.objectContaining({ type: 'series', id: 'trending-series', name: 'Trending Series' }),
    ]));
    expect(descriptor?.configurationFields).toEqual([
      expect.objectContaining({ key: 'language', defaultValue: 'en-US', required: true }),
      expect.objectContaining({ key: 'region', defaultValue: 'US', required: true }),
    ]);
  });

  it('recognizes loose TV manifests with normalized resource casing', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'org.example.loose-tv',
      name: 'Loose TV',
      version: '1.0.0',
      types: [' TV '],
      catalogs: [{ id: 'all', name: 'All Channels' }],
      resources: ['catalog', 'stream'],
    }, 'https://tv.example/manifest.json');

    expect(descriptor?.capabilities).toContain('live-tv');
    expect(descriptor?.liveTv).toEqual({
      catalogs: [{ type: 'tv', id: 'all', name: 'All Channels' }],
      streamTypes: ['tv'],
    });
  });

  it('infers a missing movie catalog type from a single global media type', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'org.example.loose-movie-catalog',
      name: 'Loose Movie Catalog',
      version: '1.0.0',
      types: ['movie'],
      resources: ['catalog', 'meta'],
      catalogs: [
        { id: 'popular', name: 'Popular' },
      ],
    }, 'https://catalog.example/manifest.json');

    expect(descriptor?.catalog?.catalogs).toEqual([
      expect.objectContaining({
        type: 'movie',
        id: 'popular',
      }),
    ]);
  });

  it('does not infer over an explicit unsupported catalog type', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    expect(() => parseStremioManifest?.({
      id: 'org.example.bad-catalog-type',
      name: 'Bad Catalog Type',
      version: '1.0.0',
      types: ['movie'],
      resources: ['catalog'],
      catalogs: [
        { type: 'channel', id: 'all', name: 'Wrong' },
      ],
    }, 'https://catalog.example/manifest.json')).toThrow('capability');
  });

  it('supports string-form meta resources for catalog providers', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'org.example.catalog-meta-string',
      name: 'Catalog Meta String',
      version: '1.0.0',
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      resources: ['catalog', 'meta'],
      catalogs: [
        { type: 'movie', id: 'popular', name: 'Popular' },
      ],
    }, 'https://catalog.example/manifest.json');

    expect(descriptor?.catalog?.meta).toEqual({
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
    });
  });

  it('normalizes loose movie and series type casing in manifests', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'org.example.loose-media-types',
      name: 'Loose Media Types',
      version: '1.0.0',
      types: [' Movie ', 'SERIES', 'movie'],
      idPrefixes: ['tt'],
      resources: [
        { name: 'stream', types: [' MOVIE ', 'Series'] },
        'catalog',
        'meta',
      ],
      catalogs: [
        { type: ' MOVIE ', id: 'movies', name: 'Movies' },
        { type: 'SERIES', id: 'series', name: 'Series' },
      ],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.stream?.types).toEqual(['movie', 'series']);
    expect(descriptor?.supportedMediaKinds).toEqual(['movie', 'series']);
    expect(descriptor?.catalog?.catalogs).toEqual([
      expect.objectContaining({ type: 'movie', id: 'movies' }),
      expect.objectContaining({ type: 'series', id: 'series' }),
    ]);
  });

  it('normalizes Stremio resource names with loose casing and whitespace', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'org.example.loose-resources',
      name: 'Loose Resources',
      version: '1.0.0',
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      resources: [
        ' STREAM ',
        { name: ' SUBTITLES ', types: ['movie'] },
        ' CATALOG ',
        ' META ',
      ],
      catalogs: [
        { type: 'movie', id: 'popular', name: 'Popular' },
      ],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.capabilities).toEqual(
      expect.arrayContaining(['stream', 'subtitle', 'catalog']),
    );
    expect(descriptor?.stream).toEqual({
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
    });
    expect(descriptor?.subtitle).toEqual({
      types: ['movie'],
      idPrefixes: ['tt'],
    });
    expect(descriptor?.catalog?.meta).toEqual({
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
    });
  });

  it('parses the installed-catalog shape used by Nuvio-style TMDB manifests', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'com.example.tmdb.catalogs',
      version: '1.0.0',
      name: 'TMDB Catalogs',
      resources: [
        'catalog',
        {
          name: 'meta',
          types: ['movie', 'series'],
          idPrefixes: ['tt', 'tmdb:'],
        },
      ],
      types: ['movie', 'series'],
      catalogs: [
        {
          type: 'movie',
          id: 'trending-movies',
          name: 'Trending Movies',
          extra: [
            { name: 'skip', isRequired: false },
            {
              name: 'genre',
              isRequired: false,
              options: ['Action', 'Drama'],
              optionsLimit: 1,
            },
          ],
        },
        {
          type: 'series',
          id: 'popular-series',
          name: 'Popular Series',
          extra: [
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false },
          ],
        },
      ],
      behaviorHints: {
        configurable: false,
        adult: false,
        p2p: false,
      },
    }, 'https://catalog.example/manifest.json');

    expect(descriptor?.capabilities).toEqual(['catalog']);
    expect(descriptor?.supportedMediaKinds).toEqual([
      'movie',
      'series',
    ]);
    expect(descriptor?.catalog?.meta).toEqual({
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tmdb:'],
    });
    expect(descriptor?.catalog?.catalogs).toEqual([
      expect.objectContaining({
        type: 'movie',
        id: 'trending-movies',
        extra: [
          expect.objectContaining({ name: 'skip' }),
          expect.objectContaining({
            name: 'genre',
            options: ['Action', 'Drama'],
          }),
        ],
      }),
      expect.objectContaining({
        type: 'series',
        id: 'popular-series',
      }),
    ]);
  });

  it('infers string-form stream and meta types from typed catalogs', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');

    const descriptor = parseStremioManifest?.({
      id: 'org.example.catalog-typed-resources',
      name: 'Catalog Typed Resources',
      version: '1.0.0',
      resources: ['catalog', 'meta', 'stream'],
      catalogs: [
        { type: 'movie', id: 'movies', name: 'Movies' },
        { type: 'series', id: 'series', name: 'Series' },
      ],
      idPrefixes: ['tt', 'tmdb:'],
    }, 'https://example.com/manifest.json');

    expect(descriptor?.stream?.types).toEqual(['movie', 'series']);
    expect(descriptor?.catalog?.meta?.types).toEqual(['movie', 'series']);
    expect(descriptor?.supportedMediaKinds).toEqual(['movie', 'series']);
  });

  it('supports string-form stream resources using global types and prefixes', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    expect(parseStremioManifest).toBeDefined();
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      resources: ['stream'],
      idPrefixes: ['tt'],
    }, 'https://example.com/manifest.json');
    expect(descriptor?.stream).toEqual({ types: ['movie', 'series'], idPrefixes: ['tt'] });
  });

  it('bounds untrusted manifest identity and configuration fields', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const config = Array.from({ length: 250 }, (_, index) => ({
      key: `field-${index}`,
      type: 'text',
      title: `Field ${index}`,
    }));

    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      logo: 'javascript:alert(1)',
      description: 'x'.repeat(5_000),
      config,
    }, 'https://example.com/manifest.json');

    expect(descriptor?.configurationFields).toHaveLength(200);
    expect(descriptor?.logoUrl).toBeUndefined();
    expect(descriptor?.description).toBeUndefined();

    expect(() => parseStremioManifest?.({
      ...streamManifest,
      id: 'x'.repeat(513),
    }, 'https://example.com/manifest.json')).toThrow(
      'missing or invalid id',
    );
  });

  it('rejects malformed or unsupported manifests', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    expect(parseStremioManifest).toBeDefined();
    expect(() => parseStremioManifest?.({}, 'https://example.com/manifest.json')).toThrow();
    expect(() => parseStremioManifest?.({ ...streamManifest, resources: ['catalog'] }, 'https://example.com/manifest.json')).toThrow('capability');
  });
});

describe('Stremio stream request mapping', () => {
  it('maps IMDb movies to the protocol stream route', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');
    expect(parseStremioManifest).toBeDefined();
    expect(toStremioStreamRequest).toBeDefined();
    const descriptor = parseStremioManifest?.(streamManifest, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    })).toEqual({
      type: 'movie',
      id: 'tt0137523',
      path: '/stream/movie/tt0137523.json',
    });
  });

  it('maps IMDb episodes to the series video ID convention', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');
    expect(parseStremioManifest).toBeDefined();
    expect(toStremioStreamRequest).toBeDefined();
    const descriptor = parseStremioManifest?.(streamManifest, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { imdb: 'tt0944947', tmdb: '1399' },
      seasonNumber: 1,
      episodeNumber: 2,
    })).toEqual({
      type: 'series',
      id: 'tt0944947:1:2',
      path: '/stream/series/tt0944947%3A1%3A2.json',
    });
  });

  it('keeps legacy first-choice TMDB routes while exposing type-qualified fallback routes', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    const toStremioStreamRequests = fn<
      (descriptor: any, request: any) => any[]
    >('toStremioStreamRequests');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tmdb:'],
      resources: [{
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['tmdb:'],
      }],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequests?.(descriptor, {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    }).map((request) => request.path)).toEqual([
      '/stream/movie/tmdb%3A550.json',
      '/stream/movie/tmdb%3Amovie%3A550.json',
    ]);

    expect(toStremioStreamRequests?.(descriptor, {
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { tmdb: '1399' },
      seasonNumber: 2,
      episodeNumber: 3,
    }).map((request) => request.path)).toEqual([
      '/stream/series/tmdb%3A1399%3A2%3A3.json',
      '/stream/series/tmdb%3Aseries%3A1399%3A2%3A3.json',
    ]);
  });

  it('maps TMDB-only movies and episodes when the provider declares tmdb: IDs', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tmdb:'],
      resources: [
        { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tmdb:'] },
      ],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    })).toEqual({
      type: 'movie',
      id: 'tmdb:550',
      path: '/stream/movie/tmdb%3A550.json',
    });

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'tmdb:series:1399:1:2',
      kind: 'episode',
      externalIds: { tmdb: '1399' },
      seasonNumber: 1,
      episodeNumber: 2,
    })).toEqual({
      type: 'series',
      id: 'tmdb:1399:1:2',
      path: '/stream/series/tmdb%3A1399%3A1%3A2.json',
    });
  });

  it('maps type-qualified TMDB movie and series prefixes', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');

    const movieDescriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tmdb:movie:'],
      resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tmdb:movie:'] }],
    }, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(movieDescriptor, {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    })).toEqual({
      type: 'movie',
      id: 'tmdb:movie:550',
      path: '/stream/movie/tmdb%3Amovie%3A550.json',
    });

    const seriesDescriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tmdb:series:'],
      resources: [{ name: 'stream', types: ['series'], idPrefixes: ['tmdb:series:'] }],
    }, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(seriesDescriptor, {
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { tmdb: '1399' },
      seasonNumber: 2,
      episodeNumber: 3,
    })).toEqual({
      type: 'series',
      id: 'tmdb:series:1399:2:3',
      path: '/stream/series/tmdb%3Aseries%3A1399%3A2%3A3.json',
    });
  });

  it('deduplicates equivalent Stremio IDs regardless of case', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    const toStremioStreamRequests = fn<
      (descriptor: any, request: any) => any[]
    >('toStremioStreamRequests');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tt'],
      resources: [{
        name: 'stream',
        types: ['movie'],
        idPrefixes: ['tt'],
      }],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequests?.(descriptor, {
      mediaId: 'stremio-catalog:movie:tt1234567',
      kind: 'movie',
      externalIds: { imdb: 'TT1234567' },
    }).map((request) => request.id)).toEqual([
      'tt1234567',
    ]);
  });

  it('exposes bounded fallback IDs when a provider accepts IMDb and TMDB', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    const toStremioStreamRequests = fn<
      (descriptor: any, request: any) => any[]
    >('toStremioStreamRequests');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['TT', 'TMDB:'],
      resources: [{
        name: 'stream',
        types: ['movie'],
        idPrefixes: ['TT', 'TMDB:'],
      }],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequests?.(descriptor, {
      mediaId: 'movie:550',
      kind: 'movie',
      externalIds: {
        imdb: 'tt0137523',
        tmdb: '550',
      },
    }).map((request) => request.id)).toEqual([
      'tt0137523',
      'tmdb:550',
      'tmdb:movie:550',
    ]);
  });

  it('prefers IMDb when a provider accepts both IMDb and TMDB IDs', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tt', 'tmdb:'],
      resources: [
        { name: 'stream', types: ['movie'], idPrefixes: ['tt', 'tmdb:'] },
      ],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    })?.id).toBe('tt0137523');
  });

  it('recovers IMDb and TMDB IDs from well-formed catalog media IDs', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');

    const imdbDescriptor = parseStremioManifest?.(streamManifest, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(imdbDescriptor, {
      mediaId: 'cinemeta:movie:tt0137523',
      kind: 'movie',
      externalIds: {},
    })?.id).toBe('tt0137523');

    const tmdbDescriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['tmdb:'],
      resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tmdb:'] }],
    }, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(tmdbDescriptor, {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: {},
    })?.id).toBe('tmdb:550');
  });

  it('does not infer provider routes from non-Stremio lookalike media IDs', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    const toStremioStreamRequest = fn<
      (descriptor: any, request: any) => any
    >('toStremioStreamRequest');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['custom:'],
      resources: [{
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['custom:'],
      }],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'local:movie:custom%3A42',
      kind: 'movie',
      externalIds: {},
    })).toBeNull();

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'episode:1',
      seriesMediaId: 'local:series:custom%3Ashow-42',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: 2,
    })).toBeNull();
  });

  it('uses catalog-native movie and series IDs when standardized IDs are absent', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    const toStremioStreamRequest = fn<
      (descriptor: any, request: any) => any
    >('toStremioStreamRequest');
    const descriptor = parseStremioManifest?.({
      ...streamManifest,
      idPrefixes: ['custom:'],
      resources: [{
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['custom:'],
      }],
    }, 'https://example.com/manifest.json');

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'stremio-catalog:movie:custom%3A42',
      kind: 'movie',
      externalIds: {},
    })).toEqual({
      type: 'movie',
      id: 'custom:42',
      path: '/stream/movie/custom%3A42.json',
    });

    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'episode:1',
      seriesMediaId: 'stremio-catalog:series:custom%3Ashow-42',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 2,
      episodeNumber: 3,
    })).toEqual({
      type: 'series',
      id: 'custom:show-42:2:3',
      path: '/stream/series/custom%3Ashow-42%3A2%3A3.json',
    });
  });

  it('does not guess an ID when the manifest requires IMDb and none is available', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');
    expect(parseStremioManifest).toBeDefined();
    expect(toStremioStreamRequest).toBeDefined();
    const descriptor = parseStremioManifest?.(streamManifest, 'https://example.com/manifest.json');
    expect(toStremioStreamRequest?.(descriptor, {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    })).toBeNull();
  });
});


describe('Stremio subtitle request mapping', () => {
  const subtitleManifest = {
    id: 'org.example.subtitles',
    name: 'Example Subtitles',
    version: '1.0.0',
    resources: [{ name: 'subtitles', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
  };

  it('maps IMDb movies and episodes to subtitle routes', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioSubtitleRequest = fn<(descriptor: any, request: any) => any>('toStremioSubtitleRequest');
    const descriptor = parseStremioManifest?.(subtitleManifest, 'https://subs.example/manifest.json');

    expect(toStremioSubtitleRequest?.(descriptor, {
      mediaId: 'movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    })).toEqual({
      type: 'movie',
      id: 'tt0137523',
      path: '/subtitles/movie/tt0137523.json',
    });

    expect(toStremioSubtitleRequest?.(descriptor, {
      mediaId: 'episode:1',
      kind: 'episode',
      externalIds: { imdb: 'tt0944947' },
      seasonNumber: 2,
      episodeNumber: 3,
    })).toEqual({
      type: 'series',
      id: 'tt0944947:2:3',
      path: '/subtitles/series/tt0944947%3A2%3A3.json',
    });
  });

  it('maps type-qualified TMDB subtitle prefixes', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioSubtitleRequest = fn<(descriptor: any, request: any) => any>('toStremioSubtitleRequest');
    const descriptor = parseStremioManifest?.({
      ...subtitleManifest,
      idPrefixes: ['tmdb:series:'],
      resources: [
        { name: 'subtitles', types: ['series'], idPrefixes: ['tmdb:series:'] },
      ],
    }, 'https://subs.example/manifest.json');

    expect(toStremioSubtitleRequest?.(descriptor, {
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { tmdb: '1399' },
      seasonNumber: 1,
      episodeNumber: 4,
    })).toEqual({
      type: 'series',
      id: 'tmdb:series:1399:1:4',
      path: '/subtitles/series/tmdb%3Aseries%3A1399%3A1%3A4.json',
    });
  });

  it('maps catalog-native subtitle IDs without IMDb or TMDB metadata', () => {
    const parseStremioManifest = fn<
      (payload: unknown, manifestUrl: string) => any
    >('parseStremioManifest');
    const toStremioSubtitleRequest = fn<
      (descriptor: any, request: any) => any
    >('toStremioSubtitleRequest');
    const descriptor = parseStremioManifest?.({
      ...subtitleManifest,
      idPrefixes: ['custom:'],
      resources: [{
        name: 'subtitles',
        types: ['movie', 'series'],
        idPrefixes: ['custom:'],
      }],
    }, 'https://subs.example/manifest.json');

    expect(toStremioSubtitleRequest?.(descriptor, {
      mediaId: 'stremio-custom:movie:custom%3A42',
      kind: 'movie',
      externalIds: {},
    })).toEqual({
      type: 'movie',
      id: 'custom:42',
      path: '/subtitles/movie/custom%3A42.json',
    });

    expect(toStremioSubtitleRequest?.(descriptor, {
      mediaId: 'custom:episode:1',
      seriesMediaId: 'stremio-custom:series:custom%3Ashow-42',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: 2,
    })).toEqual({
      type: 'series',
      id: 'custom:show-42:1:2',
      path: '/subtitles/series/custom%3Ashow-42%3A1%3A2.json',
    });
  });

  it('maps TMDB subtitles when the subtitle provider declares tmdb: support', () => {
    const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
    const toStremioSubtitleRequest = fn<(descriptor: any, request: any) => any>('toStremioSubtitleRequest');
    const descriptor = parseStremioManifest?.({
      ...subtitleManifest,
      idPrefixes: ['tmdb:'],
      resources: [
        { name: 'subtitles', types: ['movie'], idPrefixes: ['tmdb:'] },
      ],
    }, 'https://subs.example/manifest.json');

    expect(toStremioSubtitleRequest?.(descriptor, {
      mediaId: 'movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    })).toEqual({
      type: 'movie',
      id: 'tmdb:550',
      path: '/subtitles/movie/tmdb%3A550.json',
    });

    const seriesDescriptor = parseStremioManifest?.({
      ...subtitleManifest,
      idPrefixes: ['tmdb:'],
      resources: [
        { name: 'subtitles', types: ['series'], idPrefixes: ['tmdb:'] },
      ],
    }, 'https://subs.example/manifest.json');

    expect(toStremioSubtitleRequest?.(seriesDescriptor, {
      mediaId: 'tmdb:series:1399:2:3',
      kind: 'episode',
      externalIds: { tmdb: '1399' },
      seasonNumber: 2,
      episodeNumber: 3,
    })).toEqual({
      type: 'series',
      id: 'tmdb:1399:2:3',
      path: '/subtitles/series/tmdb%3A1399%3A2%3A3.json',
    });
  });
});


test('parses URL and secret config field variants', () => {
  const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
  const descriptor = parseStremioManifest?.({
    ...streamManifest,
    config: [
      { key: 'endpoint', type: 'url', title: 'Endpoint', required: false },
      { key: 'accessToken', type: 'secret', title: 'Access token', required: true },
    ],
  }, 'https://example.com/manifest.json');

  expect(descriptor?.configurationFields).toEqual([
    expect.objectContaining({ key: 'endpoint', type: 'url', secret: false }),
    expect.objectContaining({ key: 'accessToken', type: 'secret', secret: true }),
  ]);
});


test('maps season zero Stremio episode stream routes', () => {
  const parseStremioManifest = fn<(payload: unknown, manifestUrl: string) => any>('parseStremioManifest');
  const toStremioStreamRequest = fn<(descriptor: any, request: any) => any>('toStremioStreamRequest');
  const descriptor = parseStremioManifest?.(
    streamManifest,
    'https://example.com/manifest.json',
  );

  expect(toStremioStreamRequest?.(descriptor, {
    mediaId: 'episode:special-1',
    kind: 'episode',
    externalIds: { imdb: 'tt0944947' },
    seasonNumber: 0,
    episodeNumber: 1,
  })).toEqual({
    type: 'series',
    id: 'tt0944947:0:1',
    path: '/stream/series/tt0944947%3A0%3A1.json',
  });
});


test('rejects oversized Stremio playback identifiers before route encoding', () => {
  const parseStremioManifest = fn<
    (payload: unknown, manifestUrl: string) => any
  >('parseStremioManifest');
  const toStremioStreamRequest = fn<
    (descriptor: any, request: any) => any
  >('toStremioStreamRequest');
  const descriptor = parseStremioManifest?.(
    streamManifest,
    'https://example.com/manifest.json',
  );

  expect(toStremioStreamRequest?.(descriptor, {
    mediaId: `cinemeta:movie:tt${'1'.repeat(40)}`,
    kind: 'movie',
    externalIds: {
      imdb: `tt${'1'.repeat(40)}`,
    },
  })).toBeNull();

  expect(toStremioStreamRequest?.(descriptor, {
    mediaId: 'x'.repeat(2_049),
    kind: 'movie',
    externalIds: {},
  })).toBeNull();
});

test('bounds Stremio episode coordinates while preserving season zero', () => {
  const parseStremioManifest = fn<
    (payload: unknown, manifestUrl: string) => any
  >('parseStremioManifest');
  const toStremioStreamRequest = fn<
    (descriptor: any, request: any) => any
  >('toStremioStreamRequest');
  const descriptor = parseStremioManifest?.(
    streamManifest,
    'https://example.com/manifest.json',
  );
  const request = {
    mediaId: 'episode:special',
    kind: 'episode',
    externalIds: { imdb: 'tt0944947' },
  };

  expect(toStremioStreamRequest?.(descriptor, {
    ...request,
    seasonNumber: 0,
    episodeNumber: 1,
  })?.id).toBe('tt0944947:0:1');

  expect(toStremioStreamRequest?.(descriptor, {
    ...request,
    seasonNumber: 10_001,
    episodeNumber: 1,
  })).toBeNull();

  expect(toStremioStreamRequest?.(descriptor, {
    ...request,
    seasonNumber: 1,
    episodeNumber: 100_001,
  })).toBeNull();

  expect(toStremioStreamRequest?.(descriptor, {
    ...request,
    seasonNumber: 1,
    episodeNumber: 0,
  })).toBeNull();
});


test('treats token-like text config fields as secrets and drops defaults', () => {
  const parseStremioManifest = fn<
    (payload: unknown, manifestUrl: string) => any
  >('parseStremioManifest');
  const descriptor = parseStremioManifest?.({
    ...streamManifest,
    config: [{
      key: 'accessToken',
      type: 'text',
      title: 'Access token',
      required: true,
      default: 'LOCAL-SECRET',
    }],
  }, 'https://example.com/manifest.json');

  expect(descriptor?.configurationFields).toEqual([
    expect.objectContaining({
      key: 'accessToken',
      type: 'secret',
      secret: true,
      required: true,
    }),
  ]);
  expect(descriptor?.configurationFields[0]).not.toHaveProperty(
    'defaultValue',
  );
});


test('drops credential-bearing non-secret manifest defaults', () => {
  const parseStremioManifest = fn<
    (payload: unknown, manifestUrl: string) => any
  >('parseStremioManifest');
  const descriptor = parseStremioManifest?.({
    ...streamManifest,
    config: [
      {
        key: 'endpoint',
        type: 'url',
        title: 'Endpoint',
        default:
          'https://api.example/config?token=LOCAL-SECRET',
      },
      {
        key: 'note',
        type: 'text',
        title: 'Note',
        default: 'secret=LOCAL-PLAIN',
      },
      {
        key: 'alternateEndpoint',
        type: 'url',
        title: 'Alternate endpoint',
        default: 'https://api.example/token=fixture-value/config',
      },
      {
        key: 'region',
        type: 'text',
        title: 'Region',
        default: 'fr',
      },
    ],
  }, 'https://example.com/manifest.json');

  expect(descriptor?.configurationFields).toEqual([
    expect.not.objectContaining({ defaultValue: expect.anything() }),
    expect.not.objectContaining({ defaultValue: expect.anything() }),
    expect.not.objectContaining({ defaultValue: expect.anything() }),
    expect.objectContaining({ key: 'region', defaultValue: 'fr' }),
  ]);
  expect(JSON.stringify(descriptor)).not.toContain('LOCAL-SECRET');
  expect(JSON.stringify(descriptor)).not.toContain('LOCAL-PLAIN');
});


test('malformed request protocol metadata returns no routes instead of throwing', () => {
  const toStremioStreamRequests = fn<any>('toStremioStreamRequests');
  const toStremioSubtitleRequests = fn<any>('toStremioSubtitleRequests');
  expect(toStremioStreamRequests).toBeDefined();
  expect(toStremioSubtitleRequests).toBeDefined();

  const baseDescriptor = {
    id: 'org.example.malformed',
    name: 'Malformed',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream', 'subtitle'],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie'],
  };
  const request = {
    mediaId: 'movie:550',
    kind: 'movie',
    externalIds: { imdb: 'tt0137523' },
  };

  expect(() => toStremioStreamRequests?.({
    ...baseDescriptor,
    stream: {
      types: ['movie'],
      idPrefixes: { broken: true },
    },
  }, request)).not.toThrow();
  expect(toStremioStreamRequests?.({
    ...baseDescriptor,
    stream: {
      types: ['movie'],
      idPrefixes: { broken: true },
    },
  }, request)).toEqual([]);

  expect(() => toStremioSubtitleRequests?.({
    ...baseDescriptor,
    subtitle: {
      types: null,
      idPrefixes: ['tt'],
    },
  }, request)).not.toThrow();
  expect(toStremioSubtitleRequests?.({
    ...baseDescriptor,
    subtitle: {
      types: null,
      idPrefixes: ['tt'],
    },
  }, request)).toEqual([]);

  expect(toStremioStreamRequests?.({
    ...baseDescriptor,
    stream: {
      types: ['movie'],
      idPrefixes: [123],
    },
  }, request)).toEqual([]);
});
