import type { StreamSource } from '@moviestv/core';
import {
  isRemuxedSource,
  remuxBaseUrl,
  remuxFallbackAvailable,
  requestRemuxSource,
  unplayableSourceMessage,
} from '../webRemuxFallback';

const ENV_KEY = 'EXPO_PUBLIC_REMUX_URL';
const source: StreamSource = {
  id: 'src-1',
  url: 'https://provider.example/signed/secret-token/movie.mkv?sig=abc123',
  filename: 'movie.1080p.EAC3.mkv',
  name: 'Movie',
  providerId: 'lumio',
  headers: { Referer: 'https://provider.example/', 'User-Agent': 'MoviesTvFlix/1.0' },
};

describe('remux fallback configuration', () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('is unavailable without a configured base URL', () => {
    delete process.env[ENV_KEY];
    expect(remuxBaseUrl()).toBeNull();
    expect(remuxFallbackAvailable()).toBe(false);
  });

  it('rejects a non-http base URL and trailing slashes', () => {
    process.env[ENV_KEY] = 'file:///tmp/remux';
    expect(remuxBaseUrl()).toBeNull();
    process.env[ENV_KEY] = 'https://remux.example.com/';
    expect(remuxBaseUrl()).toBe('https://remux.example.com');
    expect(remuxFallbackAvailable()).toBe(true);
  });
});

describe('requestRemuxSource', () => {
  const original = process.env[ENV_KEY];
  beforeEach(() => {
    process.env[ENV_KEY] = 'https://remux.example.com';
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('posts the signed URL and provider headers in the body, never the query', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ id: 'abc', playlist: '/sessions/abc/index.m3u8', audio: 'transcode-aac' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await requestRemuxSource(source, fetcher);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://remux.example.com/sessions');
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].url)).not.toContain('secret-token');
    expect(String(calls[0].url)).not.toContain('sig=');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.url).toBe(source.url);
    expect(body.headers).toEqual(source.headers);
    expect(result).toMatchObject({
      url: 'https://remux.example.com/sessions/abc/index.m3u8',
      contentType: 'application/vnd.apple.mpegurl',
      quality: undefined,
    });
  });

  it('returns an HLS source that keeps display metadata but no headers', async () => {
    const fetcher = (async () => ({
      ok: true,
      json: async () => ({ id: 'abc', playlist: '/sessions/abc/index.m3u8', audio: 'copy' }),
    }) as unknown as Response) as unknown as typeof fetch;

    const result = await requestRemuxSource(source, fetcher);

    expect(result?.headers).toBeUndefined();
    expect(result?.filename).toBe('movie.1080p.EAC3.mkv');
    expect(result?.providerId).toBe('lumio');
    expect(isRemuxedSource(result!)).toBe(true);
  });

  it('never sends a remuxed source through the fallback twice', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return { ok: true, json: async () => ({ playlist: '/sessions/a/index.m3u8' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const first = await requestRemuxSource(source, fetcher);
    const second = await requestRemuxSource(first!, fetcher);

    expect(calls).toBe(1);
    expect(second).toBeNull();
  });

  it('returns null instead of throwing when the service refuses', async () => {
    const refused = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const broken = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const garbage = (async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }) as unknown as Response) as unknown as typeof fetch;

    expect(await requestRemuxSource(source, refused)).toBeNull();
    expect(await requestRemuxSource(source, broken)).toBeNull();
    expect(await requestRemuxSource(source, garbage)).toBeNull();
  });

  it('does not log the signed URL or the provider headers', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;

    await requestRemuxSource(source, fetcher);
    await requestRemuxSource(source, (async () => { throw new Error('down'); }) as unknown as typeof fetch);

    const printed = [spy, warn, error].flatMap((s) => s.mock.calls.flat().map(String)).join(' ');
    expect(printed).not.toContain('secret-token');
    expect(printed).not.toContain('sig=abc123');
    expect(printed).not.toContain('MoviesTvFlix/1.0');
    spy.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('unplayableSourceMessage', () => {
  it('names the container and the audio codec', () => {
    const message = unplayableSourceMessage(source, { remuxConfigured: false });
    expect(message).toContain('MKV · E-AC-3');
    expect(message).toContain('Choose another source');
  });

  it('mentions the native player when the wrapper provides one', () => {
    const message = unplayableSourceMessage(source, { nativePlayerAvailable: true });
    expect(message).toContain('native player');
  });

  it('never includes the URL or a token', () => {
    const message = unplayableSourceMessage(source, { remuxConfigured: false });
    expect(message).not.toContain('secret-token');
    expect(message).not.toContain('https://provider.example');
  });
});
