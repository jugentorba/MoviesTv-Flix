import {
  liveTvCatalogRequestPath,
  liveTvStreamRequestPath,
  parseLiveTvCapability,
  parseLiveTvCatalog,
} from '../stremio';

const manifest = {
  id: 'org.example.tv',
  name: 'Example TV',
  version: '1.0.0',
  types: ['channel'],
  catalogs: [{ type: 'channel', id: 'all', name: 'All Channels' }],
  resources: [
    { name: 'catalog', types: ['channel'] },
    { name: 'stream', types: ['channel'] },
  ],
};

describe('Live TV manifest capability', () => {
  test('keeps only catalogs that are both catalogued and streamable', () => {
    expect(parseLiveTvCapability(manifest)).toEqual({
      catalogs: [{ type: 'channel', id: 'all', name: 'All Channels' }],
      streamTypes: ['channel'],
    });
    expect(parseLiveTvCapability({ ...manifest, resources: ['catalog'] })).toBeNull();
  });

  test('infers a missing catalog type when the manifest declares one Live TV type', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      types: ['tv'],
      catalogs: [{ id: 'all', name: 'All TV' }],
      resources: ['catalog', 'stream'],
    })).toEqual({
      catalogs: [{ type: 'tv', id: 'all', name: 'All TV' }],
      streamTypes: ['tv'],
    });
  });

  test('does not infer over an explicit unsupported catalog type', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      types: ['tv'],
      catalogs: [{ type: 'movie', id: 'all', name: 'Wrong' }],
      resources: ['catalog', 'stream'],
    })).toBeNull();
  });

  test('infers string resource types from typed TV catalogs when global types are absent', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      types: undefined,
      catalogs: [
        { type: 'channel', id: 'all', name: 'All Channels' },
      ],
      resources: ['catalog', 'stream'],
    })).toEqual({
      catalogs: [
        { type: 'channel', id: 'all', name: 'All Channels' },
      ],
      streamTypes: ['channel'],
    });
  });

  test('infers object resource types from typed TV catalogs when scoped types are absent', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      types: undefined,
      catalogs: [
        { type: 'tv', id: 'all', name: 'All TV' },
      ],
      resources: [
        { name: 'catalog' },
        { name: 'stream' },
      ],
    })).toEqual({
      catalogs: [
        { type: 'tv', id: 'all', name: 'All TV' },
      ],
      streamTypes: ['tv'],
    });
  });

  test('normalizes case and whitespace in Live TV resource names', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      resources: [
        ' CATALOG ',
        { name: ' STREAM ', types: ['CHANNEL'] },
      ],
    })).toEqual({
      catalogs: [{ type: 'channel', id: 'all', name: 'All Channels' }],
      streamTypes: ['channel'],
    });
  });

  test('normalizes case and whitespace in Live TV type declarations', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      types: [' TV ', 'CHANNEL'],
      catalogs: [
        { type: 'TV', id: 'all-tv', name: 'TV' },
        { type: ' channel ', id: 'all-channel', name: 'Channels' },
      ],
      resources: [
        { name: 'catalog', types: ['TV', 'CHANNEL'] },
        { name: 'stream', types: ['TV', 'CHANNEL'] },
      ],
    })).toEqual({
      catalogs: [
        { type: 'tv', id: 'all-tv', name: 'TV' },
        { type: 'channel', id: 'all-channel', name: 'Channels' },
      ],
      streamTypes: ['tv', 'channel'],
    });
  });



  test('preserves required Live TV catalog extras', () => {
    expect(parseLiveTvCapability({
      ...manifest,
      types: ['tv'],
      catalogs: [
        {
          type: 'tv',
          id: 'vavoo_tv_fr',
          name: 'France',
          extra: [
            { name: 'date', isRequired: false },
            { name: 'skip', isRequired: false },
          ],
        },
        {
          type: 'tv',
          id: 'vavoo_search_fr',
          name: 'Search France',
          extra: [
            { name: 'search', isRequired: true },
          ],
        },
      ],
      resources: ['catalog', 'stream'],
    })).toEqual({
      catalogs: [
        { type: 'tv', id: 'vavoo_tv_fr', name: 'France' },
        {
          type: 'tv',
          id: 'vavoo_search_fr',
          name: 'Search France',
          requiredExtras: ['search'],
        },
      ],
      streamTypes: ['tv'],
    });
  });

  test('encodes catalog and stream resource IDs', () => {
    expect(liveTvCatalogRequestPath({ type: 'channel', id: 'sports world' }))
      .toBe('/catalog/channel/sports%20world.json');
    expect(liveTvStreamRequestPath('channel', 'rtk 1')).toBe('/stream/channel/rtk%201.json');
  });
});

