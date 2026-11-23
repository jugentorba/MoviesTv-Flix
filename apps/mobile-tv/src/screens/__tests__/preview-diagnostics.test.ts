import {
  accountPreviewDiagnostic,
  browserMediaPreviewDiagnostics,
  collectPreviewDiagnostics,
  endpointPreviewDiagnostic,
  pwaBuildIdFromCacheKeys,
  pwaBuildIdFromDocument,
  pwaBuildIdFromServiceWorker,
  pwaUpdateDiagnostic,
  providerPreviewDiagnostics,
  previewBuildDiagnostic,
  secureContextPreviewDiagnostic,
  webTvLayoutPreviewDiagnostic,
} from '../PreviewDiagnosticsScreen';

test('preview diagnostics report account sync readiness without exposing identity', () => {
  expect(accountPreviewDiagnostic({
    backendAvailable: false,
    signedIn: false,
    loading: false,
  })).toEqual(expect.objectContaining({
    id: 'account-sync',
    status: 'warn',
    detail: 'Guest mode — backend not configured',
  }));

  expect(accountPreviewDiagnostic({
    backendAvailable: true,
    signedIn: false,
    loading: false,
  })).toEqual(expect.objectContaining({
    status: 'pass',
    detail: 'Backend available · signed out',
  }));

  expect(accountPreviewDiagnostic({
    backendAvailable: true,
    signedIn: true,
    loading: false,
  })).toEqual(expect.objectContaining({
    status: 'pass',
    detail: 'Backend available · signed in',
  }));
});

test('preview diagnostics keep backend discovery loading non-failing', () => {
  expect(accountPreviewDiagnostic({
    backendAvailable: false,
    signedIn: false,
    loading: true,
  })).toEqual(expect.objectContaining({
    status: 'info',
    detail: 'Checking backend configuration',
  }));
});


test('preview endpoint diagnostics time out instead of hanging', async () => {
  jest.useFakeTimers();
  const fetcher = jest.fn(() => new Promise<any>(() => undefined));

  try {
    const pending = endpointPreviewDiagnostic(
      '/api/runtime-config',
      'Runtime config route',
      true,
      fetcher,
      100,
    );

    await jest.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual(expect.objectContaining({
      id: '/api/runtime-config',
      status: 'fail',
      detail: 'Request timed out',
    }));
  } finally {
    jest.useRealTimers();
  }
});

test('preview endpoint diagnostics bypass browser caches', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ ok: true }),
  }));

  await expect(endpointPreviewDiagnostic(
    '/api/runtime-config',
    'Runtime config route',
    true,
    fetcher,
    100,
  )).resolves.toEqual(expect.objectContaining({
    status: 'pass',
    detail: 'Available',
  }));

  expect(fetcher).toHaveBeenCalledWith(
    '/api/runtime-config',
    expect.objectContaining({
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
    }),
  );
});


test('preview endpoint diagnostics reject oversized response bodies', async () => {
  const declared = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (
        name.toLowerCase() === 'content-length' ? '300000' : null
      ),
    },
    text: async () => JSON.stringify({ ok: true }),
  }));

  await expect(endpointPreviewDiagnostic(
    '/api/runtime-config',
    'Runtime config route',
    true,
    declared,
    100,
  )).resolves.toEqual(expect.objectContaining({
    status: 'fail',
    detail: 'Request failed',
  }));

  const actual = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ payload: 'x'.repeat(300_000) }),
  }));

  await expect(endpointPreviewDiagnostic(
    '/api/runtime-config',
    'Runtime config route',
    true,
    actual,
    100,
  )).resolves.toEqual(expect.objectContaining({
    status: 'fail',
    detail: 'Request failed',
  }));
});

test('preview endpoint diagnostics reject non-JSON runtime routes', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '<html>app shell</html>',
  }));

  await expect(endpointPreviewDiagnostic(
    '/api/runtime-config',
    'Runtime config route',
    true,
    fetcher,
    100,
  )).resolves.toEqual(expect.objectContaining({
    status: 'fail',
    detail: 'Route returned non-JSON content',
  }));
});


test('extracts the active stamped PWA build id from cache storage', () => {
  expect(pwaBuildIdFromCacheKeys([
    'other-cache',
    'moviestv-shell-0123456789abcdef',
  ])).toBe('0123456789abcdef');

  expect(pwaBuildIdFromCacheKeys([
    'moviestv-shell-__MOVIESTV_BUILD_ID__',
    'moviestv-shell-not-a-build',
  ])).toBeNull();
});


