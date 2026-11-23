import { dedupeStreamSources, normalizeStreamCandidates } from '../streams';

describe('stream content type normalization', () => {
  test('preserves safe MIME hints from common provider fields', () => {
    const [fromContentType] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'hls',
        url: 'https://cdn.example/opaque/123',
        contentType: 'Application/Vnd.Apple.MpegURL; charset=utf-8',
      }],
    });
    const [fromMimeType] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'mp4',
        url: 'https://cdn.example/opaque/456',
        mimeType: 'video/mp4',
      }],
    });
    const [fromHints] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'hinted',
        url: 'https://cdn.example/opaque/789',
        behaviorHints: {
          contentType: 'application/x-mpegURL',
        },
      }],
    });

    expect(fromContentType?.contentType)
      .toBe('application/vnd.apple.mpegurl');
    expect(fromMimeType?.contentType).toBe('video/mp4');
    expect(fromHints?.contentType).toBe('application/x-mpegurl');
  });

  test('preserves video codec information declared only in MIME parameters', () => {
    const [hevc] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'hevc-mime',
        url: 'https://cdn.example/opaque/hevc',
        contentType: 'Video/MP4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"',
      }],
    });
    const [av1] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'av1-mime',
        url: 'https://cdn.example/opaque/av1',
        mimeType: 'video/mp4; codecs=av01.0.05M.08',
      }],
    });

    expect(hevc).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
      codec: 'h265',
      codecDetail: 'hvc1.1.6.L93.B0',
    }));
    expect(av1).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
      codec: 'av1',
      codecDetail: 'av01.0.05M.08',
    }));
  });

  test('preserves Dolby Vision declared only through MIME codec metadata', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'dolby-vision-mime',
        url: 'https://cdn.example/opaque/dolby-vision',
        contentType: 'video/mp4; codecs="dvh1.05.06, ec-3"',
      }],
    });

    expect(source).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
      codec: 'h265',
      codecDetail: 'dvh1.05.06',
      dynamicRange: 'dolby-vision',
    }));
  });

  test('preserves risky audio codec information declared only in MIME parameters', () => {
    const [truehd] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'truehd-mime',
        url: 'https://cdn.example/opaque/truehd',
        contentType: 'video/mp4; codecs="avc1.4d401f, mlpa"',
      }],
    });
    const [dts] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'dts-mime',
        url: 'https://cdn.example/opaque/dts',
        mimeType: 'video/mp4; codecs="hvc1.1.6.L93.B0, dtsc"',
      }],
    });

    expect(truehd).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
      codec: 'h264',
      codecDetail: 'avc1.4d401f',
      audioCodec: 'truehd',
    }));
    expect(dts).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
      codec: 'h265',
      codecDetail: 'hvc1.1.6.L93.B0',
      audioCodec: 'dts',
    }));
  });

  test('normalizes parameterized MIME metadata declared through stream tags', () => {
    const [mp4] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'tagged-mp4',
        url: 'https://cdn.example/opaque/tagged-mp4',
        tag: 'Video/MP4; codecs="avc1.4d401f, mlpa"',
      }],
    });
    const [dash] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'tagged-dash',
        url: 'https://cdn.example/opaque/tagged-dash',
        tags: ['application/dash+xml; profile=main'],
      }],
    });

    expect(mp4).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
      codec: 'h264',
      codecDetail: 'avc1.4d401f',
      audioCodec: 'truehd',
    }));
    expect(dash).toEqual(expect.objectContaining({
      contentType: 'application/dash+xml',
      webReady: false,
    }));
  });

  test('accepts a MIME-shaped stream.type fallback but ignores ordinary type labels', () => {
    const [mime] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'mime',
        url: 'https://cdn.example/opaque/1',
        type: 'video/quicktime',
      }],
    });
    const [ordinary] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'ordinary',
        url: 'https://cdn.example/opaque/2',
        type: 'movie',
      }],
    });

    expect(mime?.contentType).toBe('video/quicktime');
    expect(ordinary?.contentType).toBeUndefined();
  });

  test('retains MIME metadata through stream deduplication', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'hls',
        url: 'https://cdn.example/opaque/stream',
        contentType: 'application/vnd.apple.mpegurl',
      }],
    });

    const [deduped] = dedupeStreamSources([[source!]]);

    expect(deduped?.contentType)
      .toBe('application/vnd.apple.mpegurl');
  });

  test('enriches an earlier duplicate with later transport metadata', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared',
        name: 'Preferred first result',
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared',
        name: 'Lower-priority duplicate',
        filename: 'Movie.Name.2026.1080p.m3u8',
        contentType: 'application/vnd.apple.mpegurl',
        webReady: false,
      },
    ]]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      name: 'Preferred first result',
      filename: 'Movie.Name.2026.1080p.m3u8',
      contentType: 'application/vnd.apple.mpegurl',
      webReady: false,
    }));
  });

  test('enriches a duplicate with missing video codec metadata', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-codec',
        name: 'Preferred',
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-codec',
        name: 'Rich duplicate',
        contentType: 'video/mp4',
        codec: 'h264',
      },
    ]]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      contentType: 'video/mp4',
      codec: 'h264',
    }));
  });

  test('enriches duplicate compatibility metadata', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared',
        name: 'Preferred',
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared',
        name: 'Rich duplicate',
        audioCodec: 'truehd',
        dynamicRange: 'dolby-vision',
      },
    ]]);

    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      audioCodec: 'truehd',
      dynamicRange: 'dolby-vision',
    }));
  });

  test('enriches duplicate language metadata without losing provider priority', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-languages',
        name: 'Preferred',
        audioLanguages: ['en'],
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-languages',
        name: 'Rich duplicate',
        language: 'fr',
        audioLanguages: ['fr', 'de'],
        subtitleLanguages: ['fr', 'en'],
      },
    ]]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      language: 'fr',
      audioLanguages: ['en', 'fr', 'de'],
      subtitleLanguages: ['fr', 'en'],
    }));
  });

  test('enriches duplicate ranking metadata without losing provider priority', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-ranking',
        name: 'Preferred',
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-ranking',
        name: 'Rich duplicate',
        quality: '2160p',
        sizeBytes: 8 * 1024 ** 3,
      },
    ]]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      quality: '2160p',
      sizeBytes: 8 * 1024 ** 3,
    }));
  });

  test('does not overwrite ranking metadata already supplied by the first duplicate', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-ranking-priority',
        quality: '1080p',
        sizeBytes: 4 * 1024 ** 3,
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared-ranking-priority',
        quality: '2160p',
        sizeBytes: 8 * 1024 ** 3,
      },
    ]]);

    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      quality: '1080p',
      sizeBytes: 4 * 1024 ** 3,
    }));
  });

  test('does not overwrite stronger transport metadata from the first duplicate', () => {
    const deduped = dedupeStreamSources([[
      {
        id: 'first',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared',
        filename: 'preferred.mp4',
        contentType: 'video/mp4',
      },
      {
        id: 'second',
        providerId: 'provider',
        url: 'https://cdn.example/opaque/shared',
        filename: 'later.mkv',
        contentType: 'video/x-matroska',
      },
    ]]);

    expect(deduped[0]).toEqual(expect.objectContaining({
      id: 'first',
      filename: 'preferred.mp4',
      contentType: 'video/mp4',
    }));
  });

  test('rejects malformed or oversized MIME metadata', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'unsafe',
        url: 'https://cdn.example/opaque/3',
        contentType: 'video/mp4\r\nX-Evil: yes',
        mimeType: 'x'.repeat(129),
      }],
    });

    expect(source?.contentType).toBeUndefined();
  });
});