describe('Live TV catalog normalization', () => {
  test('infers country from catalog context or channel title when countryCode is missing', () => {
    const fromCatalog = parseLiveTvCatalog({
      metas: [{ id: 'top', type: 'channel', name: 'TOP CHANNEL' }],
    }, 'provider-a', 'channel', { catalogId: 'albania', catalogName: 'Albania' });
    expect(fromCatalog[0]).toEqual(expect.objectContaining({ countryCode: 'AL' }));

    const fromTitle = parseLiveTvCatalog({
      metas: [{ id: 'tf1', type: 'channel', name: 'TF1' }],
    }, 'provider-a', 'channel');
    expect(fromTitle[0]).toEqual(expect.objectContaining({ countryCode: 'FR' }));
  });



  test('classifies recognizable Kosovo channels inside a generic Balkans catalog', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        { id: 'rtv21', type: 'tv', name: 'RTV 21 HD' },
        { id: 'kanal10', type: 'tv', name: 'Kanal 10' },
        { id: 'generic', type: 'tv', name: 'Balkan Music' },
      ],
    }, 'tvvoo', 'tv', {
      catalogId: 'vavoo_tv_bk',
      catalogName: 'Balkans',
    });

    expect(channels[0]?.countryCode).toBe('XK');
    expect(channels[1]?.countryCode).toBe('XK');
    expect(channels[2]?.countryCode).toBeUndefined();
  });

  test('accepts loose top-level and channels Live TV payloads', () => {
    expect(parseLiveTvCatalog([
      { id: 'fr2', title: 'France 2' },
    ], 'provider-a', 'channel')).toEqual([
      expect.objectContaining({
        remoteId: 'fr2',
        title: 'France 2',
      }),
    ]);

    expect(parseLiveTvCatalog({
      channels: {
        id: 'rtk1',
        title: 'RTK 1',
        country: 'Kosovo',
      },
    }, 'provider-a', 'channel')).toEqual([
      expect.objectContaining({
        remoteId: 'rtk1',
        title: 'RTK 1',
        countryCode: 'XK',
      }),
    ]);
  });

  test('accepts catalog metas that omit type and use title instead of name', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        { id: 'fr2', title: 'France 2' },
        { id: 'rtk', type: ' CHANNEL ', title: 'RTK 1' },
        { id: 'wrong', type: 'movie', title: 'Wrong type' },
      ],
    }, 'provider-a', 'channel');

    expect(channels.map((channel) => channel.title)).toEqual([
      'France 2',
      'RTK 1',
    ]);
  });

  test('infers Kosovo when providers put KS in a generic country field', () => {
    const channels = parseLiveTvCatalog({
      metas: [{
        id: 'rtk-country',
        type: 'channel',
        name: 'RTK',
        country: 'KS',
      }],
    }, 'provider-a', 'channel');

    expect(channels[0]?.countryCode).toBe('XK');
  });

  test('normalizes common Kosovo and UK country codes and loose channel categories', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        {
          id: 'rtk',
          type: 'channel',
          name: 'RTK 1',
          country_code: 'ks',
          genre: 'News|Kosovo',
        },
        {
          id: 'bbc',
          type: 'channel',
          name: 'BBC One',
          countryCode: 'uk',
          category: 'General;Entertainment',
        },
      ],
    }, 'provider-a', 'channel');

    expect(channels[0]).toEqual(expect.objectContaining({
      countryCode: 'XK',
      genres: ['News', 'Kosovo'],
    }));
    expect(channels[1]).toEqual(expect.objectContaining({
      countryCode: 'GB',
      genres: ['General', 'Entertainment'],
    }));
  });

  test('accepts snake_case country codes and alternate logo fields', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        {
          id: 'one',
          type: 'channel',
          name: 'One',
          country_code: ' fr ',
          logo: 'https://img.example/one.png',
        },
        {
          id: 'two',
          type: 'channel',
          name: 'Two',
          posterUrl: 'https://img.example/two.png',
        },
      ],
    }, 'provider-a', 'channel');

    expect(channels[0]).toEqual(expect.objectContaining({
      countryCode: 'FR',
      posterUrl: 'https://img.example/one.png',
    }));
    expect(channels[1]).toEqual(expect.objectContaining({
      posterUrl: 'https://img.example/two.png',
    }));
  });

  test('drops credential-bearing Live TV artwork fragments', () => {
    const channels = parseLiveTvCatalog({
      metas: [{
        id: 'secret-fragment',
        type: 'channel',
        name: 'Secret Fragment',
        poster: 'https://img.example/poster.png#token=LOCAL-SECRET',
      }],
    }, 'provider-a', 'channel');

    expect(channels).toEqual([
      expect.objectContaining({
        id: 'provider-a:channel:secret-fragment',
        title: 'Secret Fragment',
      }),
    ]);
    expect(channels[0]).not.toHaveProperty('posterUrl');
  });

  test('drops credential-bearing Live TV artwork path segments', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        {
          id: 'path-secret',
          type: 'channel',
          name: 'Path Secret',
          poster: 'https://img.example/token=LOCAL-SECRET/poster.png',
        },
        {
          id: 'ordinary-secret-word',
          type: 'channel',
          name: 'Ordinary Artwork',
          poster: 'https://img.example/secret-garden/poster.png',
        },
      ],
    }, 'provider-a', 'channel');

    expect(channels[0]).not.toHaveProperty('posterUrl');
    expect(channels[1]?.posterUrl).toBe(
      'https://img.example/secret-garden/poster.png',
    );
  });

  test('normalizes metadata only and drops duplicates or unsafe fields', () => {
    const channels = parseLiveTvCatalog({ metas: [
      {
        id: 'rtk1',
        type: 'channel',
        name: 'RTK 1',
        countryCode: 'xk',
        poster: 'https://img.example/rtk1.png',
        streamUrl: 'https://must-not-copy.example/live.m3u8',
      },
      { id: 'rtk1', type: 'channel', name: 'Duplicate' },
      {
        id: 'fr2',
        type: 'channel',
        name: 'France 2',
        countryCode: 'FR',
        poster: 'https://user:pass@img.example/fr2.png',
      },
      {
        id: 'secret-poster',
        type: 'channel',
        name: 'Secret Poster',
        poster: 'https://img.example/poster.png?token=LOCAL-SECRET',
      },
      { id: '', type: 'channel', name: 'Invalid' },
    ] }, 'provider-a', 'channel');

    expect(channels).toHaveLength(3);
    expect(channels[0]).toEqual({
      id: 'provider-a:channel:rtk1',
      providerId: 'provider-a',
      remoteId: 'rtk1',
      resourceType: 'channel',
      title: 'RTK 1',
      posterUrl: 'https://img.example/rtk1.png',
      countryCode: 'XK',
    });
    expect(channels[0]).not.toHaveProperty('streamUrl');
    expect(channels[1]).not.toHaveProperty('posterUrl');
    expect(channels[2]).toEqual(expect.objectContaining({
      id: 'provider-a:channel:secret-poster',
      title: 'Secret Poster',
    }));
    expect(channels[2]).not.toHaveProperty('posterUrl');
  });


  test('enriches repeated channel identities without replacing the first title', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        {
          id: 'rtk1',
          type: 'channel',
          name: 'RTK 1',
          genres: ['News'],
        },
        {
          id: 'rtk1',
          type: 'channel',
          name: 'Duplicate title',
          countryCode: 'xk',
          poster: 'https://img.example/rtk1.png',
          genres: ['news', 'Kosovo', 'Sports'],
        },
      ],
    }, 'provider-a', 'channel');

    expect(channels).toEqual([
      {
        id: 'provider-a:channel:rtk1',
        providerId: 'provider-a',
        remoteId: 'rtk1',
        resourceType: 'channel',
        title: 'RTK 1',
        posterUrl: 'https://img.example/rtk1.png',
        countryCode: 'XK',
        genres: ['News', 'Kosovo', 'Sports'],
      },
    ]);
  });


  test('drops channels whose normalized identity cannot be played', () => {
    const channels = parseLiveTvCatalog({
      metas: [
        {
          id: 'x'.repeat(500),
          type: 'channel',
          name: 'Composite ID too long',
        },
        {
          id: 'valid',
          type: 'channel',
          name: 'x'.repeat(501),
        },
        {
          id: 'ok',
          type: 'channel',
          name: 'Playable',
        },
      ],
    }, 'provider-a', 'channel');

    expect(channels).toEqual([
      expect.objectContaining({
        id: 'provider-a:channel:ok',
        title: 'Playable',
      }),
    ]);
  });

  test('rejects control-character channel identity and bounds channel count', () => {
    const metas = Array.from({ length: 10_050 }, (_, index) => ({
      id: `channel-${index}`,
      type: 'channel',
      name: `Channel ${index}`,
    }));
    metas[0] = {
      id: 'bad\u0000id',
      type: 'channel',
      name: 'Invalid',
    };

    const channels = parseLiveTvCatalog(
      { metas },
      'provider-a',
      'channel',
    );

    expect(channels).toHaveLength(9_999);
    expect(channels.some((channel) => channel.remoteId.includes('\u0000')))
      .toBe(false);
  });

  test('deduplicates repeated Live TV catalog declarations', () => {
    const parsed = parseLiveTvCapability({
      ...manifest,
      catalogs: [
        { type: 'channel', id: 'all', name: 'All Channels' },
        { type: 'channel', id: 'all', name: 'Duplicate All' },
        { type: 'channel', id: 'sports', name: 'Sports' },
      ],
    });

    expect(parsed?.catalogs).toEqual([
      { type: 'channel', id: 'all', name: 'All Channels' },
      { type: 'channel', id: 'sports', name: 'Sports' },
    ]);
  });

  test('bounds Live TV catalog declarations from manifests', () => {
    const catalogs = Array.from({ length: 550 }, (_, index) => ({
      type: 'channel',
      id: `catalog-${index}`,
      name: `Catalog ${index}`,
    }));

    const parsed = parseLiveTvCapability({
      ...manifest,
      catalogs,
    });

    expect(parsed?.catalogs).toHaveLength(500);
  });
});
