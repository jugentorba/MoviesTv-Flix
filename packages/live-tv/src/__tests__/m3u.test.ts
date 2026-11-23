import {
  MAX_M3U_CHANNELS,
  MAX_M3U_TEXT_LENGTH,
  parseM3uPlaylist,
} from '../m3u';

const HEADER = '#EXTM3U';

function playlist(lines: string[]): string {
  return [HEADER, ...lines].join('\n');
}

describe('M3U playlist parsing', () => {
  test('reads channels with their EPG metadata', () => {
    const text = playlist([
      '#EXTINF:-1 tvg-id="news.fr" tvg-logo="https://img.example/news.png" group-title="News" tvg-country="FR" tvg-language="French",France Info',
      'https://stream.example/news.m3u8',
      '#EXTINF:-1 tvg-id="sport.fr" group-title="Sport",Sport 1',
      'https://stream.example/sport.m3u8',
    ]);

    const { playlist: parsed } = parseM3uPlaylist(text);

    expect(parsed?.kind).toBe('playlist');
    expect(parsed?.channels).toHaveLength(2);
    expect(parsed?.channels[0]).toEqual({
      id: 'm3u:news.fr',
      name: 'France Info',
      streamUrl: 'https://stream.example/news.m3u8',
      logoUrl: 'https://img.example/news.png',
      group: 'News',
      countryCode: 'FR',
      language: 'french',
      epgId: 'news.fr',
    });
  });

  test('keeps a comma inside a quoted attribute', () => {
    const text = playlist([
      '#EXTINF:-1 group-title="News, Weather",Channel 5',
      'https://stream.example/five.m3u8',
    ]);

    const [channel] = parseM3uPlaylist(text).playlist!.channels;

    expect(channel.group).toBe('News, Weather');
    expect(channel.name).toBe('Channel 5');
  });

  test('falls back to tvg-name when the display name is empty', () => {
    const text = playlist([
      '#EXTINF:-1 tvg-name="Backup Name" tvg-id="x",',
      'https://stream.example/x.m3u8',
    ]);

    expect(parseM3uPlaylist(text).playlist!.channels[0].name).toBe('Backup Name');
  });

  test('uses #EXTGRP as the group when group-title is absent', () => {
    const text = playlist([
      '#EXTGRP:Movies',
      '#EXTINF:-1,Movie Channel',
      'https://stream.example/movies.m3u8',
    ]);

    const [channel] = parseM3uPlaylist(text).playlist!.channels;

    expect(channel.group).toBe('Movies');
  });

  test('derives a stable id from the URL when no EPG id is present', () => {
    const text = playlist([
      '#EXTINF:-1,No EPG',
      'https://stream.example/no-epg.m3u8',
    ]);

    const first = parseM3uPlaylist(text).playlist!.channels[0].id;
    const second = parseM3uPlaylist(text).playlist!.channels[0].id;

    expect(first).toBe(second);
    expect(first.startsWith('m3u:')).toBe(true);
  });

  test('drops non-http streams and counts them as skipped', () => {
    const text = playlist([
      '#EXTINF:-1,Local file',
      'file:///etc/passwd',
      '#EXTINF:-1,Public host',
      'https://stream.example/ok.m3u8',
    ]);

    const parsed = parseM3uPlaylist(text).playlist!;

    expect(parsed.channels.map((channel) => channel.name)).toEqual(['Public host']);
    expect(parsed.skipped).toBe(1);
  });

  test('drops a stream whose URL carries credentials', () => {
    const text = playlist([
      '#EXTINF:-1,With credentials',
      'https://user:secret@stream.example/private.m3u8',
    ]);

    const parsed = parseM3uPlaylist(text).playlist!;

    expect(parsed.channels).toHaveLength(0);
    expect(parsed.skipped).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });

  test('keeps credentials that appear in the path, as IPTV providers use them', () => {
    const text = playlist([
      '#EXTINF:-1,Path credentials',
      'http://host.example:8080/live/user/pass/12.ts',
    ]);

    const [channel] = parseM3uPlaylist(text).playlist!.channels;

    expect(channel.streamUrl).toBe('http://host.example:8080/live/user/pass/12.ts');
  });

  test('removes duplicate stream URLs', () => {
    const text = playlist([
      '#EXTINF:-1,One',
      'https://stream.example/dup.m3u8',
      '#EXTINF:-1,Two',
      'https://stream.example/dup.m3u8',
    ]);

    const parsed = parseM3uPlaylist(text).playlist!;

    expect(parsed.channels).toHaveLength(1);
    expect(parsed.channels[0].name).toBe('One');
    expect(parsed.skipped).toBe(1);
  });

  test('strips control characters and caps long names', () => {
    const longName = 'A'.repeat(900);
    const text = playlist([
      `#EXTINF:-1,Bad\u0000Name`,
      'https://stream.example/one.m3u8',
      `#EXTINF:-1,${longName}`,
      'https://stream.example/two.m3u8',
    ]);

    const channels = parseM3uPlaylist(text).playlist!.channels;

    expect(channels[0].name).toBe('Bad Name');
    expect(channels[1].name).toHaveLength(512);
  });

  test('ignores an entry that never gets a URL', () => {
    const text = playlist([
      '#EXTINF:-1,Orphan',
      '#EXTINF:-1,Complete',
      'https://stream.example/complete.m3u8',
    ]);

    const parsed = parseM3uPlaylist(text).playlist!;

    expect(parsed.channels.map((channel) => channel.name)).toEqual(['Complete']);
    expect(parsed.skipped).toBe(1);
  });

  test('detects an HLS manifest instead of treating it as channels', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.0,',
      'segment1.ts',
    ].join('\n');

    const parsed = parseM3uPlaylist(text).playlist!;

    expect(parsed.kind).toBe('hls-manifest');
    expect(parsed.channels).toHaveLength(0);
  });

  test('tolerates a BOM and CRLF line endings', () => {
    const text = `\uFEFF#EXTM3U\r\n#EXTINF:-1,Windows\r\nhttps://stream.example/w.m3u8\r\n`;

    const parsed = parseM3uPlaylist(text).playlist!;

    expect(parsed.channels[0].name).toBe('Windows');
  });

  test('rejects input that is not a playlist', () => {
    expect(parseM3uPlaylist('').error).toBe('empty');
    expect(parseM3uPlaylist('   ').error).toBe('empty');
    expect(parseM3uPlaylist('https://stream.example/one.m3u8').error).toBe('missing-header');
    expect(parseM3uPlaylist('x'.repeat(MAX_M3U_TEXT_LENGTH + 1)).error).toBe('too-large');
  });

  test('stops at the channel cap and reports the remainder as skipped', () => {
    const entries: string[] = [];
    for (let index = 0; index < MAX_M3U_CHANNELS + 5; index += 1) {
      entries.push(`#EXTINF:-1,Channel ${index}`);
      entries.push(`https://stream.example/${index}.m3u8`);
    }

    const parsed = parseM3uPlaylist(playlist(entries)).playlist!;

    expect(parsed.channels).toHaveLength(MAX_M3U_CHANNELS);
    expect(parsed.skipped).toBe(5);
    expect(parsed.truncated).toBe(true);
  });

  test('does not flag a playlist that fits the cap as truncated', () => {
    const parsed = parseM3uPlaylist(playlist([
      '#EXTINF:-1,Only',
      'https://stream.example/only.m3u8',
    ])).playlist!;

    expect(parsed.truncated).toBe(false);
  });
});
