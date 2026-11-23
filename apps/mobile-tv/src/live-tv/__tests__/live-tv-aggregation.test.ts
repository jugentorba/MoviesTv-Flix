import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import {
  aggregateLiveTvChannels,
  liveTvFavoriteKey,
  normalizedLiveTvChannelTitle,
} from '../live-tv-aggregation';

const providerA: LiveTvProviderDescriptor = {
  addonId: 'provider-a',
  name: 'Provider A',
  manifestUrl: 'https://a.example/manifest.json',
  priority: 100,
  liveTv: { catalogs: [], streamTypes: ['channel'] },
};

const providerB: LiveTvProviderDescriptor = {
  addonId: 'provider-b',
  name: 'Provider B',
  manifestUrl: 'https://b.example/manifest.json',
  priority: 50,
  liveTv: { catalogs: [], streamTypes: ['channel'] },
};

function channel(
  providerId: string,
  remoteId: string,
  title: string,
  countryCode?: string,
  posterUrl?: string,
): LiveTvChannel {
  return {
    id: `${providerId}:channel:${remoteId}`,
    providerId,
    remoteId,
    resourceType: 'channel',
    title,
    ...(countryCode ? { countryCode } : {}),
    ...(posterUrl ? { posterUrl } : {}),
  };
}

describe('Live TV channel aggregation', () => {
  it('merges normalized title and country matches in provider-priority order', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerB,
        channels: [
          channel(
            'provider-b',
            'france2',
            'Fránce-2',
            'FR',
            'https://img.example/fr2.png',
          ),
        ],
      },
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'fr2', 'France 2', ' fr '),
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'provider-a:channel:fr2',
      title: 'France 2',
      countryCode: 'FR',
      posterUrl: 'https://img.example/fr2.png',
    }));
    expect(
      result[0]!.variants.map((variant) => variant.provider.addonId),
    ).toEqual(['provider-a', 'provider-b']);
  });

  it('dedupes merged provider genres case-insensitively', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [{
          ...channel('provider-a', 'fr2', 'France 2', 'FR'),
          genres: ['News', 'General'],
        }],
      },
      {
        provider: providerB,
        channels: [{
          ...channel('provider-b', 'fr2-backup', 'Fránce-2', 'FR'),
          genres: ['news', 'Sports'],
        }],
      },
    ]);

    expect(result[0]?.genres).toEqual(['News', 'General', 'Sports']);
  });

  it('merges a countryless provider variant into one unambiguous known country', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'fr2-primary', 'France 2'),
        ],
      },
      {
        provider: providerB,
        channels: [
          channel('provider-b', 'fr2-backup', 'Fránce-2', 'FR'),
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'provider-a:channel:fr2-primary',
      countryCode: 'FR',
    }));
    expect(
      result[0]!.variants.map((variant) => variant.provider.addonId),
    ).toEqual(['provider-a', 'provider-b']);
  });

  it('keeps a countryless title separate when the known country is ambiguous', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'news-unknown', 'News 24'),
        ],
      },
      {
        provider: providerB,
        channels: [
          channel('provider-b', 'news-fr', 'News 24', 'FR'),
          channel('provider-b', 'news-al', 'News 24', 'AL'),
        ],
      },
    ]);

    expect(result).toHaveLength(3);
    expect(result.filter((item) => item.countryCode === undefined)).toHaveLength(1);
    expect(
      result.flatMap((item) => item.variants).map((variant) => variant.channel.remoteId),
    ).toEqual(expect.arrayContaining(['news-unknown', 'news-fr', 'news-al']));
  });

  it('keeps same title separate when countries differ', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'news-fr', 'News 24', 'FR'),
        ],
      },
      {
        provider: providerB,
        channels: [
          channel('provider-b', 'news-al', 'News 24', 'AL'),
        ],
      },
    ]);

    expect(result).toHaveLength(2);
    expect(
      result.map((item) => item.countryCode).sort(),
    ).toEqual(['AL', 'FR']);
  });

  it('preserves the existing channel id for single-provider channels', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'top', 'Top Channel', 'AL'),
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('provider-a:channel:top');
    expect(result[0]!.variants).toHaveLength(1);
  });

  it('sorts logical channels alphabetically', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'z', 'Zeta TV', 'FR'),
          channel('provider-a', 'a', 'Alpha TV', 'FR'),
        ],
      },
    ]);

    expect(result.map((item) => item.title)).toEqual([
      'Alpha TV',
      'Zeta TV',
    ]);
  });

  it('preserves and merges non-Latin channel names', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'news-ru', 'Новости 24', 'RU'),
        ],
      },
      {
        provider: providerB,
        channels: [
          channel('provider-b', 'news-ru-backup', 'НОВОСТИ 24', 'RU'),
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Новости 24');
    expect(result[0]!.variants).toHaveLength(2);
  });


  it('builds the same favorite key for provider variants of one station', () => {
    const first = channel(
      'provider-a',
      'top',
      'Tóp Channel',
      'AL',
    );
    const second = channel(
      'provider-b',
      'top-backup',
      'TOP-CHANNEL',
      'AL',
    );

    expect(liveTvFavoriteKey(first)).toBe(
      liveTvFavoriteKey(second),
    );
    expect(liveTvFavoriteKey(first)).toBe(
      'live-tv-favorite:AL:top%20channel',
    );
  });


  it('compacts oversized favorite keys while keeping provider variants stable', () => {
    const longTitle = 'É'.repeat(500);
    const first = channel(
      'provider-a',
      'long-a',
      longTitle,
      'FR',
    );
    const second = channel(
      'provider-b',
      'long-b',
      longTitle.toLowerCase(),
      'fr',
    );

    const firstKey = liveTvFavoriteKey(first);
    const secondKey = liveTvFavoriteKey(second);

    expect(firstKey).toBe(secondKey);
    expect(firstKey.length).toBeLessThanOrEqual(512);
    expect(firstKey).toMatch(/^live-tv-favorite:FR:hash:/);
  });

  it('compacts oversized id fallback favorite keys', () => {
    const fallback = channel(
      'provider-a',
      'x'.repeat(2_000),
      '---',
      'AL',
    );
    const key = liveTvFavoriteKey(fallback);

    expect(key.length).toBeLessThanOrEqual(512);
    expect(key).toMatch(/^live-tv-favorite:AL:id-hash:/);
  });

  it('merges provider variants when country-code casing differs', () => {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'fr2', 'France 2', 'FR'),
        ],
      },
      {
        provider: providerB,
        channels: [
          channel(
            'provider-b',
            'fr2-backup',
            'Fránce-2',
            'FR',
          ),
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.countryCode).toBe('FR');
    expect(result[0]!.variants).toHaveLength(2);
    expect(
      result[0]!.variants.map((variant) => variant.provider.addonId),
    ).toEqual(['provider-a', 'provider-b']);
    expect(
      liveTvFavoriteKey(result[0]!.variants[0]!.channel),
    ).toBe(
      liveTvFavoriteKey(result[0]!.variants[1]!.channel),
    );
  });

  it('dedupes the same provider remote channel after countryless reconciliation', () => {
    const duplicated = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'fr2', 'France 2'),
          channel('provider-a', 'fr2', 'France 2', 'FR'),
        ],
      },
      {
        provider: providerB,
        channels: [
          channel('provider-b', 'fr2-backup', 'France 2', 'FR'),
        ],
      },
    ]);

    expect(duplicated).toHaveLength(1);
    expect(duplicated[0]!.countryCode).toBe('FR');
    expect(
      duplicated[0]!.variants.map((variant) => (
        `${variant.provider.addonId}:${variant.channel.remoteId}`
      )),
    ).toEqual([
      'provider-a:fr2',
      'provider-b:fr2-backup',
    ]);
  });

  it('keeps distinct stream resource routes for the same provider channel id', () => {
    const channelRoute = channel(
      'provider-a',
      'top',
      'Top Channel',
      'AL',
    );
    const tvRoute: LiveTvChannel = {
      ...channelRoute,
      id: 'provider-a:tv:top',
      resourceType: 'tv',
    };
    const providerWithBothRoutes: LiveTvProviderDescriptor = {
      ...providerA,
      liveTv: {
        catalogs: [],
        streamTypes: ['channel', 'tv'],
      },
    };

    const result = aggregateLiveTvChannels([{
      provider: providerWithBothRoutes,
      channels: [channelRoute, tvRoute],
    }]);

    expect(result).toHaveLength(1);
    expect(
      result[0]!.variants.map(
        (variant) => variant.channel.resourceType,
      ),
    ).toEqual(['channel', 'tv']);
  });

  it('dedupes repeated variants from the same provider and remote channel', () => {
    const duplicate = channel('provider-a', 'top', 'Top Channel', 'AL');
    const result = aggregateLiveTvChannels([{ provider: providerA, channels: [duplicate, { ...duplicate }] }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.variants).toHaveLength(1);
  });

});


