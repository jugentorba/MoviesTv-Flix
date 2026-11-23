import { stableTextCompare, type StreamSource } from '@moviestv/core';

type NativeVideoContentType = 'hls' | 'dash';

export interface NativeVideoSource {
  uri: string;
  headers?: Record<string, string>;
  contentType?: NativeVideoContentType;
}

function transportHint(source: StreamSource): 'hls' | 'dash' | undefined {
  const contentType = source.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const filename = source.filename?.trim().toLowerCase() ?? '';

  if (
    contentType === 'application/vnd.apple.mpegurl'
    || contentType === 'application/x-mpegurl'
    || contentType === 'application/mpegurl'
    || contentType === 'audio/mpegurl'
    || contentType === 'audio/x-mpegurl'
    || /\.m3u8(?:$|[?#])/i.test(source.url)
    || /\.m3u8$/i.test(filename)
  ) {
    return 'hls';
  }

  if (
    contentType === 'application/dash+xml'
    || /\.mpd(?:$|[?#])/i.test(source.url)
    || /\.mpd$/i.test(filename)
  ) {
    return 'dash';
  }

  try {
    const url = new URL(source.url);
    if (/(?:^|\/)hls(?:\/|$)/i.test(url.pathname)) return 'hls';

    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|content|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) {
        continue;
      }
      if (/m3u8|mpegurl|\bhls\b/i.test(value)) return 'hls';
      if (/\b(?:mpd|dash|application\/dash\+xml)\b/i.test(value)) {
        return 'dash';
      }
    }
  } catch {
    // Stream URLs are sanitized earlier; keep Expo's auto detection as fallback.
  }

  return undefined;
}

export function toNativeVideoSource(
  source: StreamSource,
  platform: string,
): NativeVideoSource {
  const hint = transportHint(source);
  const contentType = hint === 'hls'
    ? 'hls'
    : hint === 'dash' && platform === 'android'
      ? 'dash'
      : undefined;

  return {
    uri: source.url,
    ...(source.headers ? { headers: source.headers } : {}),
    ...(contentType ? { contentType } : {}),
  };
}


export function nativeVideoSourceSignature(
  source: StreamSource,
  platform: string,
): string {
  const nativeSource = toNativeVideoSource(source, platform);
  const headers = Object.entries(nativeSource.headers ?? {})
    .map(([name, value]) => [
      name.trim().toLowerCase(),
      value.trim(),
    ] as const)
    .filter(([name, value]) => Boolean(name && value))
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      stableTextCompare(leftName, rightName)
      || stableTextCompare(leftValue, rightValue)
    ))
    .map(([name, value]) => `${name}:${value}`);

  return [
    source.id.trim(),
    nativeSource.uri.trim(),
    nativeSource.contentType ?? '',
    ...headers,
  ].join('\u0000');
}
