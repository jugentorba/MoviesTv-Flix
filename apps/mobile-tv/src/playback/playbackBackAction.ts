export type PlaybackBackAction =
  | 'audio'
  | 'subtitles'
  | 'sources'
  | 'playback';

export function playbackBackAction({
  audioChooserOpen,
  subtitleChooserOpen,
  sourceChooserOpen,
  playbackOpen,
}: {
  audioChooserOpen: boolean;
  subtitleChooserOpen: boolean;
  sourceChooserOpen: boolean;
  playbackOpen: boolean;
}): PlaybackBackAction | null {
  if (audioChooserOpen) return 'audio';
  if (subtitleChooserOpen) return 'subtitles';
  if (sourceChooserOpen) return 'sources';
  return playbackOpen ? 'playback' : null;
}
