import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { ProvidersScreen } from '../ProvidersScreen';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';

const inspected = {
  descriptor: {
    id: 'org.example.streams',
    name: 'Example Streams',
    version: '1.0.0',
    sourceType: 'stremio-manifest' as const,
    capabilities: ['stream' as const],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie' as const],
    manifestUrl: 'https://example.com/manifest.json',
  },
  manifestUrl: 'https://example.com/manifest.json',
  origin: 'manual' as const,
};

const installedRecord: AddonStateRecord = {
  installed: {
    addonId: inspected.descriptor.id,
    manifestUrl: inspected.manifestUrl,
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 100,
    installedAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
    setupIncomplete: false,
  },
  safeConfig: {},
  descriptor: inspected.descriptor,
};

function setup(
  kind: 'catalog' | 'stream' | 'live-tv' = 'stream',
  installed: AddonStateRecord[] = [],
  locale = 'en',
) {
  const api: AddonsApi = {
    installed,
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(async () => inspected),
    install: jest.fn(async () => installedRecord),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => false),
  };

  render(
    <AddonsContext.Provider value={api}>
      <I18nContext.Provider value={{
        locale,
        direction: 'ltr',
        t: (key: string, params?: Record<string, string | number>) => translateFrom(
          APP_RESOURCES[locale as keyof typeof APP_RESOURCES] ?? APP_RESOURCES.en,
          APP_RESOURCES.en,
          key,
          params,
        ),
        formatNumber: String,
        formatDate: (value) => String(value),
        languageName: (tag) => tag,
      }}>
        <ProvidersScreen kind={kind} onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  return api;
}

test('Add Provider inspects a manifest before confirming installation', async () => {
  const api = setup();

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://example.com/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  await waitFor(() => {
    expect(api.inspectManifest).toHaveBeenCalledWith(
      'https://example.com/manifest.json',
      'manual',
    );
  });
  expect(screen.getByText('Example Streams')).toBeTruthy();

  fireEvent.press(screen.getByTestId('provider-confirm-install'));
  await waitFor(() => expect(api.install).toHaveBeenCalledWith(inspected, {}));
});


test('editing the manifest URL ignores a stale inspection result', async () => {
  const api = setup();
  let resolveFirst!: (value: typeof inspected) => void;
  const firstRequest = new Promise<typeof inspected>((resolve) => {
    resolveFirst = resolve;
  });
  const secondInspected = {
    ...inspected,
    descriptor: {
      ...inspected.descriptor,
      id: 'org.example.second',
      name: 'Second Streams',
      manifestUrl: 'https://second.example/manifest.json',
    },
    manifestUrl: 'https://second.example/manifest.json',
  };
  (api.inspectManifest as jest.Mock).mockImplementation(
    async (url: string) => (
      url.includes('first.example')
        ? firstRequest
        : secondInspected
    ),
  );

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://first.example/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  await waitFor(() => {
    expect(api.inspectManifest).toHaveBeenCalledWith(
      'https://first.example/manifest.json',
      'manual',
    );
  });

  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://second.example/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  expect(await screen.findByText('Second Streams')).toBeTruthy();

  await act(async () => {
    resolveFirst(inspected);
    await firstRequest;
  });

  expect(screen.getByText('Second Streams')).toBeTruthy();
  expect(screen.queryByText('Example Streams')).toBeNull();

  fireEvent.press(screen.getByTestId('provider-confirm-install'));
  await waitFor(() => {
    expect(api.install).toHaveBeenCalledWith(secondInspected, {});
  });
});


test('official Nuvio catalog install follows the app locale', async () => {
  const api = setup('catalog', [], 'fr');
  const nuvio = {
    ...inspected,
    descriptor: {
      ...inspected.descriptor,
      id: 'com.nuvio.tmdb.catalogs',
      name: 'Nuvio Catalog Addon',
      capabilities: ['catalog' as const],
      supportedMediaKinds: ['movie' as const, 'series' as const],
      configurable: true,
      configurationFields: [
        {
          key: 'language',
          label: 'Language locale',
          type: 'text' as const,
          required: true,
          secret: false,
          defaultValue: 'en-US',
        },
        {
          key: 'region',
          label: 'Region',
          type: 'text' as const,
          required: true,
          secret: false,
          defaultValue: 'US',
        },
      ],
      catalog: {
        catalogs: [{
          type: 'movie' as const,
          id: 'trending-movies',
          name: 'Trending Movies',
          extra: [],
        }],
      },
      manifestUrl: 'https://catalog.nuvio.tv/manifest.json',
    },
    manifestUrl: 'https://catalog.nuvio.tv/manifest.json',
  };
  (api.inspectManifest as jest.Mock).mockResolvedValue(nuvio);

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    nuvio.manifestUrl,
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));
  await screen.findByText('Nuvio Catalog Addon');
  fireEvent.press(screen.getByTestId('provider-confirm-install'));

  await waitFor(() => {
    expect(api.install).toHaveBeenCalledWith(nuvio, {
      language: 'fr-FR',
      region: 'FR',
    });
  });
});

