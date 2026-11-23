import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { CatalogService, MediaDetails } from '@moviestv/catalog';
import {
  CatalogContext,
  catalogCacheScopeForUser,
  catalogProviderCacheIdentity,
  compactCatalogCacheNamespace,
  createInstalledCatalogEntries,
  type CatalogContextValue,
} from '../CatalogProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CatalogScreen } from '../CatalogScreen';
import { MediaCard } from '../MediaCard';
import { MediaDetailsScreen } from '../MediaDetailsScreen';
import { SearchScreen } from '../SearchScreen';
import { demoDetails, demoItems, demoSeasons } from '../demo-data';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { ProfilesContext } from '../../profiles/useProfiles';

let mockMyListItems: any[] = [];
let mockWatchProgressRecords: any[] = [];
const mockSetMyListItems = jest.fn(async (_items: any[]): Promise<void> => undefined);
const mockResumeProgress = jest.fn(async () => true);
const mockClosePlayback = jest.fn();

jest.mock('../../playback/usePlayback', () => ({
  usePlayback: () => ({
    playMovie: jest.fn(),
    playEpisode: jest.fn(),
    resumeProgress: mockResumeProgress,
    closePlayback: mockClosePlayback,
  }),
}));

jest.mock('../../preferences/usePreferences', () => ({
  usePreferences: () => ({
    preferences: {
      appLocale: 'fr',
      preferredAudioLanguages: ['fr', 'en'],
      preferredSubtitleLanguages: [],
      subtitlesEnabled: true,
      autoplay: true,
      favoriteChannelIds: [],
      myListItems: mockMyListItems,
    },
    ready: true,
    setMyListItems: mockSetMyListItems,
  }),
}));

