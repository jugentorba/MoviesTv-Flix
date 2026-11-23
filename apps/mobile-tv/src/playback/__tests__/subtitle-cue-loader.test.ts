import { loadSubtitleCues, parseSubtitleCues } from '../SubtitleCueLoader';

test('parses SRT timestamps and strips formatting markup', () => {
  const cues = parseSubtitleCues(`1
00:00:01,500 --> 00:00:03,000
<i>Hello</i> &amp; welcome

2
00:00:04,000 --> 00:00:05,500
Second line
`);

  expect(cues).toEqual([
    { startSeconds: 1.5, endSeconds: 3, text: 'Hello & welcome' },
    { startSeconds: 4, endSeconds: 5.5, text: 'Second line' },
  ]);
});

test('parses WebVTT cue settings without treating them as time', () => {
  const cues = parseSubtitleCues(`WEBVTT

00:01.000 --> 00:03.250 align:center position:50%
Hello
World
`);

  expect(cues).toEqual([
    { startSeconds: 1, endSeconds: 3.25, text: 'Hello\nWorld' },
  ]);
});

test('loads only HTTPS subtitle files and rejects oversized responses', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '50' },
    text: async () => '1\n00:00:01,000 --> 00:00:02,000\nHello',
  }));

  await expect(loadSubtitleCues('https://subs.example/file.srt', fetcher)).resolves.toHaveLength(1);
  await expect(loadSubtitleCues('http://subs.example/file.srt', fetcher)).rejects.toThrow('HTTPS');
});


test('rejects oversized streamed subtitles before buffering the whole body', async () => {
  const cancel = jest.fn(async () => undefined);
  const text = jest.fn(async () => {
    throw new Error('streaming path should not call response.text');
  });
  const chunks = [
    new Uint8Array(8).fill(65),
    new Uint8Array(8).fill(66),
  ];
  let index = 0;
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
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
    text,
  }));

  await expect(loadSubtitleCues(
    'https://subs.example/chunked.srt',
    fetcher,
    1000,
    10,
  )).rejects.toThrow('too large');

  expect(cancel).toHaveBeenCalled();
  expect(text).not.toHaveBeenCalled();
});


test('keeps timeout active while subtitle response body is being read', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => new Promise<string>(() => undefined),
  }));

  await expect(
    loadSubtitleCues(
      'https://subs.example/stalled.srt',
      fetcher,
      2,
      1024,
    ),
  ).rejects.toThrow('Subtitle request timed out');
});


test('follows redirects and accepts a final HTTPS subtitle URL', async () => {
  const fetcher = jest.fn(async (_url, _init) => ({
    ok: true,
    status: 200,
    url: 'https://cdn.example/subtitles/file.srt',
    headers: { get: () => '50' },
    text: async () => '1\n00:00:01,000 --> 00:00:02,000\nHello',
  }));

  await expect(loadSubtitleCues('https://subs.example/file.srt', fetcher)).resolves.toHaveLength(1);
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('follow');
});

test('rejects a redirected subtitle destination that is not HTTPS', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    url: 'http://cdn.example/file.srt',
    headers: { get: () => '50' },
    text: async () => '1\n00:00:01,000 --> 00:00:02,000\nHello',
  }));

  await expect(loadSubtitleCues('https://subs.example/file.srt', fetcher)).rejects.toThrow('HTTPS');
});

test('rejects HTML returned instead of subtitle text', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => name === 'content-type' ? 'text/html; charset=utf-8' : null },
    text: async () => '<html>provider error</html>',
  }));

  await expect(loadSubtitleCues('https://subs.example/file.srt', fetcher)).rejects.toThrow('HTML');
});

test('rejects invalid timestamp minute and second ranges', () => {
  expect(parseSubtitleCues('1\n00:61:00,000 --> 00:61:02,000\nBad')).toEqual([]);
  expect(parseSubtitleCues('1\n00:00:61,000 --> 00:00:62,000\nBad')).toEqual([]);
});

test('decodes common quote entities in subtitle text', () => {
  const cues = parseSubtitleCues('1\n00:00:01,000 --> 00:00:02,000\n&quot;Hello&quot; &apos;friend&apos;');
  expect(cues[0]?.text).toBe('"Hello" \'friend\'');
});


test('rejects an empty subtitle response', async () => {
  const fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '   \n ',
  }));
  await expect(loadSubtitleCues('https://subs.example/empty.srt', fetcher)).rejects.toThrow('empty');
});

