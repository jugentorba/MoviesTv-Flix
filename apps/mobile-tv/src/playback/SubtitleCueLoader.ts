export interface SubtitleCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export type SubtitleTextFetcher = (
  url: string,
  init: { method: 'GET'; redirect: 'follow'; signal?: unknown },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel?(reason?: unknown): Promise<unknown> | unknown;
    };
  } | null;
  text(): Promise<string>;
  url?: string;
}>;

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2_097_152;
const MAX_SUBTITLE_SOURCE_CHARS = 2_097_152;
const MAX_SUBTITLE_CUES = 10_000;
const MAX_SUBTITLE_CUE_TEXT_LENGTH = 8_000;

function defaultFetcher(
  url: string,
  init: { method: 'GET'; redirect: 'follow'; signal?: unknown },
) {
  const runtime = globalThis as { fetch?: SubtitleTextFetcher };
  if (!runtime.fetch) return Promise.reject(new Error('Fetch is unavailable on this device'));
  return runtime.fetch(url, init);
}

async function readBoundedSubtitleText(
  response: Awaited<ReturnType<SubtitleTextFetcher>>,
  maxBytes: number,
  timeout: Promise<never>,
): Promise<string> {
  const TextDecoderImpl = (globalThis as typeof globalThis & {
    TextDecoder?: typeof TextDecoder;
  }).TextDecoder;
  const reader = response.body?.getReader?.();

  if (reader && TextDecoderImpl) {
    const decoder = new TextDecoderImpl('utf-8', { fatal: false });
    let totalBytes = 0;
    let text = '';

    try {
      while (true) {
        const result = await Promise.race([reader.read(), timeout]);
        if (result.done) break;
        const chunk = result.value;
        if (!chunk) continue;

        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel?.();
          } catch {
            // Best-effort cancellation after enforcing the hard body limit.
          }
          throw new Error('Subtitle response is too large');
        }
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch (error) {
      try {
        await reader.cancel?.(error);
      } catch {
        // Preserve the original timeout/size/network failure.
      }
      throw error;
    }
  }

  const body = await Promise.race([response.text(), timeout]);
  if (utf8ByteLength(body) > maxBytes) {
    throw new Error('Subtitle response is too large');
  }
  return body;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function safeSubtitleUrl(value: string): string {
  const normalized = typeof value === 'string'
    ? value.trim()
    : '';
  if (
    !normalized
    || normalized.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error('Subtitle URL is invalid');
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Subtitle URL is invalid');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.href.length > 8_192
  ) {
    throw new Error(
      url.protocol === 'https:' && !url.username && !url.password
        ? 'Subtitle URL is invalid'
        : 'Subtitle URL must use HTTPS',
    );
  }
  return url.href;
}

function parseTimestamp(value: string): number | null {
  const cleaned = value.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (
    !Number.isFinite(seconds)
    || !Number.isFinite(minutes)
    || !Number.isFinite(hours)
    || seconds < 0
    || seconds >= 60
    || minutes < 0
    || minutes >= 60
    || hours < 0
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function splitAssFields(
  value: string,
  fieldCount: number,
): string[] | null {
  if (!Number.isInteger(fieldCount) || fieldCount <= 0) return null;
  const fields: string[] = [];
  let start = 0;

  for (
    let index = 0;
    index < value.length && fields.length < fieldCount - 1;
    index += 1
  ) {
    if (value[index] !== ',') continue;
    fields.push(value.slice(start, index).trim());
    start = index + 1;
  }

  fields.push(value.slice(start).trim());
  return fields.length === fieldCount ? fields : null;
}

function cleanAssText(value: string): string {
  return value
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

function parseAssSubtitleCues(source: string): SubtitleCue[] {
  const lines = source.split('\n');
  let inEvents = false;
  let format: string[] | null = null;
  const cues: SubtitleCue[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (/^\[[^\]]+\]$/.test(trimmed)) {
      inEvents = /^\[events\]$/i.test(trimmed);
      if (!inEvents) format = null;
      continue;
    }
    if (!inEvents || !trimmed) continue;

    const formatMatch = trimmed.match(/^format\s*:\s*(.+)$/i);
    if (formatMatch) {
      const names = formatMatch[1]
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
      const required = ['start', 'end', 'text'];
      format = names.length
        && required.every((name) => names.includes(name))
        ? names
        : null;
      continue;
    }

    const dialogueMatch = line.match(/^\s*dialogue\s*:\s*(.*)$/i);
    if (!dialogueMatch || !format) continue;

    const fields = splitAssFields(dialogueMatch[1], format.length);
    if (!fields) continue;

    const startIndex = format.indexOf('start');
    const endIndex = format.indexOf('end');
    const textIndex = format.indexOf('text');
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue;

    const start = parseTimestamp(fields[startIndex] ?? '');
    const end = parseTimestamp(fields[endIndex] ?? '');
    if (start === null || end === null || end <= start) continue;

    const text = cleanText([cleanAssText(fields[textIndex] ?? '')]);
    if (!text || text.length > MAX_SUBTITLE_CUE_TEXT_LENGTH) continue;
    cues.push({ startSeconds: start, endSeconds: end, text });
    if (cues.length >= MAX_SUBTITLE_CUES) break;
  }

  return cues;
}

function cleanText(lines: readonly string[]): string {
  return lines
    .join('\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

export function parseSubtitleCues(source: string): SubtitleCue[] {
  if (source.length > MAX_SUBTITLE_SOURCE_CHARS) return [];
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const assCues = parseAssSubtitleCues(normalized);
  if (assCues.length) {
    return assCues
      .sort((left, right) => left.startSeconds - right.startSeconds)
      .filter((cue, index, all) => index === 0 || !(
        cue.startSeconds === all[index - 1]?.startSeconds
        && cue.endSeconds === all[index - 1]?.endSeconds
        && cue.text === all[index - 1]?.text
      ));
  }

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0].trim())) continue;
    if (lines.length > 500) continue;

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;

    const timing = lines[timingIndex].split('-->');
    if (timing.length !== 2) continue;
    const start = parseTimestamp(timing[0]);
    const endToken = timing[1].trim().split(/\s+/)[0] ?? '';
    const end = parseTimestamp(endToken);
    if (start === null || end === null || end <= start) continue;

    const text = cleanText(lines.slice(timingIndex + 1));
    if (!text || text.length > MAX_SUBTITLE_CUE_TEXT_LENGTH) continue;
    cues.push({ startSeconds: start, endSeconds: end, text });
    if (cues.length >= MAX_SUBTITLE_CUES) break;
  }

  return cues
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .filter((cue, index, all) => index === 0 || !(
      cue.startSeconds === all[index - 1]?.startSeconds
      && cue.endSeconds === all[index - 1]?.endSeconds
      && cue.text === all[index - 1]?.text
    ));
}

export async function loadSubtitleCues(
  rawUrl: string,
  fetcher: SubtitleTextFetcher = defaultFetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<SubtitleCue[]> {
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || !Number.isFinite(maxBytes)
    || maxBytes <= 0
  ) {
    throw new Error('Invalid subtitle loading limits');
  }
  const url = safeSubtitleUrl(rawUrl);
  const AbortControllerImpl = (globalThis as {
    AbortController?: new () => { signal: unknown; abort(): void };
  }).AbortController;
  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('Subtitle request timed out'));
    }, timeoutMs);
  });

  try {
    const request = fetcher(url, {
      method: 'GET',
      redirect: 'follow',
      ...(controller ? { signal: controller.signal } : {}),
    });
    const response = await Promise.race([request, timeout]);

    const responseUrl = response.url;
    if (responseUrl) safeSubtitleUrl(responseUrl);

    if (!response.ok) {
      throw new Error(
        `Subtitle request failed with ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength) {
      const normalizedLength = declaredLength.trim();
      if (!/^\d+$/.test(normalizedLength)) {
        throw new Error('Subtitle response has invalid content length');
      }
      const parsed = Number(normalizedLength);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error('Subtitle response has invalid content length');
      }
      if (parsed > maxBytes) {
        throw new Error('Subtitle response is too large');
      }
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) {
      throw new Error('Subtitle response returned HTML instead of subtitle text');
    }

    const body = await readBoundedSubtitleText(
      response,
      maxBytes,
      timeout,
    );
    if (!body.trim()) throw new Error('Subtitle response is empty');

    const cues = parseSubtitleCues(body);
    if (!cues.length) throw new Error('Subtitle file contains no readable cues');
    return cues;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
