import type { AddonMediaRequest } from '../../../addons/src';
import type { StreamSource } from '../../../core/src';
import { PlaybackSessionController } from '../session-controller';

const request: AddonMediaRequest = {
  mediaId: 'movie:1',
  kind: 'movie',
  externalIds: { imdb: 'tt0000001' },
};

const french4k: StreamSource = {
  id: 'fr-4k',
  providerId: 'provider-a',
  sourceId: 'fr-4k',
  url: 'https://example.invalid/fr-4k',
  language: 'fr',
  quality: '2160p',
};

const english1080: StreamSource = {
  id: 'en-1080',
  providerId: 'provider-b',
  sourceId: 'en-1080',
  url: 'https://example.invalid/en-1080',
  language: 'en',
  quality: '1080p',
};

function controller(resolve: (request: AddonMediaRequest) => Promise<StreamSource[]>) {
  return new PlaybackSessionController(
    { resolve },
    () => ({ preferredAudioLanguages: ['en', 'fr', 'de'] }),
  );
}

describe('PlaybackSessionController', () => {
  test('resolves, ranks and auto-selects the best source from current preferences', async () => {
    const session = controller(async () => [french4k, english1080]);

    await expect(session.resolve(request)).resolves.toBe(true);

    expect(session.getState()).toMatchObject({ status: 'ready', selectedSourceId: 'en-1080' });
    expect(session.getState().sources.map((source) => source.id)).toEqual(['en-1080', 'fr-4k']);
  });

  test('manual selection accepts only sources in the active session', async () => {
    const session = controller(async () => [french4k, english1080]);
    await session.resolve(request);

    expect(session.selectSource('fr-4k')).toBe(true);
    expect(session.getState().selectedSourceId).toBe('fr-4k');
    expect(session.selectSource('missing')).toBe(false);
    expect(session.getState().selectedSourceId).toBe('fr-4k');
  });

  test('empty results and resolver failures have explicit states', async () => {
    const empty = controller(async () => []);
    await expect(empty.resolve(request)).resolves.toBe(false);
    expect(empty.getState()).toMatchObject({ status: 'no-sources', selectedSourceId: null, error: null });

    const failed = controller(async () => {
      throw new Error('resolver exploded');
    });
    await expect(failed.resolve(request)).resolves.toBe(false);
    expect(failed.getState()).toMatchObject({ status: 'error', selectedSourceId: null, error: 'resolver exploded' });
  });

  test('resolver errors never retain signed URLs or credentials in session state', async () => {
    const failed = controller(async () => {
      throw new Error(
        'Failed https://provider.example/stream?token=LOCAL-SECRET',
      );
    });

    await failed.resolve(request);

    expect(failed.getState()).toMatchObject({
      status: 'error',
      selectedSourceId: null,
      error: 'Playback sources could not be resolved',
    });
    expect(failed.getState().error).not.toContain('LOCAL-SECRET');
  });



  test('resolver errors never retain session or cookie credentials in session state', async () => {
    for (const message of [
      'provider rejected session=LOCAL-SECRET',
      'Cookie: playback_session=LOCAL-SECRET',
      'Set-Cookie: auth=LOCAL-SECRET; Secure',
    ]) {
      const failed = controller(async () => {
        throw new Error(message);
      });

      await failed.resolve(request);

      expect(failed.getState()).toMatchObject({
        status: 'error',
        selectedSourceId: null,
        error: 'Playback sources could not be resolved',
      });
      expect(failed.getState().error).not.toContain('LOCAL-SECRET');
    }
  });

  test('a stale earlier request cannot overwrite a newer request', async () => {
    let releaseFirst!: (sources: StreamSource[]) => void;
    const firstPromise = new Promise<StreamSource[]>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const session = controller(async () => (++calls === 1 ? firstPromise : [english1080]));

    const first = session.resolve(request);
    const newer: AddonMediaRequest = { ...request, mediaId: 'movie:2' };
    await session.resolve(newer);
    releaseFirst([french4k]);
    await first;

    expect(session.getState().request?.mediaId).toBe('movie:2');
    expect(session.getState().selectedSourceId).toBe('en-1080');
  });

  test('reset invalidates an in-flight request and restores idle state', async () => {
    let release!: (sources: StreamSource[]) => void;
    const pending = new Promise<StreamSource[]>((resolve) => {
      release = resolve;
    });
    const session = controller(async () => pending);

    const run = session.resolve(request);
    session.reset();
    release([english1080]);
    await run;

    expect(session.getState()).toMatchObject({
      status: 'idle',
      request: null,
      sources: [],
      selectedSourceId: null,
      error: null,
    });
  });

  test('subscribers receive state transitions and can unsubscribe', async () => {
    const session = controller(async () => [english1080]);
    const statuses: string[] = [];
    const unsubscribe = session.subscribe((state) => statuses.push(state.status));

    await session.resolve(request);
    unsubscribe();
    session.reset();

    expect(statuses).toEqual(['idle', 'resolving', 'ready']);
  });
});