test('deduplicates identical subtitle cues', () => {
  const cues = parseSubtitleCues('1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nHello');
  expect(cues).toHaveLength(1);
});


test('bounds parsed subtitle cue count', () => {
  const source = Array.from({ length: 10_050 }, (_, index) => (
    `${index + 1}\n00:00:01,000 --> 00:00:02,000\nCue ${index}`
  )).join('\n\n');

  const cues = parseSubtitleCues(source);

  expect(cues).toHaveLength(10_000);
  expect(cues.at(-1)?.text).toBe('Cue 9999');
});

test('rejects invalid subtitle loading limits before fetching', async () => {
  const fetcher = jest.fn();

  await expect(loadSubtitleCues(
    'https://subs.example/file.srt',
    fetcher as any,
    Number.NaN,
    1024,
  )).rejects.toThrow('Invalid subtitle loading limits');

  await expect(loadSubtitleCues(
    'https://subs.example/file.srt',
    fetcher as any,
    1000,
    Number.POSITIVE_INFINITY,
  )).rejects.toThrow('Invalid subtitle loading limits');

  expect(fetcher).not.toHaveBeenCalled();
});

test('rejects malformed subtitle content length declarations', async () => {
  for (const length of ['-1', '1e3', '12.5', 'not-a-number']) {
    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => name === 'content-length' ? length : null,
      },
      text: async () => (
        '1\n00:00:01,000 --> 00:00:02,000\nHello'
      ),
    }));

    await expect(loadSubtitleCues(
      'https://subs.example/file.srt',
      fetcher,
    )).rejects.toThrow('invalid content length');
  }
});

test('rejects oversized and control-character subtitle URLs before fetching', async () => {
  const fetcher = jest.fn();

  await expect(loadSubtitleCues(
    `https://subs.example/${'x'.repeat(8_200)}`,
    fetcher as any,
  )).rejects.toThrow('Subtitle URL is invalid');

  await expect(loadSubtitleCues(
    'https://subs.example/file.srt\u0000',
    fetcher as any,
  )).rejects.toThrow('Subtitle URL is invalid');

  expect(fetcher).not.toHaveBeenCalled();
});


test('drops oversized individual subtitle cues without discarding valid neighbours', () => {
  const source = `1
00:00:01,000 --> 00:00:02,000
${'x'.repeat(8_001)}

2
00:00:03,000 --> 00:00:04,000
Still readable
`;

  expect(parseSubtitleCues(source)).toEqual([
    {
      startSeconds: 3,
      endSeconds: 4,
      text: 'Still readable',
    },
  ]);
});

test('bounds direct subtitle parser input size', () => {
  const source = `1
00:00:01,000 --> 00:00:02,000
${'x'.repeat(2_097_200)}
`;

  expect(parseSubtitleCues(source)).toEqual([]);
});

test('rejects malformed or normalization-expanded subtitle URLs before fetch', async () => {
  const fetcher = jest.fn();

  await expect(loadSubtitleCues(
    'https://[',
    fetcher as any,
  )).rejects.toThrow('Subtitle URL is invalid');

  await expect(loadSubtitleCues(
    `https://subs.example/${'é'.repeat(2_000)}.srt`,
    fetcher as any,
  )).rejects.toThrow('Subtitle URL is invalid');

  expect(fetcher).not.toHaveBeenCalled();
});


test('parses ASS dialogue cues and strips override tags', () => {
  const cues = parseSubtitleCues(`[Script Info]
Title: Example

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nworld, again
Dialogue: 0,0:00:04.00,0:00:05.25,Default,,0,0,0,,{\\an8}Second line
`);

  expect(cues).toEqual([
    {
      startSeconds: 1.5,
      endSeconds: 3,
      text: 'Hello\nworld, again',
    },
    {
      startSeconds: 4,
      endSeconds: 5.25,
      text: 'Second line',
    },
  ]);
});

test('parses ASS events when the Format field order is customized', () => {
  const cues = parseSubtitleCues(`[Events]
Format: Text, End, Start, Style
Dialogue: Custom text,0:00:02.50,0:00:01.00,Default
`);

  expect(cues).toEqual([
    {
      startSeconds: 1,
      endSeconds: 2.5,
      text: 'Custom text',
    },
  ]);
});
