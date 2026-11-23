import { fetchBoundedText } from '../HttpTextLoader';

function response(
  body: string,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    length?: string | null;
  } = {},
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText,
    headers: {
      get: (name: string) => (
        name.toLowerCase() === 'content-length'
          ? (options.length ?? null)
          : null
      ),
    },
    text: async () => body,
  };
}

describe('bounded guide text loader', () => {
  test('loads text with secure redirects enabled', async () => {
    const fetcher = jest.fn(async (_url: string, init: any) => {
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
      });
      return response('<tv/>');
    });

    await expect(
      fetchBoundedText(fetcher, 'https://guide.example/epg.xml'),
    ).resolves.toBe('<tv/>');
  });

  test('rejects a redirect that downgrades to insecure HTTP', async () => {
    const fetcher = async () => ({
      ...response('<tv/>'),
      url: 'http://guide.example/epg.xml',
    });

    await expect(
      fetchBoundedText(fetcher as any, 'https://guide.example/epg.xml'),
    ).rejects.toThrow('redirect must remain secure HTTPS');
  });

  test('rejects non-success responses', async () => {
    const fetcher = async () => response('nope', {
      ok: false,
      status: 503,
      statusText: 'Unavailable',
    });

    await expect(
      fetchBoundedText(fetcher as any, 'https://guide.example/epg.xml'),
    ).rejects.toThrow('Guide request failed with 503 Unavailable');
  });

  test('rejects declared and actual bodies larger than configured limit', async () => {
    const declared = async () => response('tiny', { length: '100' });
    await expect(
      fetchBoundedText(
        declared as any,
        'https://guide.example/epg.xml',
        1000,
        10,
      ),
    ).rejects.toThrow('Guide feed is too large');

    const actual = async () => response('éééééé');
    await expect(
      fetchBoundedText(
        actual as any,
        'https://guide.example/epg.xml',
        1000,
        10,
      ),
    ).rejects.toThrow('Guide feed is too large');
  });

  test('reads chunked XMLTV text without requiring Content-Length', async () => {
    const bytes = Buffer.from('<tv><channel id="c"><display-name>Café</display-name></channel></tv>', 'utf8');
    const chunks = [
      new Uint8Array(bytes.subarray(0, bytes.length - 3)),
      new Uint8Array(bytes.subarray(bytes.length - 3)),
    ];
    let index = 0;

    const fetcher = async () => ({
      ...response('should-not-use-text'),
      body: {
        getReader: () => ({
          read: async () => (
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true }
          ),
          cancel: jest.fn(),
        }),
      },
      text: async () => {
        throw new Error('streaming path should not call text()');
      },
    });

    await expect(
      fetchBoundedText(
        fetcher as any,
        'https://guide.example/epg.xml',
        1000,
        1024,
      ),
    ).resolves.toContain('Café');
  });

  test('cancels an oversized chunked XMLTV body early', async () => {
    const cancel = jest.fn(async () => undefined);
    let index = 0;
    const chunks = [
      new Uint8Array(Buffer.from('<tv>12345')),
      new Uint8Array(Buffer.from('678901</tv>')),
    ];
    const fetcher = async () => ({
      ...response('should-not-use-text'),
      body: {
        getReader: () => ({
          read: async () => (
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true }
          ),
          cancel,
        }),
      },
      text: async () => {
        throw new Error('streaming path should not call text()');
      },
    });

    await expect(
      fetchBoundedText(
        fetcher as any,
        'https://guide.example/epg.xml',
        1000,
        10,
      ),
    ).rejects.toThrow('Guide feed is too large');
    expect(cancel).toHaveBeenCalled();
  });

  test('rejects an empty body', async () => {
    const fetcher = async () => response('   ');

    await expect(
      fetchBoundedText(fetcher as any, 'https://guide.example/epg.xml'),
    ).rejects.toThrow('Guide feed is empty');
  });

  test('times out a stalled request', async () => {
    const fetcher = () => new Promise<never>(() => undefined);

    await expect(
      fetchBoundedText(
        fetcher as any,
        'https://guide.example/epg.xml',
        1,
        1024,
      ),
    ).rejects.toThrow('Guide request timed out');
  });

  test('keeps timeout active while response body is being read', async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () => new Promise<string>(() => undefined),
    });

    const outcome = await Promise.race([
      fetchBoundedText(
        fetcher as any,
        'https://guide.example/epg.xml',
        2,
        1024,
      ).then(
        () => 'resolved',
        (cause) => cause instanceof Error ? cause.message : 'rejected',
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('still pending'), 30);
      }),
    ]);

    expect(outcome).toBe('Guide request timed out');
  });
});


test('rejects invalid guide limits and insecure URLs before fetching', async () => {
  const fetcher = jest.fn();
  await expect(fetchBoundedText(fetcher as any, 'https://guide.example/feed.xml', 0, 10)).rejects.toThrow('Invalid guide loading limits');
  await expect(fetchBoundedText(fetcher as any, 'http://guide.example/feed.xml')).rejects.toThrow('HTTPS');
  expect(fetcher).not.toHaveBeenCalled();
});

test('rejects malformed guide content length declarations', async () => {
  for (const length of ['-1', '1e3', '12.5', 'not-a-number']) {
    const fetcher = jest.fn(async () => response('<tv/>', { length }));
    await expect(
      fetchBoundedText(
        fetcher as any,
        'https://guide.example/feed.xml',
        1000,
        1024,
      ),
    ).rejects.toThrow('invalid content length');
  }
});

test('rejects HTML guide responses', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true, status: 200, statusText: 'OK', url: 'https://guide.example/feed.xml',
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html' : null },
    text: async () => '<html>Error</html>',
  }));
  await expect(fetchBoundedText(fetcher as any, 'https://guide.example/feed.xml')).rejects.toThrow('HTML');
});


test('rejects oversized guide request and redirect URLs', async () => {
  const fetcher = jest.fn(async () => response('<tv/>'));

  await expect(fetchBoundedText(
    fetcher as any,
    `https://guide.example/feed.xml?token=${'x'.repeat(5_000)}`,
  )).rejects.toThrow('Guide URL');

  expect(fetcher).not.toHaveBeenCalled();

  const redirected = jest.fn(async () => ({
    ...response('<tv/>'),
    url: `https://guide.example/feed.xml?token=${'x'.repeat(5_000)}`,
  }));

  await expect(fetchBoundedText(
    redirected as any,
    'https://guide.example/feed.xml',
  )).rejects.toThrow('redirect');
});
