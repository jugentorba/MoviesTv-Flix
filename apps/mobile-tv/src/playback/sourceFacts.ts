import type { StreamSource } from '@moviestv/core';
import { webContainerKind, type WebContainerKind } from './webContainerSupport';

/**
 * What a source actually is, as far as its metadata can tell us.
 *
 * The provider label ("1080p · H264") describes the video only. A browser
 * decision also needs the container and the audio codec: WebKit cannot demux
 * Matroska at all, and Chromium cannot decode AC-3/E-AC-3 even inside MP4.
 * These facts are shown next to each source and quoted in playback errors so a
 * failure names the real reason instead of the resolution.
 */
export interface SourceFacts {
  container: string | null;
  audio: string | null;
  /** True when the container has no demuxer in any engine we target. */
  containerIsBlocking: boolean;
}

const CONTAINER_LABELS: Partial<Record<Exclude<WebContainerKind, null>, string>> = {
  hls: 'HLS',
  mp4: 'MP4',
  m4v: 'M4V',
  mov: 'MOV',
  webm: 'WebM',
  matroska: 'MKV',
  dash: 'DASH',
  avi: 'AVI',
  flv: 'FLV',
  wmv: 'WMV',
};

const CODEC_LABELS: Record<string, string> = {
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'TrueHD',
  opus: 'Opus',
  flac: 'FLAC',
  mp3: 'MP3',
  mp2: 'MP2',
  pcm: 'PCM',
  vorbis: 'Vorbis',
};

/** Read the first declared audio codec out of a `codecs="...,..."` content type. */
function audioFromContentType(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const quoted = /codecs="?([^";]+)"?/i.exec(contentType);
  if (!quoted) return null;
  const tokens = quoted[1].split(',').map((token) => token.trim().toLowerCase());
  for (const token of tokens) {
    if (/^(?:mp4a\.40|mp4a$)/.test(token)) return 'aac';
    if (/^(?:ec-?3|eac3)/.test(token)) return 'eac3';
    if (/^(?:ac-?3|ac3)/.test(token)) return 'ac3';
    if (/^(?:dts|dtsc|dtsh|dtse|dtsl|dtsx)/.test(token)) return 'dts';
    if (/^(?:mlpa|truehd)/.test(token)) return 'truehd';
    if (/^opus/.test(token)) return 'opus';
    if (/^flac/.test(token)) return 'flac';
    if (/^mp3|^\.mp3/.test(token)) return 'mp3';
  }
  return null;
}

/**
 * Audio codec from explicit metadata first, then from the file name or the
 * provider description. Deliberately returns null when nothing declares it: a
 * missing hint must not be presented as a guess.
 */
export function audioCodecOf(source: StreamSource): string | null {
  if (source.audioCodec === 'truehd') return 'truehd';
  if (source.audioCodec === 'dts') return 'dts';

  const declared = audioFromContentType(source.contentType);
  if (declared) return declared;

  const label = `${source.filename ?? ''} ${source.name ?? ''}`.toLowerCase();
  if (!label.trim()) return null;
  if (/\btrue[ ._-]?hd\b/.test(label)) return 'truehd';
  if (/\b(?:e-?ac-?3|eac3|ddp\d?(?:\.\d)?|dd\+)/.test(label)) return 'eac3';
  if (/\b(?:ac-?3|ac3|dolby[ ._-]?digital)\b/.test(label)) return 'ac3';
  if (/\bdts(?:[ .:_-]?(?:hd|x|ma))?\b/.test(label)) return 'dts';
  if (/\bopus\b/.test(label)) return 'opus';
  if (/\bflac\b/.test(label)) return 'flac';
  if (/\bmp3\b/.test(label)) return 'mp3';
  if (/\baac\b/.test(label)) return 'aac';
  return null;
}

export function sourceFacts(source: StreamSource): SourceFacts {
  const kind = webContainerKind(source);
  const audioCodec = audioCodecOf(source);
  return {
    container: kind ? CONTAINER_LABELS[kind] ?? null : null,
    audio: audioCodec ? CODEC_LABELS[audioCodec] ?? audioCodec.toUpperCase() : null,
    containerIsBlocking: kind === 'matroska' || kind === 'avi' || kind === 'flv' || kind === 'wmv' || kind === 'dash',
  };
}

/** "MKV · E-AC-3" for a badge or an error message. */
export function describeSourceFacts(source: StreamSource): string {
  const facts = sourceFacts(source);
  return [facts.container, facts.audio].filter(Boolean).join(' · ');
}