test('aggregation drops malformed channels and unsafe artwork', () => {
  const good = { ...channel('provider-a', 'one', 'News', 'FR'), posterUrl: 'http://unsafe.example/logo.png', genres: [' News ', 'News', ''] } as any;
  const malformed = { ...good, id: '', remoteId: '' };
  const result = aggregateLiveTvChannels([{ provider: providerA, channels: [malformed, good] }]);
  expect(result).toHaveLength(1);
  expect(result[0]!.posterUrl).toBeUndefined();
  expect(result[0]!.genres).toEqual(['News']);
});


test('keeps only the highest-priority loaded providers when aggregation is oversized', () => {
  const loaded = Array.from({ length: 105 }, (_, index) => {
    const provider: LiveTvProviderDescriptor = {
      addonId: `provider-${index}`,
      name: `Provider ${index}`,
      manifestUrl: `https://provider-${index}.example/manifest.json`,
      priority: index,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
    };
    return {
      provider,
      channels: [
        channel(
          provider.addonId,
          `channel-${index}`,
          `Unique Channel ${index}`,
          'FR',
        ),
      ],
    };
  });

  const result = aggregateLiveTvChannels(loaded);

  expect(result).toHaveLength(100);
  expect(
    result.some((item) => item.providerId === 'provider-104'),
  ).toBe(true);
  expect(
    result.some((item) => item.providerId === 'provider-0'),
  ).toBe(false);
});