test('background refresh preserves ready state until fresh sources arrive', async () => {
  let release!: (sources: StreamSource[]) => void;
  let calls = 0;
  const session = controller(async () => {
    calls += 1;
    if (calls === 1) return [english1080];
    return new Promise<StreamSource[]>((resolve) => { release = resolve; });
  });
  await session.resolve(request);
  const refresh = session.refresh();
  expect(session.getState()).toMatchObject({ status: 'ready', selectedSourceId: 'en-1080' });
  release([french4k]);
  await expect(refresh).resolves.toBe(true);
  expect(session.getState()).toMatchObject({ status: 'ready', selectedSourceId: 'fr-4k' });
});

test('failed background refresh keeps current playable sources intact', async () => {
  let calls = 0;
  const session = controller(async () => {
    calls += 1;
    if (calls === 1) return [english1080];
    throw new Error('temporary provider failure');
  });
  await session.resolve(request);
  await expect(session.refresh()).resolves.toBe(false);
  expect(session.getState()).toMatchObject({ status: 'ready', selectedSourceId: 'en-1080' });
  expect(session.getState().sources.map((source) => source.id)).toEqual(['en-1080']);
});

test('empty background refresh keeps current playable sources intact', async () => {
  let calls = 0;
  const session = controller(async () => (++calls === 1 ? [english1080] : []));
  await session.resolve(request);
  await expect(session.refresh()).resolves.toBe(false);
  expect(session.getState()).toMatchObject({ status: 'ready', selectedSourceId: 'en-1080' });
});


test('reset invalidates an in-flight background refresh', async () => {
  let release!: (sources: StreamSource[]) => void;
  let calls = 0;
  const session = controller(async () => {
    calls += 1;
    if (calls === 1) return [english1080];
    return new Promise<StreamSource[]>((resolve) => { release = resolve; });
  });
  await session.resolve(request);
  const refresh = session.refresh();
  session.reset();
  release([french4k]);
  await expect(refresh).resolves.toBe(false);
  expect(session.getState().status).toBe('idle');
});


test('background refresh prefers a newly resolved source over an unchanged selected URL', async () => {
  let calls = 0;
  const old = {
    ...english1080,
    id: 'old-selected',
    url: 'https://example.invalid/old.mp4',
  };
  const fresh = {
    ...french4k,
    id: 'fresh-fallback',
    url: 'https://example.invalid/fresh.mp4',
  };
  const session = controller(async () => {
    calls += 1;
    return calls === 1 ? [old] : [old, fresh];
  });

  await session.resolve(request);
  expect(session.getState().selectedSourceId).toBe(old.id);

  await expect(session.refresh()).resolves.toBe(true);

  expect(session.getState().selectedSourceId).toBe(fresh.id);
});

test('manual source switch made during refresh is not overwritten', async () => {
  let release!: (sources: StreamSource[]) => void;
  let calls = 0;
  const refreshedEnglish = {
    ...english1080,
    url: 'https://example.invalid/en-refreshed.mp4',
  };
  const freshFallback = {
    ...english1080,
    id: 'fresh-fallback',
    url: 'https://example.invalid/fresh-fallback.mp4',
  };

  const session = controller(async () => {
    calls += 1;
    if (calls === 1) return [english1080, french4k];
    return new Promise<StreamSource[]>((resolve) => {
      release = resolve;
    });
  });

  await session.resolve(request);
  const refresh = session.refresh();

  expect(session.selectSource('fr-4k')).toBe(true);
  release([refreshedEnglish, freshFallback, { ...french4k }]);

  await expect(refresh).resolves.toBe(true);
  expect(session.getState().selectedSourceId).toBe('fr-4k');
});