jest.mock('../../auth/useAccount', () => ({
  AccountContext: require('react').createContext(null),
  useAccount: () => ({
    backendAvailable: false,
    userId: null,
    loading: false,
    signIn: jest.fn(async () => undefined),
    signUp: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../watch-progress/useWatchProgress', () => ({
  WatchProgressContext: require('react').createContext(null),
  useWatchProgress: () => ({
    records: mockWatchProgressRecords,
    status: 'ready',
    save: jest.fn(async () => undefined),
    restart: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    forget: jest.fn(async () => undefined),
    forgetAll: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../downloads/useDownloadManager', () => ({
  useDownloadManager: () => ({
    jobs: [],
    startDownload: jest.fn(async () => 'download-test'),
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    cancel: jest.fn(),
    dismiss: jest.fn(),
  }),
}));

const french: Record<string, string> = {
  'nav.home': 'Accueil',
  'nav.search': 'Rechercher',
  'common.back': 'Retour',
  'common.retry': 'Réessayer',
  'common.loading': 'Chargement…',
  'common.unavailable': 'Indisponible',
  'common.noResults': 'Aucun résultat',
  'common.details': 'Détails',
  'common.cast': 'Distribution',
  'common.catalog': 'Catalogue',
  'common.provider': 'Fournisseur',
  'common.seasons': 'saisons',
  'common.minutes': 'min',
  'common.demo': 'Démo',
  'common.live': 'En direct',
  'common.featured': 'À la une',
  'common.movie': 'Film',
  'common.series': 'Série',
  'search.placeholder': 'Rechercher des films ou des séries',
  'search.minChars': 'Saisissez au moins deux caractères.',
  'search.searching': 'Recherche…',
  'search.tryDifferent': 'Essayez un autre titre de film ou de série.',
  'search.results': 'Résultats',
  'search.loadMore': 'Charger plus',
  'details.noOverview': 'Aucun résumé disponible.',
  'details.playUnavailable': 'Lecture indisponible',
  'details.season': 'Saison',
  'details.episode': 'Épisode',
  'details.episodes': 'Épisodes',
  'details.loadingEpisodes': 'Chargement des épisodes…',
  'details.noEpisodes': 'Aucun épisode disponible',
  'details.loadEpisodesFailed': 'Impossible de charger les épisodes',
  'playback.manageProviders': 'Ouvrir les sources',
};

function Localized({
  children,
  locale = 'fr',
}: {
  children: React.ReactNode;
  locale?: string;
}) {
  return (
    <I18nContext.Provider value={{
      locale,
      direction: 'ltr',
      t: (key, params) => french[key] ?? translateFrom(
        APP_RESOURCES[locale as keyof typeof APP_RESOURCES] ?? APP_RESOURCES.en,
        APP_RESOURCES.en,
        key,
        params,
      ),
      formatNumber: String,
      formatDate: (value) => String(value),
      languageName: (tag) => tag,
    }}>
      {children}
    </I18nContext.Provider>
  );
}

function CatalogHarness({ service, children }: { service: CatalogService; children: React.ReactNode }) {
  const value: CatalogContextValue = { service, config: { mode: 'demo', baseUrl: null } };
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

// The catalog screen now paints the last snapshot before the network answers,
// so storage has to start empty for every case.
beforeEach(async () => {
  await AsyncStorage.clear();
});

test('catalog empty state guides users to catalog providers', async () => {
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;
  const onOpenProviders = jest.fn();

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen
          route="home"
          onSelectMedia={jest.fn()}
          onOpenProviders={onOpenProviders}
        />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText('Aucun résultat')).toBeTruthy();
  expect(
    screen.getByText(
      'Ajoutez un catalogue dans les fournisseurs pour afficher des films et des séries.',
    ),
  ).toBeTruthy();

  fireEvent.press(screen.getByTestId('catalog-empty-open-providers'));
  expect(onOpenProviders).toHaveBeenCalledTimes(1);
});

test('catalog never displays credential-bearing provider errors', async () => {
  const service = {
    getSections: async () => {
      throw new Error(
        'Failed https://catalog.example/items?token=LOCAL-SECRET',
      );
    },
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('Indisponible')).toBeTruthy();
  expect(screen.getByText('Réessayer')).toBeTruthy();
  expect(screen.queryByText(/LOCAL-SECRET/)).toBeNull();
  expect(screen.queryByText(/catalog\.example/)).toBeNull();
});

test('search uses localized heading, placeholder and guidance', () => {
  const service = {} as CatalogService;
  render(
    <Localized>
      <CatalogHarness service={service}>
        <SearchScreen onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(screen.getByText('Rechercher')).toBeTruthy();
  expect(screen.getByPlaceholderText('Rechercher des films ou des séries')).toBeTruthy();
  expect(screen.getByText('Saisissez au moins deux caractères.')).toBeTruthy();
});

test('search no-results state can open catalog providers', async () => {
  jest.useFakeTimers();
  try {
    const service = {
      search: jest.fn(async () => ({ items: [] })),
    } as unknown as CatalogService;
    const onOpenProviders = jest.fn();

    render(
      <Localized>
        <CatalogHarness service={service}>
          <SearchScreen
            onSelectMedia={jest.fn()}
            onOpenProviders={onOpenProviders}
          />
        </CatalogHarness>
      </Localized>,
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Rechercher des films ou des séries'),
      'Unknown title',
    );
    await act(async () => {
      jest.advanceTimersByTime(301);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Aucun résultat')).toBeTruthy();
    fireEvent.press(screen.getByTestId('search-open-providers'));
    expect(onOpenProviders).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('search appends the next cursor page without duplicating results', async () => {
  jest.useFakeTimers();
  try {
    const first = {
      id: 'nuvio:movie:first',
      kind: 'movie' as const,
      title: 'First Result',
      providerId: 'nuvio',
      externalIds: { imdb: 'tt1234567', tmdb: '101' },
    };
    const firstAlias = {
      ...first,
      id: 'alternate:movie:101',
      title: 'First Result Alternate',
      providerId: 'alternate',
    };
    const second = {
      id: 'nuvio:movie:second',
      kind: 'movie' as const,
      title: 'Second Result',
      providerId: 'nuvio',
      externalIds: {},
    };
    const search = jest.fn(async (_query: string, cursor?: string) => (
      cursor
        ? { items: [firstAlias, second] }
        : { items: [first], nextCursor: '20' }
    ));
    const service = { search } as unknown as CatalogService;

    render(
      <Localized>
        <CatalogHarness service={service}>
          <SearchScreen onSelectMedia={jest.fn()} />
        </CatalogHarness>
      </Localized>,
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Rechercher des films ou des séries'),
      'Dune',
    );
    await act(async () => {
      jest.advanceTimersByTime(301);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('First Result')).toBeTruthy();
    expect(screen.getByTestId('search-load-more')).toBeTruthy();

    fireEvent.press(screen.getByTestId('search-load-more'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(search).toHaveBeenNthCalledWith(1, 'Dune');
    expect(search).toHaveBeenNthCalledWith(2, 'Dune', '20');
    expect(screen.getAllByText('First Result')).toHaveLength(1);
    expect(screen.queryByText('First Result Alternate')).toBeNull();
    expect(screen.getByText('Second Result')).toBeTruthy();
    expect(screen.queryByTestId('search-load-more')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('ignores a late paginated search response after the query is cleared', async () => {
  jest.useFakeTimers();
  try {
    let resolvePage!: (value: any) => void;
    const pendingPage = new Promise<any>((resolve) => {
      resolvePage = resolve;
    });
    const first = {
      id: 'nuvio:movie:first',
      kind: 'movie' as const,
      title: 'First Result',
      providerId: 'nuvio',
      externalIds: {},
    };
    const late = {
      id: 'nuvio:movie:late',
      kind: 'movie' as const,
      title: 'Late Result',
      providerId: 'nuvio',
      externalIds: {},
    };
    const search = jest.fn(async (_query: string, cursor?: string) => (
      cursor
        ? pendingPage
        : { items: [first], nextCursor: '20' }
    ));
    const service = { search } as unknown as CatalogService;

    render(
      <Localized>
        <CatalogHarness service={service}>
          <SearchScreen onSelectMedia={jest.fn()} />
        </CatalogHarness>
      </Localized>,
    );

    const input = screen.getByPlaceholderText(
      'Rechercher des films ou des séries',
    );
    fireEvent.changeText(input, 'Dune');
    await act(async () => {
      jest.advanceTimersByTime(301);
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.press(screen.getByTestId('search-load-more'));

    fireEvent.changeText(input, '');
    resolvePage({ items: [late] });
    await act(async () => {
      await pendingPage;
      await Promise.resolve();
    });

    expect(screen.queryByText('First Result')).toBeNull();
    expect(screen.queryByText('Late Result')).toBeNull();
    expect(screen.queryByTestId('search-load-more')).toBeNull();
    expect(
      screen.getByText('Saisissez au moins deux caractères.'),
    ).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('search hides credential-bearing catalog errors', async () => {
  jest.useFakeTimers();
  try {
    const service = {
      search: async () => {
        throw new Error(
          'Failed https://catalog.example/search?token=LOCAL-SECRET',
        );
      },
    } as unknown as CatalogService;

    render(
      <Localized>
        <CatalogHarness service={service}>
          <SearchScreen onSelectMedia={jest.fn()} />
        </CatalogHarness>
      </Localized>,
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('Rechercher des films ou des séries'),
      'Dune',
    );
    await act(async () => {
      jest.advanceTimersByTime(301);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Indisponible')).toBeTruthy();
    expect(screen.queryByText(/LOCAL-SECRET/)).toBeNull();
    expect(screen.queryByText(/catalog\.example/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('details hides credential-bearing catalog errors', async () => {
  const service = {
    getDetails: async () => {
      throw new Error(
        'Failed https://catalog.example/meta?token=LOCAL-SECRET',
      );
    },
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <MediaDetailsScreen mediaId="movie:550" onBack={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('Indisponible')).toBeTruthy();
  expect(screen.queryByText(/LOCAL-SECRET/)).toBeNull();
  expect(screen.queryByText(/catalog\.example/)).toBeNull();
});

test('media cards keep the title visible in the cinematic card layout', () => {
  render(
    <Localized>
      <MediaCard item={demoItems[1]} onPress={jest.fn()} />
    </Localized>,
  );
  expect(screen.getByText(demoItems[1].title)).toBeTruthy();
});

test('details localize the real episode browser while keeping provider metadata', async () => {
  const playableSeries: MediaDetails = {
    ...demoDetails[1],
    externalIds: { tmdb: '1399', imdb: 'tt0944947' },
  };
  const service = {
    getDetails: async () => playableSeries,
    getSeason: async () => demoSeasons[0],
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <MediaDetailsScreen mediaId={playableSeries.id} onBack={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('Épisodes')).toBeTruthy();
  expect(await screen.findByText('First Contact')).toBeTruthy();
  expect(screen.getByText('Distribution')).toBeTruthy();
  expect(screen.getByText('1 saisons')).toBeTruthy();
  expect(screen.getByText('Beyond Orbit')).toBeTruthy();
  expect(screen.queryByText('Lecture indisponible')).toBeNull();
});


test('home exposes a direct account shortcut', async () => {
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;
  const onOpenAccount = jest.fn();

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen
          route="home"
          onSelectMedia={jest.fn()}
          onOpenAccount={onOpenAccount}
        />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  fireEvent.press(screen.getByTestId('home-account'));
  expect(onOpenAccount).toHaveBeenCalledTimes(1);
});


test('home exposes a direct Profiles shortcut', async () => {
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;
  const onOpenProfiles = jest.fn();

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen
          route="home"
          onSelectMedia={jest.fn()}
          onOpenProfiles={onOpenProfiles}
        />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  fireEvent.press(screen.getByTestId('home-profiles'));
  expect(onOpenProfiles).toHaveBeenCalledTimes(1);
});


test('home shows the active profile name in the header', async () => {
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;
  const kids = {
    id: 'kids',
    name: 'Kids',
    createdAt: '2026-10-01T00:00:00.000Z',
    useMainProviders: true,
  };

  render(
    <ProfilesContext.Provider value={{
      profiles: [kids],
      activeProfile: kids,
      ready: true,
      selectProfile: jest.fn(async () => undefined),
      createProfile: jest.fn(async () => null),
      renameProfile: jest.fn(async () => false),
    setAvatar: jest.fn(async () => true),
      setUseMainProviders: jest.fn(async () => false),
      deleteProfile: jest.fn(async () => false),
    }}>
      <Localized>
        <CatalogHarness service={service}>
          <CatalogScreen
            route="home"
            onSelectMedia={jest.fn()}
            onOpenProfiles={jest.fn()}
          />
        </CatalogHarness>
      </Localized>
    </ProfilesContext.Provider>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText('Kids')).toBeTruthy();
});


test('home shows catalog-native episodes in Continue Watching', async () => {
  mockWatchProgressRecords = [{
    mediaId: 'custom:episode:1',
    kind: 'episode',
    title: 'Native Series · S1E1 · Pilot',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  }];

  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByTestId('continue-watching-row')).toBeTruthy();
  expect(
    screen.getByTestId('continue-watching-custom:episode:1'),
  ).toBeTruthy();

  mockWatchProgressRecords = [];
});

test('Home opens the parent series when episode resume cannot start', async () => {
  mockClosePlayback.mockClear();
  mockResumeProgress.mockResolvedValueOnce(false);
  mockWatchProgressRecords = [{
    mediaId: 'custom:episode:1',
    kind: 'episode',
    title: 'Native Series · S1E1 · Pilot',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  }];
  const onSelectMedia = jest.fn();
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen
          route="home"
          onSelectMedia={onSelectMedia}
        />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.press(
    screen.getByTestId('continue-watching-custom:episode:1'),
  );
  await act(async () => {
    await Promise.resolve();
  });

  expect(mockClosePlayback).toHaveBeenCalledTimes(1);
  expect(onSelectMedia).toHaveBeenCalledWith(
    'stremio-custom:series:custom%3Ashow-42',
  );
  mockWatchProgressRecords = [];
});

test('home shows synchronized My List items as a media row', async () => {
  mockMyListItems = [{
    mediaId: 'movie:550',
    kind: 'movie',
    title: 'Fight Club',
    providerId: 'cinemeta',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    year: 1999,
  }];

  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;
  const onSelectMedia = jest.fn();

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={onSelectMedia} />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText('Ma liste')).toBeTruthy();
  expect(screen.getByText('Fight Club')).toBeTruthy();
  fireEvent.press(screen.getByText('Fight Club'));
  expect(onSelectMedia).toHaveBeenCalledWith('movie:550');

  mockMyListItems = [];
});


test('Home hero adds the featured title to My List without opening details', async () => {
  mockMyListItems = [];
  mockSetMyListItems.mockClear();

  const section = {
    id: 'home:trending-movies',
    title: 'Trending Movies',
    kinds: ['movie'] as const,
  };
  const featured = {
    ...demoItems[0],
    backdropUrl: 'https://images.example/orbit-city.jpg',
  };
  const service = {
    getSections: async () => [section],
    browse: async () => ({ items: [featured] }),
    getDetails: async () => demoDetails[0],
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  fireEvent.press(screen.getByTestId('catalog-hero-my-list'));

  expect(mockSetMyListItems).toHaveBeenCalledWith([
    expect.objectContaining({
      mediaId: featured.id,
      kind: featured.kind,
      title: featured.title,
      providerId: featured.providerId,
    }),
  ]);

  mockMyListItems = [];
});


test('Home hero rapid My List toggles use the latest optimistic list', async () => {
  mockMyListItems = [];
  mockSetMyListItems.mockClear();

  const section = {
    id: 'home:trending-movies',
    title: 'Trending Movies',
    kinds: ['movie'] as const,
  };
  const featured = {
    ...demoItems[0],
    backdropUrl: 'https://images.example/orbit-city.jpg',
  };
  const service = {
    getSections: async () => [section],
    browse: async () => ({ items: [featured] }),
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const toggle = screen.getByTestId('catalog-hero-my-list');
  fireEvent.press(toggle);
  fireEvent.press(toggle);

  expect(mockSetMyListItems).toHaveBeenCalledTimes(2);
  expect(mockSetMyListItems.mock.calls[0]?.[0]).toEqual([
    expect.objectContaining({ mediaId: featured.id }),
  ]);
  expect(mockSetMyListItems.mock.calls[1]?.[0]).toEqual([]);

  mockMyListItems = [];
});

test('Home hero recognizes and removes an equivalent My List title from another provider', async () => {
  mockSetMyListItems.mockClear();

  const section = {
    id: 'home:trending-movies',
    title: 'Trending Movies',
    kinds: ['movie'] as const,
  };
  const featured = {
    ...demoItems[0],
    backdropUrl: 'https://images.example/orbit-city.jpg',
    externalIds: { tmdb: '550' },
  };
  mockMyListItems = [{
    mediaId: 'other-provider:movie:hero',
    kind: featured.kind,
    title: featured.title,
    providerId: 'other-provider',
    externalIds: featured.externalIds,
  }];

  const service = {
    getSections: async () => [section],
    browse: async () => ({ items: [featured] }),
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  fireEvent.press(screen.getByTestId('catalog-hero-my-list'));

  expect(mockSetMyListItems).toHaveBeenCalledWith([]);
  mockMyListItems = [];
});

test('home exposes a direct Library shortcut', async () => {
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;
  const onOpenLibrary = jest.fn();

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen
          route="home"
          onSelectMedia={jest.fn()}
          onOpenLibrary={onOpenLibrary}
        />
      </CatalogHarness>
    </Localized>,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  fireEvent.press(screen.getByTestId('home-library'));
  expect(onOpenLibrary).toHaveBeenCalledTimes(1);
});


test('catalog cache scopes stay isolated between guest and signed-in accounts', () => {
  expect(catalogCacheScopeForUser(null)).toBe('guest');
  expect(catalogCacheScopeForUser(' user-a ')).toBe('user:user-a');
  expect(catalogCacheScopeForUser('user-b')).toBe('user:user-b');
  expect(catalogCacheScopeForUser('user-a'))
    .not.toBe(catalogCacheScopeForUser('user-b'));
});


test('catalog cache namespaces are compact and do not expose account or config values', () => {
  const raw = [
    catalogCacheScopeForUser('private-user-id'),
    'base:cinemeta:',
    `provider-a:100:2026-09-22T08:00:00.000Z:${JSON.stringify({
      region: 'FR',
      profileName: 'PRIVATE-PROFILE',
      largeSetting: 'x'.repeat(10_000),
    })}`,
  ].join('|');

  const first = compactCatalogCacheNamespace(raw);
  const repeated = compactCatalogCacheNamespace(raw);
  const changed = compactCatalogCacheNamespace(
    raw.replace('PRIVATE-PROFILE', 'OTHER-PROFILE'),
  );

  expect(first).toBe(repeated);
  expect(first).toMatch(/^v2:[a-z0-9]+:[a-z0-9]+:[a-z0-9]+$/);
  expect(first.length).toBeLessThan(80);
  expect(first).not.toContain('private-user-id');
  expect(first).not.toContain('PRIVATE-PROFILE');
  expect(changed).not.toBe(first);
});


test('catalog provider cache identity changes with the manifest endpoint', () => {
  const base = {
    installed: {
      addonId: 'provider-a',
      manifestUrl: 'https://one.example/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 100,
      installedAt: '2026-09-23T08:00:00.000Z',
      updatedAt: '2026-09-23T08:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: { region: 'FR' },
    descriptor: {
      id: 'provider-a',
      name: 'Provider A',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['catalog'],
      requiresConfiguration: false,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      manifestUrl: 'https://one.example/manifest.json',
      catalog: {
        catalogs: [{
          type: 'movie',
          id: 'popular',
          name: 'Popular',
        }],
      },
    },
  } as any;

  const first = catalogProviderCacheIdentity(base);
  const second = catalogProviderCacheIdentity({
    ...base,
    installed: {
      ...base.installed,
      manifestUrl: 'https://two.example/manifest.json',
    },
    descriptor: {
      ...base.descriptor,
      manifestUrl: 'https://two.example/manifest.json',
    },
  });

  expect(second).not.toBe(first);
  expect(
    compactCatalogCacheNamespace(second),
  ).not.toBe(compactCatalogCacheNamespace(first));
});

test('catalog cache namespaces stay bounded and deterministic', () => {
  const large = [
    'user:user-a',
    ...Array.from(
      { length: 100 },
      (_, index) => `provider-${index}:${'x'.repeat(2_000)}`,
    ),
  ].join('|');

  const first = compactCatalogCacheNamespace(large);
  const second = compactCatalogCacheNamespace(large);
  const different = compactCatalogCacheNamespace(`${large}:changed`);

  expect(first).toBe(second);
  expect(first).not.toBe(different);
  expect(first.length).toBeLessThan(80);
  expect(first).not.toContain('provider-99');
  expect(first).not.toContain('user-a');
});


test('catalog registry skips a malformed installed provider without dropping healthy catalogs', () => {
  const healthy = {
    installed: {
      addonId: 'healthy',
      manifestUrl: 'https://healthy.example/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 100,
      installedAt: '2026-09-23T08:00:00.000Z',
      updatedAt: '2026-09-23T08:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: 'healthy',
      name: 'Healthy',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['catalog'],
      requiresConfiguration: false,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      manifestUrl: 'https://healthy.example/manifest.json',
      catalog: {
        catalogs: [{
          type: 'movie',
          id: 'popular',
          name: 'Popular',
          extra: [],
        }],
      },
    },
  } as any;
  const malformed = {
    ...healthy,
    installed: {
      ...healthy.installed,
      addonId: 'broken',
      manifestUrl: 'http://example.com/manifest.json',
      priority: 200,
    },
    descriptor: {
      ...healthy.descriptor,
      id: 'broken',
      manifestUrl: 'http://example.com/manifest.json',
    },
  };

  const entries = createInstalledCatalogEntries(
    [malformed, healthy],
    false,
  );

  expect(entries).toHaveLength(1);
  expect(entries[0]?.gateway.id).toBe('stremio-healthy');
});


test('catalog registry ignores malformed capability metadata', () => {
  const malformed = {
    installed: {
      addonId: 'broken-capabilities',
      manifestUrl: 'https://broken.example/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 200,
      installedAt: '2026-09-23T08:00:00.000Z',
      updatedAt: '2026-09-23T08:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: 'broken-capabilities',
      name: 'Broken',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: null,
      requiresConfiguration: false,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      manifestUrl: 'https://broken.example/manifest.json',
      catalog: {
        catalogs: [{
          type: 'movie',
          id: 'popular',
          name: 'Popular',
          extra: [],
        }],
      },
    },
  } as any;

  expect(() => createInstalledCatalogEntries(
    [malformed],
    false,
  )).not.toThrow();
  expect(createInstalledCatalogEntries([malformed], false)).toEqual([]);
});


test('catalog rows append the next cursor page without duplicate cards', async () => {
  const first = {
    id: 'nuvio:movie:first',
    kind: 'movie' as const,
    title: 'First Page Movie',
    providerId: 'nuvio',
    externalIds: { imdb: 'tt7654321', tmdb: '202' },
  };
  const firstAlias = {
    ...first,
    id: 'alternate:movie:202',
    title: 'First Page Movie Alternate',
    providerId: 'alternate',
  };
  const second = {
    id: 'nuvio:movie:second',
    kind: 'movie' as const,
    title: 'Second Page Movie',
    providerId: 'nuvio',
    externalIds: {},
  };
  const section = {
    id: 'movies:nuvio:popular',
    title: 'Popular Movies',
    kinds: ['movie' as const],
  };
  const browse = jest.fn(async (_sectionId: string, cursor?: string) => (
    cursor
      ? { items: [firstAlias, second] }
      : { items: [first], nextCursor: '20' }
  ));
  const service = {
    getSections: async () => [section],
    browse,
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="movies" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('First Page Movie')).toBeTruthy();
  expect(
    screen.getByTestId('catalog-row-load-more-movies:nuvio:popular'),
  ).toBeTruthy();

  fireEvent.press(
    screen.getByTestId('catalog-row-load-more-movies:nuvio:popular'),
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(browse).toHaveBeenNthCalledWith(1, section.id);
  expect(browse).toHaveBeenNthCalledWith(2, section.id, '20');
  expect(screen.getAllByText('First Page Movie')).toHaveLength(1);
  expect(screen.queryByText('First Page Movie Alternate')).toBeNull();
  expect(screen.getByText('Second Page Movie')).toBeTruthy();
  expect(
    screen.queryByTestId('catalog-row-load-more-movies:nuvio:popular'),
  ).toBeNull();
});


test('bounds concurrent catalog row loads', async () => {
  let active = 0;
  let maxActive = 0;
  const sections = Array.from({ length: 12 }, (_, index) => ({
    id: `movies:provider:section-${index}`,
    title: `Section ${index}`,
    kinds: ['movie' as const],
  }));
  const browse = jest.fn(async (sectionId: string) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return {
      items: [{
        id: `${sectionId}:item`,
        kind: 'movie' as const,
        title: `Item ${sectionId}`,
        providerId: 'provider',
        externalIds: {},
      }],
    };
  });
  const service = {
    getSections: async () => sections,
    browse,
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="movies" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('Section 11')).toBeTruthy();
  expect(browse).toHaveBeenCalledTimes(12);
  expect(maxActive).toBeLessThanOrEqual(6);
});


test('shows completed catalog rows before slower sections finish', async () => {
  let releaseSlow!: () => void;
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const sections = [
    {
      id: 'movies:provider:fast',
      title: 'Fast Section',
      kinds: ['movie' as const],
    },
    {
      id: 'movies:provider:slow',
      title: 'Slow Section',
      kinds: ['movie' as const],
    },
  ];
  const service = {
    getSections: async () => sections,
    browse: jest.fn(async (sectionId: string) => {
      if (sectionId.endsWith(':slow')) await slow;
      return {
        items: [{
          id: `${sectionId}:item`,
          kind: 'movie' as const,
          title: sectionId.endsWith(':fast') ? 'Fast Movie' : 'Slow Movie',
          providerId: 'provider',
          externalIds: {},
        }],
      };
    }),
  } as unknown as CatalogService;

  render(
    <Localized>
      <CatalogHarness service={service}>
        <CatalogScreen route="movies" onSelectMedia={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('Fast Movie')).toBeTruthy();
  expect(screen.queryByText('Slow Movie')).toBeNull();

  await act(async () => {
    releaseSlow();
    await slow;
    await Promise.resolve();
  });

  expect(await screen.findByText('Slow Movie')).toBeTruthy();
});


test('media cards can become invalid during refresh without changing hook order', () => {
  const onPress = jest.fn();
  const view = render(
    <Localized>
      <MediaCard item={demoItems[1]} onPress={onPress} />
    </Localized>,
  );

  expect(screen.getByText(demoItems[1].title)).toBeTruthy();

  view.rerender(
    <Localized>
      <MediaCard
        item={{ ...demoItems[1], id: '' }}
        onPress={onPress}
      />
    </Localized>,
  );

  expect(screen.queryByText(demoItems[1].title)).toBeNull();
});


test('German Home sign-in copy stays visible when sync backend is unavailable', async () => {
  const service = {
    getSections: async () => [],
    browse: async () => ({ items: [] }),
  } as unknown as CatalogService;

  render(
    <Localized locale="de">
      <CatalogHarness service={service}>
        <CatalogScreen route="home" onSelectMedia={jest.fn()} onOpenAccount={jest.fn()} />
      </CatalogHarness>
    </Localized>,
  );

  expect(await screen.findByText('Anmelden')).toBeTruthy();
});