test('provider manifest field follows the app locale without suggesting a source', () => {
  setup('catalog', [], 'fr');

  fireEvent.press(screen.getByTestId('provider-add'));

  expect(screen.getByText('URL du manifeste')).toBeTruthy();
  expect(
    screen.getByPlaceholderText(
      'https://provider.example/manifest.json ou stremio://…',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('provider-manifest-url').props.value).toBe('');
});

test('provider install starts empty and ships no suggested manifest URLs', () => {
  setup();

  fireEvent.press(screen.getByTestId('provider-add'));

  expect(screen.getByTestId('provider-manifest-url').props.value).toBe('');
  expect(screen.queryByText('Suggested sources')).toBeNull();
});

function catalogOnlyInspected() {
  return {
    ...inspected,
    descriptor: {
      ...inspected.descriptor,
      id: 'org.example.catalog',
      name: 'Example Catalog',
      capabilities: ['catalog' as const],
      catalog: {
        catalogs: [
          { type: 'movie' as const, id: 'popular', name: 'Popular', extra: [] },
        ],
      },
    },
  };
}

test('catalog-only add-ons are accepted in Catalogs', async () => {
  const api = setup('catalog');
  (api.inspectManifest as jest.Mock).mockResolvedValue(catalogOnlyInspected());

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://example.com/catalog/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  expect(await screen.findByText('Example Catalog')).toBeTruthy();
});

test('catalog-only add-ons are rejected as playback sources', async () => {
  const api = setup('stream');
  (api.inspectManifest as jest.Mock).mockResolvedValue(catalogOnlyInspected());

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://example.com/catalog/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  expect(await screen.findByText(
    'This add-on does not provide Movies / Series playback streams.',
  )).toBeTruthy();
});

test('Live TV provider installer rejects a movie/series-only manifest', async () => {
  const api = setup('live-tv');

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://example.com/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  expect(await screen.findByText('This add-on is not a Live TV provider.')).toBeTruthy();
  expect(screen.queryByTestId('provider-confirm-install')).toBeNull();
  expect(api.install).not.toHaveBeenCalled();
});


test('configurable provider opens its configuration screen immediately after install', async () => {
  const api = setup();
  const configurableInspected = {
    ...inspected,
    descriptor: {
      ...inspected.descriptor,
      configurable: true,
      configurationFields: [
        {
          key: 'language',
          label: 'Language',
          type: 'text' as const,
          required: false,
          secret: false,
        },
      ],
    },
  };
  const configurableRecord: AddonStateRecord = {
    ...installedRecord,
    installed: {
      ...installedRecord.installed,
      addonId: configurableInspected.descriptor.id,
    },
    descriptor: configurableInspected.descriptor,
  };

  (api.inspectManifest as jest.Mock).mockResolvedValue(configurableInspected);
  (api.install as jest.Mock).mockResolvedValue(configurableRecord);

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    configurableInspected.manifestUrl,
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  await screen.findByText('Example Streams');
  fireEvent.press(screen.getByTestId('provider-confirm-install'));

  await waitFor(() => {
    expect(screen.getByTestId('provider-config-screen')).toBeTruthy();
  });
});


test('configurable provider can replace its manifest with the same addon identity', async () => {
  const configurableRecord: AddonStateRecord = {
    ...installedRecord,
    descriptor: {
      ...installedRecord.descriptor!,
      configurable: true,
    },
  };
  const api = setup('stream', [configurableRecord]);

  fireEvent.press(
    screen.getByTestId(`provider-replace-manifest-${configurableRecord.installed.addonId}`),
  );
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://example.com/private-config/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  await waitFor(() => {
    expect(api.inspectManifest).toHaveBeenCalledWith(
      'https://example.com/private-config/manifest.json',
      'manual',
    );
  });
  fireEvent.press(screen.getByTestId('provider-confirm-install'));

  await waitFor(() => expect(api.install).toHaveBeenCalledWith(inspected, {}));
});

test('manifest replacement rejects a different addon identity', async () => {
  const configurableRecord: AddonStateRecord = {
    ...installedRecord,
    descriptor: {
      ...installedRecord.descriptor!,
      configurable: true,
    },
  };
  const api = setup('stream', [configurableRecord]);
  const different = {
    ...inspected,
    descriptor: {
      ...inspected.descriptor,
      id: 'org.example.different',
    },
  };
  (api.inspectManifest as jest.Mock).mockResolvedValue(different);

  fireEvent.press(
    screen.getByTestId(`provider-replace-manifest-${configurableRecord.installed.addonId}`),
  );
  fireEvent.changeText(
    screen.getByTestId('provider-manifest-url'),
    'https://other.example/manifest.json',
  );
  fireEvent.press(screen.getByTestId('provider-inspect'));

  expect(await screen.findByText(
    'The new manifest URL must belong to the same provider.',
  )).toBeTruthy();
  expect(screen.queryByTestId('provider-confirm-install')).toBeNull();
  expect(api.install).not.toHaveBeenCalled();
});