test('background refresh preserves a manually selected source when ranked sources are unchanged', async () => {
  let calls = 0;
  const session = controller(async () => {
    calls += 1;
    return calls === 1
      ? [english1080, french4k]
      : [{ ...french4k }, { ...english1080 }];
  });
  await session.resolve(request);
  expect(session.selectSource('fr-4k')).toBe(true);
  await expect(session.refresh()).resolves.toBe(false);
  expect(session.getState().selectedSourceId).toBe('fr-4k');
});


test('background refresh is ignored outside an active ready session', async () => {
  const session = controller(async () => [english1080]);
  await expect(session.refresh()).resolves.toBe(false);
  expect(session.getState().status).toBe('idle');
});


test('background refresh rejects an identical set after manual source selection', async () => {
  const session = controller(async () => [english1080, french4k]);
  await session.resolve(request);
  expect(session.selectSource('fr-4k')).toBe(true);

  await expect(session.refresh()).resolves.toBe(false);

  expect(session.getState().status).toBe('ready');
  expect(session.getState().selectedSourceId).toBe('fr-4k');
});

test('background refresh rejects an identical source set', async () => {
  const session = controller(async () => [english1080]);
  await session.resolve(request);
  await expect(session.refresh()).resolves.toBe(false);
  expect(session.getState().selectedSourceId).toBe('en-1080');
});

test('source normalization drops blank and duplicate URLs', async () => {
  const session = controller(async () => [
    english1080,
    { ...english1080, id: 'duplicate' },
    { ...french4k, id: '', url: '' },
  ]);
  await session.resolve(request);
  expect(session.getState().sources).toHaveLength(1);
});

test('source normalization drops resolver sources with unbounded headers', async () => {
  const tooMany = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [
      `X-Header-${index}`,
      'value',
    ]),
  );
  const session = controller(async () => [
    {
      ...english1080,
      id: 'too-many-headers',
      headers: tooMany,
    },
    {
      ...french4k,
      id: 'oversized-header',
      headers: {
        'X-Token': 'x'.repeat(2_049),
      },
    },
    english1080,
  ]);

  await session.resolve(request);

  expect(session.getState().sources).toEqual([english1080]);
});

test('source normalization drops oversized and non-network source identity', async () => {
  const session = controller(async () => [
    {
      ...english1080,
      id: 'x'.repeat(513),
    },
    {
      ...french4k,
      id: 'ftp',
      url: 'ftp://cdn.example/video.mp4',
    },
    {
      ...french4k,
      id: 'oversized-url',
      url: `https://cdn.example/${'x'.repeat(8_200)}`,
    },
    english1080,
  ]);

  await session.resolve(request);

  expect(session.getState().sources).toEqual([english1080]);
});

test('subscriber failures cannot break playback state transitions', async () => {
  const session = controller(async () => [english1080]);
  session.subscribe(() => { throw new Error('broken listener'); });
  await session.resolve(request);
  expect(session.getState().status).toBe('ready');
});


test('refresh accepts improved transport metadata on the same URL', async () => {
  let calls = 0;
  const initial: StreamSource = {
    ...english1080,
    id: 'opaque',
    url: 'https://example.invalid/play/opaque',
  };
  const enriched: StreamSource = {
    ...initial,
    filename: 'Movie.Name.2026.1080p.m3u8',
    contentType: 'application/vnd.apple.mpegurl',
  };
  const session = controller(async () => (
    ++calls === 1 ? [initial] : [enriched]
  ));

  await session.resolve(request);

  await expect(session.refresh()).resolves.toBe(true);
  expect(session.getState().selectedSourceId).toBe('opaque');
  expect(session.getState().sources[0]).toEqual(
    expect.objectContaining({
      filename: 'Movie.Name.2026.1080p.m3u8',
      contentType: 'application/vnd.apple.mpegurl',
    }),
  );
});

test('refresh accepts improved compatibility metadata on the same URL', async () => {
  let calls = 0;
  const initial: StreamSource = {
    ...english1080,
    id: 'opaque-compat',
    url: 'https://example.invalid/play/opaque-compat',
  };
  const enriched: StreamSource = {
    ...initial,
    audioCodec: 'truehd',
    dynamicRange: 'dolby-vision',
  };
  const session = controller(async () => (
    ++calls === 1 ? [initial] : [enriched]
  ));

  await session.resolve(request);

  await expect(session.refresh()).resolves.toBe(true);
  expect(session.getState().sources[0]).toEqual(
    expect.objectContaining({
      audioCodec: 'truehd',
      dynamicRange: 'dolby-vision',
    }),
  );
});

