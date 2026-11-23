import { Platform, useTVEventHandler } from 'react-native';

interface NativeTvRemoteEvent {
  eventType?: string;
  eventKeyAction?: number;
}

export type NativeTvChannelAction = 'previous' | 'next';

export function nativeTvChannelAction(
  event: NativeTvRemoteEvent,
): NativeTvChannelAction | null {
  // Android TV normally dispatches the ordinary remote event on ACTION_UP.
  // Ignore ACTION_DOWN when a custom build enables key-down events so one
  // physical channel-button press can never zap twice.
  if (
    typeof event.eventKeyAction === 'number'
    && event.eventKeyAction !== 1
  ) return null;

  if (event.eventType === 'channelUp') return 'next';
  if (event.eventType === 'channelDown') return 'previous';
  return null;
}

export function useNativeTvChannelKeys({
  enabled,
  onNext,
  onPrevious,
}: {
  enabled: boolean;
  onNext(): void;
  onPrevious(): void;
}): void {
  useTVEventHandler((event) => {
    if (!enabled || !Platform.isTV) return;

    const action = nativeTvChannelAction(event);
    if (action === 'next') {
      onNext();
    } else if (action === 'previous') {
      onPrevious();
    }
  });
}
