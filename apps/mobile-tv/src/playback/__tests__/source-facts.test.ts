import type { StreamSource } from '@moviestv/core';
import {
  audioCodecOf,
  describeSourceFacts,
  sourceFacts,
} from '../sourceFacts';

function source(overrides: Partial<StreamSource>): StreamSource {
  return { id: 's', url: 'https://cdn.example/a', ...overrides };
}

describe('sourceFacts', () => {
  it('reports the container from the file name, not from the label', () => {
    expect(sourceFacts(source({ filename: 'L.Odyssee.1976.1080p.mkv' })).container).toBe('MKV');
    expect(sourceFacts(source({ url: 'https://cdn.example/movie.mp4' })).container).toBe('MP4');
    expect(sourceFacts(source({ url: 'https://cdn.example/live/index.m3u8' })).container).toBe('HLS');
  });

  it('trusts a declared content type over a misleading extension', () => {
    // The public sample that is named .mkv and served as video/x-matroska is
    // actually an MP4; a declared content type must win over the name.
    const facts = sourceFacts(source({
      filename: 'Big_Buck_Bunny_1080_10s_1MB.mkv',
      contentType: 'video/mp4',
    }));
    expect(facts.container).toBe('MP4');
  });

  it('flags only containers no target engine can demux', () => {
    expect(sourceFacts(source({ filename: 'a.mkv' })).containerIsBlocking).toBe(true);
    expect(sourceFacts(source({ filename: 'a.avi' })).containerIsBlocking).toBe(true);
    expect(sourceFacts(source({ filename: 'a.mp4' })).containerIsBlocking).toBe(false);
    expect(sourceFacts(source({ url: 'https://cdn.example/x.m3u8' })).containerIsBlocking).toBe(false);
  });

  it('reads the audio codec from a filename, a name or a content type', () => {
    expect(audioCodecOf(source({ filename: 'movie.1080p.EAC3.mkv' }))).toBe('eac3');
    expect(audioCodecOf(source({ name: '1080p · DTS-HD MA' }))).toBe('dts');
    expect(audioCodecOf(source({ filename: 'movie.ddp5.1.mkv' }))).toBe('eac3');
    expect(audioCodecOf(source({ filename: 'movie.AC3.mkv' }))).toBe('ac3');
    expect(audioCodecOf(source({ contentType: 'video/mp4; codecs="avc1.640028,ec-3"' }))).toBe('eac3');
    expect(audioCodecOf(source({ audioCodec: 'truehd' }))).toBe('truehd');
  });

  it('does not invent an audio codec when nothing declares one', () => {
    // The provider label says H.264 and nothing else: that says nothing about
    // audio, which is exactly the trap this module exists to avoid.
    expect(audioCodecOf(source({ filename: 'movie.1080p.mkv' }))).toBeNull();
    expect(describeSourceFacts(source({ filename: 'movie.1080p.mkv' }))).toBe('MKV');
  });

  it('describes both facts for the UI and errors', () => {
    expect(describeSourceFacts(source({ filename: 'movie.EAC3.mkv' }))).toBe('MKV · E-AC-3');
  });
});
