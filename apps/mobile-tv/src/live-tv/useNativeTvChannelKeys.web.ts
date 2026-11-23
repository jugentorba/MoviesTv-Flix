export function useNativeTvChannelKeys(_options: {
  enabled: boolean;
  onNext(): void;
  onPrevious(): void;
}): void {
  // Web TV remotes are handled through DOM key events.
}