test('reports provider readiness without provider identities', () => {
  const items = providerPreviewDiagnostics([
    {
      installed: { enabled: true, setupIncomplete: false },
      descriptor: { capabilities: ['catalog'] },
    },
    {
      installed: { enabled: true, setupIncomplete: true },
      descriptor: { capabilities: ['stream', 'subtitle'] },
    },
    {
      installed: { enabled: false, setupIncomplete: false },
      descriptor: { capabilities: ['live-tv'] },
    },
  ] as any, true, 'synced');

  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'providers-catalog',
      detail: '1 ready / 1 installed',
    }),
    expect.objectContaining({
      id: 'providers-stream',
      status: 'warn',
      detail: '0 ready / 1 installed · 1 setup required',
    }),
    expect.objectContaining({
      id: 'providers-subtitle',
      status: 'warn',
      detail: '0 ready / 1 installed · 1 setup required',
    }),
    expect.objectContaining({
      id: 'providers-live-tv',
      detail: '0 ready / 1 installed · 1 disabled',
    }),
    expect.objectContaining({
      id: 'providers-sync',
      detail: 'synced',
    }),
  ]));

  expect(JSON.stringify(items)).not.toContain('manifest');
  expect(JSON.stringify(items)).not.toContain('url');
});


test('reads the stamped build id from the running PWA document', () => {
  const documentObject = {
    querySelector: (selector: string) => (
      selector === 'meta[name="moviestv-build-id"]'
        ? { content: 'ABCDEF0123456789' }
        : null
    ),
  };

  expect(pwaBuildIdFromDocument(documentObject))
    .toBe('abcdef0123456789');
  expect(pwaBuildIdFromDocument({
    querySelector: () => ({ content: 'not-a-build' }),
  })).toBeNull();
});

test('compares the running PWA page with the network service worker build', () => {
  expect(pwaBuildIdFromServiceWorker(
    "const CACHE = 'moviestv-shell-fedcba9876543210';",
  )).toBe('fedcba9876543210');
  expect(pwaBuildIdFromServiceWorker(
    "const CACHE = 'moviestv-shell-__MOVIESTV_BUILD_ID__';",
  )).toBeNull();
  expect(pwaBuildIdFromServiceWorker(
    "const CACHE = 'moviestv-shell-__MOVIESTV_BUILD_ID__'; // old moviestv-shell-0123456789abcdef",
  )).toBeNull();

  expect(pwaUpdateDiagnostic(
    '0123456789abcdef',
    '0123456789abcdef',
  )).toEqual(expect.objectContaining({
    status: 'pass',
    detail: 'Current',
  }));

  expect(pwaUpdateDiagnostic(
    '0123456789abcdef',
    'fedcba9876543210',
  )).toEqual(expect.objectContaining({
    status: 'warn',
    detail: 'Update available · fedcba9876543210',
  }));

  expect(pwaUpdateDiagnostic(
    null,
    'fedcba9876543210',
  )).toEqual(expect.objectContaining({
    status: 'warn',
    detail:
      'Running page build ID unavailable · network fedcba9876543210',
  }));
});


test('shows only a bounded hexadecimal native build revision', () => {
  expect(previewBuildDiagnostic(
    'ABCDEF1234567890',
  )).toEqual(expect.objectContaining({
    status: 'pass',
    detail: 'abcdef1234567890',
  }));

  expect(previewBuildDiagnostic(
    'not-a-safe-build-id https://secret.example',
  )).toEqual(expect.objectContaining({
    status: 'info',
    detail: 'Not stamped',
  }));
});


test('reports browser media capabilities including HEVC and AV1', () => {
  const canPlayType = jest.fn((type: string) => {
    if (type.includes('avc1')) return 'probably';
    if (type.includes('dvh1')) return 'probably';
    if (type.includes('hvc1')) return 'maybe';
    if (type.includes('av01')) return '';
    if (type.includes('dtsc')) return '';
    if (type.includes('mlpa')) return 'maybe';
    if (type === 'application/vnd.apple.mpegurl') return 'maybe';
    if (type === 'video/webm') return '';
    return '';
  });

  expect(browserMediaPreviewDiagnostics(canPlayType, false)).toEqual([
    {
      id: 'h264',
      label: 'H.264 MP4',
      status: 'pass',
      detail: 'probably',
    },
    {
      id: 'hevc',
      label: 'HEVC / H.265 MP4',
      status: 'pass',
      detail: 'maybe',
    },
    {
      id: 'av1',
      label: 'AV1 MP4',
      status: 'info',
      detail: 'Browser did not advertise support',
    },
    {
      id: 'dolby-vision',
      label: 'Dolby Vision',
      status: 'pass',
      detail: 'probably',
    },
    {
      id: 'dts',
      label: 'DTS audio',
      status: 'info',
      detail: 'Browser did not advertise support',
    },
    {
      id: 'truehd',
      label: 'TrueHD audio',
      status: 'pass',
      detail: 'maybe',
    },
    {
      id: 'native-hls',
      label: 'Native HLS',
      status: 'pass',
      detail: 'maybe',
    },
    {
      id: 'webm',
      label: 'WebM',
      status: 'info',
      detail: 'Not advertised by this browser',
    },
    {
      id: 'hls-path',
      label: 'HLS playback path',
      status: 'pass',
      detail: 'Native HLS',
    },
  ]);
});

