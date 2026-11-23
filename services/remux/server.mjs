#!/usr/bin/env node
/**
 * On-demand MKV remux service for the web player.
 *
 * The browser player cannot demux Matroska in WebKit at all, and Chromium
 * cannot decode AC-3/E-AC-3 audio. This service turns an unplayable source into
 * HLS without re-encoding the video: `-c:v copy` keeps the original H.264
 * bitstream, so quality and startup cost stay close to direct playback. Audio is
 * copied when the target engine supports it and transcoded to AAC only when it
 * must be.
 *
 * Signed provider URLs and provider headers never appear in a URL, in a log line
 * or in an error message. A caller creates a session with a POST body, receives
 * an opaque id, and every later request only carries that id.
 *
 * Run:  node services/remux/server.mjs
 * Env:  PORT (default 8790), REMUX_ALLOWED_ORIGINS, FFMPEG_PATH, FFPROBE_PATH,
 *       SESSION_TTL_MS (default 15 min), MAX_SESSIONS (default 4)
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8790);
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 15 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 4);
const MAX_URL_LENGTH = 8192;
const MAX_HEADER_BYTES = 4096;

/** headers we are willing to forward upstream */
const FORWARDED_HEADERS = new Set([
  'user-agent', 'referer', 'origin', 'cookie', 'authorization', 'accept',
  'accept-language', 'x-api-key', 'x-auth-token',
]);

/** audio codecs that the browser engines we target can decode natively */
const COPYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

const sessions = new Map();

function fail(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/** Validate a provider URL without ever echoing it back. */
function validMediaUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

function sanitizeHeaders(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  let bytes = 0;
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') continue;
    const key = name.trim().toLowerCase();
    if (!FORWARDED_HEADERS.has(key)) continue;
    const header = raw.replace(/[\r\n]/g, ' ').trim();
    if (!header) continue;
    bytes += key.length + header.length;
    if (bytes > MAX_HEADER_BYTES) break;
    out[key] = header;
  }
  return out;
}

function ffmpegInputHeaders(headers) {
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  if (!lines.length) return [];
  return ['-headers', `${lines.join('\r\n')}\r\n`];
}

function probe(url, headers) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      ...ffmpegInputHeaders(headers),
      url,
    ];
    const child = spawn(FFPROBE, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      const codec = out.trim().split('\n')[0]?.trim().toLowerCase();
      resolve(codec || 'none');
    });
  });
}

function startSession(url, headers, audioCodec) {
  const id = randomUUID();
  const dir = join(tmpdir(), `mtflix-remux-${id}`);
  mkdirSync(dir, { recursive: true });
  const playlist = join(dir, 'index.m3u8');
  const copyAudio = COPYABLE_AUDIO.has(audioCodec);

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-user_agent', headers['user-agent'] ?? 'MoviesTvFlix/1.0',
    ...(headers.referer ? ['-referer', headers.referer] : []),
    ...ffmpegInputHeaders(headers),
    '-i', url,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    // Copy the video bitstream: no re-encode, no quality loss, fast start.
    '-c:v', 'copy',
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']),
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(dir, 'seg-%05d.ts'),
    playlist,
  ];

  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  const session = {
    id, dir, playlist, child, createdAt: Date.now(), lastUsed: Date.now(),
    audio: copyAudio ? 'copy' : 'transcode-aac', ready: false,
  };
  child.on('close', () => { session.finished = true; });
  child.on('error', () => { session.failed = true; });
  sessions.set(id, session);

  // Keep at most MAX_SESSIONS; evict the least recently used.
  if (sessions.size > MAX_SESSIONS) {
    const [oldest] = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    if (oldest) destroySession(oldest.id);
  }
  return session;
}

function destroySession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  try { session.child.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(session.dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

setInterval(() => {
  const now = Date.now();
  for (const session of [...sessions.values()]) {
    if (now - session.lastUsed > SESSION_TTL_MS) destroySession(session.id);
  }
}, 60_000).unref();

function waitForPlaylist(session, timeoutMs = 25_000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (session.failed) return resolve(false);
      try {
        if (statSync(session.playlist).size > 0) {
          // Wait until at least two segments are listed so playback can start.
          const text = readFileSync(session.playlist, 'utf8');
          if ((text.match(/\.ts/g) || []).length >= 2) return resolve(true);
        }
      } catch { /* not written yet */ }
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function cors(req, res) {
  const allowed = (process.env.REMUX_ALLOWED_ORIGINS ?? '*').trim();
  const origin = req.headers.origin;
  const value = allowed === '*'
    ? '*'
    : (origin && allowed.split(',').map((o) => o.trim()).includes(origin) ? origin : 'null');
  res.setHeader('access-control-allow-origin', value);
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('vary', 'origin');
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size, ffmpeg: FFMPEG }));
    return;
  }

  if (path === '/sessions' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return fail(res, 400, 'invalid json body');
    const mediaUrl = validMediaUrl(body.url);
    if (!mediaUrl) return fail(res, 400, 'invalid media url');
    const headers = sanitizeHeaders(body.headers);
    const audioCodec = await probe(mediaUrl, headers);
    if (audioCodec === null) return fail(res, 502, 'source is not reachable');
    const session = startSession(mediaUrl, headers, audioCodec);
    const ready = await waitForPlaylist(session);
    if (!ready) {
      destroySession(session.id);
      return fail(res, 502, 'remux did not start; the source may be unsupported or unreachable');
    }
    session.ready = true;
    session.lastUsed = Date.now();
    res.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      id: session.id,
      playlist: `/sessions/${session.id}/index.m3u8`,
      audio: session.audio,
    }));
    return;
  }

  const match = /^\/sessions\/([0-9a-f-]{36})\/(.+)$/.exec(path);
  if (match && req.method === 'GET') {
    const session = sessions.get(match[1]);
    if (!session) return fail(res, 404, 'session not found');
    session.lastUsed = Date.now();
    const name = match[2];
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return fail(res, 400, 'invalid file');
    const file = join(session.dir, name);
    if (!existsSync(file)) return fail(res, 404, 'not found');
    const type = extname(name) === '.m3u8'
      ? 'application/vnd.apple.mpegurl'
      : 'video/mp2t';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-length': statSync(file).size,
    });
    createReadStream(file).pipe(res);
    return;
  }

  if (match && req.method === 'DELETE') {
    destroySession(match[1]);
    res.writeHead(204).end();
    return;
  }

  fail(res, 404, 'not found');
});

server.listen(PORT, () => {
  console.log(`remux service listening on http://localhost:${PORT}`);
  console.log('POST /sessions {url, headers} -> {id, playlist, audio}');
  console.log('signed source URLs are never logged; only session ids and audio decisions are');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const id of [...sessions.keys()]) destroySession(id);
    server.close(() => process.exit(0));
  });
}