test('refresh accepts newly discovered exact codec profile metadata', async () => {
  let calls = 0;
  const initial: StreamSource = {
    ...english1080,
    id: 'opaque-codec-profile',
    url: 'https://example.invalid/play/opaque-codec-profile',
    codec: 'h265',
  };
  const enriched: StreamSource = {
    ...initial,
    codecDetail: 'hvc1.1.6.L93.B0',
  };
  const session = controller(async () => (
    ++calls === 1 ? [initial] : [enriched]
  ));

  await session.resolve(request);

  await expect(session.refresh()).resolves.toBe(true);
  expect(session.getState().sources[0]).toEqual(
    expect.objectContaining({
      codec: 'h265',
      codecDetail: 'hvc1.1.6.L93.B0',
    }),
  );
});

test('refresh still rejects the same URL when transport metadata is unchanged', async () => {
  const source: StreamSource = {
    ...english1080,
    id: 'opaque',
    url: 'https://example.invalid/play/opaque',
    contentType: 'video/mp4',
  };
  const session = controller(async () => {
    return [{ ...source }];
  });

  await session.resolve(request);

  await expect(session.refresh()).resolves.toBe(false);
});

test('refresh ignores MIME parameter-only changes when compatibility metadata is stable', async () => {
  let calls = 0;
  const initial: StreamSource = {
    ...english1080,
    id: 'stable-mime',
    url: 'https://example.invalid/play/stable-mime',
    contentType: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
    codec: 'h264',
  };
  const reformatted: StreamSource = {
    ...initial,
    contentType: ' Video/MP4 ; codecs="avc1.42E01E, mp4a.40.2" ',
  };
  const session = controller(async () => (
    ++calls === 1 ? [initial] : [reformatted]
  ));

  await session.resolve(request);

  await expect(session.refresh()).resolves.toBe(false);
  expect(session.getState().sources[0]).toEqual(initial);
});

test('refresh with stable source id selects its renewed signed URL', async () => {
  let calls = 0;
  const oldSource = { ...english1080, url: 'https://example.invalid/video?token=old' };
  const renewed = { ...english1080, url: 'https://example.invalid/video?token=new' };
  const session = controller(async () => (++calls === 1 ? [oldSource] : [renewed]));
  await session.resolve(request);
  await expect(session.refresh()).resolves.toBe(true);
  expect(session.getState().sources[0]?.url).toContain('token=new');
  expect(session.getState().selectedSourceId).toBe(english1080.id);
});


test('source normalization rejects conflicting duplicate source ids', async () => {
  const session = controller(async () => [
    english1080,
    { ...french4k, id: english1080.id },
  ]);
  await session.resolve(request);
  expect(session.getState().sources.filter((source) => source.id === english1080.id)).toHaveLength(1);
});

test('blank source selection is rejected', async () => {
  const session = controller(async () => [english1080]);
  await session.resolve(request);
  expect(session.selectSource('   ')).toBe(false);
});


test('session source identity is independent of locale-sensitive header ordering', async () => {
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);
  try {
    const first = {
      ...english1080,
      headers: {
        'X-É': 'value-b',
        'X-A': 'value-a',
      },
    };
    const duplicate = {
      ...english1080,
      id: 'duplicate',
      headers: {
        'x-a': 'value-a',
        'x-é': 'value-b',
      },
    };
    const session = controller(async () => [first, duplicate]);

    await session.resolve(request);

    expect(session.getState().sources).toHaveLength(1);
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});


test('provider outage during refresh promotes the session to a recoverable error', async () => {
  let calls = 0;
  const session = controller(async () => {
    calls += 1;
    if (calls === 1) return [english1080];
    throw new Error('Playback providers are unavailable');
  });

  await session.resolve(request);
  await expect(session.refresh()).resolves.toBe(false);

  expect(session.getState()).toMatchObject({
    status: 'error',
    request,
    sources: [],
    selectedSourceId: null,
    error: 'Playback providers are unavailable',
  });
});

test('generic refresh failures still preserve the current playable session', async () => {
  let calls = 0;
  const session = controller(async () => {
    calls += 1;
    if (calls === 1) return [english1080];
    throw new Error('temporary provider failure');
  });

  await session.resolve(request);
  await expect(session.refresh()).resolves.toBe(false);

  expect(session.getState()).toMatchObject({
    status: 'ready',
    selectedSourceId: 'en-1080',
  });
});