test('recognizes native HLS through the alternate Safari MIME type', () => {
  const diagnostics = browserMediaPreviewDiagnostics(
    (type) => type === 'application/x-mpegURL' ? 'maybe' : '',
    false,
  );

  expect(diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'native-hls', status: 'pass', detail: 'maybe' }),
    expect.objectContaining({ id: 'hls-path', status: 'pass', detail: 'Native HLS' }),
  ]));
});

test('browser media diagnostics tolerate canPlayType failures', () => {
  expect(browserMediaPreviewDiagnostics(() => {
    throw new Error('unsupported probe');
  }, true)).toEqual([
    expect.objectContaining({ id: 'h264', status: 'warn' }),
    expect.objectContaining({ id: 'hevc', status: 'info' }),
    expect.objectContaining({ id: 'av1', status: 'info' }),
    expect.objectContaining({ id: 'dolby-vision', status: 'info' }),
    expect.objectContaining({ id: 'dts', status: 'info' }),
    expect.objectContaining({ id: 'truehd', status: 'info' }),
    expect.objectContaining({ id: 'native-hls', status: 'info' }),
    expect.objectContaining({ id: 'webm', status: 'info' }),
    expect.objectContaining({
      id: 'hls-path',
      status: 'pass',
      detail: 'hls.js via Media Source Extensions',
    }),
  ]);
});

test('reports when the browser has no usable HLS playback path', () => {
  const diagnostics = browserMediaPreviewDiagnostics(() => '', false);

  expect(diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'hls-path',
      status: 'fail',
      detail: 'No native HLS or H.264 Media Source Extensions',
    }),
  ]));
});


test('does not count a subtitle-only addon as a ready stream provider', () => {
  const items = providerPreviewDiagnostics([
    {
      installed: { enabled: true, setupIncomplete: false },
      descriptor: { capabilities: ['subtitle'] },
    },
  ] as any, true, 'local');

  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'providers-stream',
      status: 'warn',
      detail: '0 ready / 0 installed',
    }),
    expect.objectContaining({
      id: 'providers-subtitle',
      status: 'pass',
      detail: '1 ready / 1 installed',
    }),
  ]));
});


test('reports whether the PWA is running in a secure context', () => {
  expect(secureContextPreviewDiagnostic(true)).toEqual({
    id: 'secure-context',
    label: 'Secure context',
    status: 'pass',
    detail: 'HTTPS / trusted context',
  });
  expect(secureContextPreviewDiagnostic(false)).toEqual({
    id: 'secure-context',
    label: 'Secure context',
    status: 'fail',
    detail: 'Browser does not consider this page secure',
  });
  expect(secureContextPreviewDiagnostic(undefined)).toEqual({
    id: 'secure-context',
    label: 'Secure context',
    status: 'info',
    detail: 'Secure-context capability unavailable',
  });
});


test('collects the stamped native build revision from the Expo environment', async () => {
  const previous = process.env.EXPO_PUBLIC_BUILD_SHA;
  process.env.EXPO_PUBLIC_BUILD_SHA = 'abcdef123456';

  try {
    const diagnostics = await collectPreviewDiagnostics('phone');
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'native-build-id',
        status: 'pass',
        detail: 'abcdef123456',
      }),
    ]));
  } finally {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_BUILD_SHA;
    } else {
      process.env.EXPO_PUBLIC_BUILD_SHA = previous;
    }
  }
});

test('explains whether web TV layout is automatic or device-forced', () => {
  expect(webTvLayoutPreviewDiagnostic('tv', false)).toEqual({
    id: 'web-tv-layout',
    label: 'TV layout mode',
    status: 'pass',
    detail: 'Auto-detected TV',
  });
  expect(webTvLayoutPreviewDiagnostic('tv', true)).toEqual({
    id: 'web-tv-layout',
    label: 'TV layout mode',
    status: 'pass',
    detail: 'Forced on this browser',
  });
  expect(webTvLayoutPreviewDiagnostic('tablet', false)).toEqual({
    id: 'web-tv-layout',
    label: 'TV layout mode',
    status: 'info',
    detail: 'Automatic',
  });
});

