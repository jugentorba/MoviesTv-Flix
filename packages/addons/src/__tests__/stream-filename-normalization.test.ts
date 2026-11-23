import { normalizeStreamCandidates } from '../streams';

describe('stream filename normalization', () => {
  it('preserves a top-level provider filename for browser compatibility checks', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'direct-file',
        name: 'French 1080p',
        filename: 'Movie.Name.2026.FRENCH.1080p.H264.mkv',
        url: 'https://cdn.example/play/opaque-signed-id',
      }],
    });

    expect(source).toEqual(expect.objectContaining({
      id: 'provider:direct-file',
      filename: 'Movie.Name.2026.FRENCH.1080p.H264.mkv',
      language: 'fr',
      quality: '1080p',
      codec: 'h264',
      webReady: false,
    }));
  });

  it('extracts a filename-looking token from a Stremio title when the URL is opaque', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'title-file',
        name: 'AllDebrid',
        title: '⚡ Movie.Name.2026.FRENCH.1080p.H264.mkv 2.5GB',
        url: 'https://cdn.example/play/opaque-signed-id',
      }],
    });

    expect(source).toEqual(expect.objectContaining({
      id: 'provider:title-file',
      filename: 'Movie.Name.2026.FRENCH.1080p.H264.mkv',
      language: 'fr',
      quality: '1080p',
      codec: 'h264',
      webReady: false,
      sizeBytes: Math.round(2.5 * 1024 ** 3),
    }));
  });

  it('does not turn ordinary provider or movie names into fake filenames', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'plain-label',
        name: 'Avi Club',
        title: 'Dash 1080p H264',
        url: 'https://cdn.example/play/opaque-signed-id',
      }],
    });

    expect(source?.filename).toBeUndefined();
    expect(source?.webReady).toBeUndefined();
  });

  it('extracts browser-playable MP4 filenames too', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'mp4-title',
        title: 'Direct Movie.Name.2026.FRENCH.1080p.H264.mp4',
        url: 'https://cdn.example/play/opaque-signed-id',
      }],
    });

    expect(source).toEqual(expect.objectContaining({
      filename: 'Movie.Name.2026.FRENCH.1080p.H264.mp4',
      language: 'fr',
      quality: '1080p',
      codec: 'h264',
    }));
    expect(source?.webReady).toBeUndefined();
  });
});