test('Live TV normalized identities do not depend on the device locale', () => {
  const localeLower = jest.spyOn(
    String.prototype,
    'toLocaleLowerCase',
  ).mockImplementation(() => 'locale-dependent');

  try {
    expect(
      normalizedLiveTvChannelTitle('İSTANBUL TV'),
    ).toBe('istanbul tv');
    expect(localeLower).not.toHaveBeenCalled();

    expect(liveTvFavoriteKey(
      channel('provider-a', 'istanbul', 'İSTANBUL TV', 'TR'),
    )).toBe(
      'live-tv-favorite:TR:istanbul%20tv',
    );
  } finally {
    localeLower.mockRestore();
  }
});


test('merges Kosovo country aliases into one logical channel', () => {
  const providerB = {
    ...providerA,
    addonId: 'provider-b',
    name: 'Provider B',
    manifestUrl: 'https://provider-b.example/manifest.json',
    priority: 50,
  };
  const result = aggregateLiveTvChannels([
    {
      provider: providerA,
      channels: [
        channel('provider-a', 'rtk-a', 'RTK 1', 'KS'),
      ],
    },
    {
      provider: providerB,
      channels: [
        channel('provider-b', 'rtk-b', 'RTK 1', 'XK'),
      ],
    },
  ]);

  expect(result).toHaveLength(1);
  expect(result[0]?.countryCode).toBe('XK');
  expect(result[0]?.variants).toHaveLength(2);
});

test('aggregated Live TV channels ignore signed artwork URLs', () => {
  const result = aggregateLiveTvChannels([
    {
      provider: providerA,
      channels: [{
        ...channel('provider-a', 'signed', 'France 2', 'FR'),
        posterUrl:
          'https://img.example/fr2.png#token=LOCAL-SECRET',
      }],
    },
  ]);

  expect(result).toHaveLength(1);
  expect(result[0]?.posterUrl).toBeUndefined();
});

test('aggregated Live TV channels ignore credentialized artwork paths', () => {
  const result = aggregateLiveTvChannels([
    {
      provider: providerA,
      channels: [
        {
          ...channel('provider-a', 'credential-path', 'France 2', 'FR'),
          posterUrl:
            'https://img.example/token=LOCAL-SECRET/fr2.png',
        },
        {
          ...channel('provider-a', 'ordinary-path', 'France 3', 'FR'),
          posterUrl:
            'https://img.example/secret-garden/fr3.png',
        },
      ],
    },
  ]);

  expect(result[0]?.posterUrl).toBeUndefined();
  expect(result[1]?.posterUrl).toBe(
    'https://img.example/secret-garden/fr3.png',
  );
});

test('aggregated Live TV ordering does not depend on localeCompare', () => {
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    const result = aggregateLiveTvChannels([
      {
        provider: providerA,
        channels: [
          channel('provider-a', 'z', 'Éclair TV', 'FR'),
          channel('provider-a', 'a', 'Alpha TV', 'FR'),
        ],
      },
    ]);

    expect(result.map((item) => item.title)).toEqual([
      'Alpha TV',
      'Éclair TV',
    ]);
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});
