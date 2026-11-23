jest.setTimeout(15000);

// Keep timeout/stream tests browser-compatible without changing app runtime code.
// Cloudflare uses this same setup for zero-credit verification.
if (typeof globalThis.AbortController !== 'function') {
  class TestAbortController {
    constructor() {
      this.signal = { aborted: false };
    }
    abort() {
      this.signal.aborted = true;
    }
  }
  globalThis.AbortController = TestAbortController;
}

if (typeof globalThis.TextDecoder !== 'function') {
  globalThis.TextDecoder = require('node:util').TextDecoder;
}

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/*
 * @lunarr/vlc-player is a Fabric/TurboModule package, so its native module is
 * absent under Jest. The playback surfaces only need a host component stub.
 */
jest.mock('@lunarr/vlc-player', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const VLCPlayer = ReactModule.forwardRef((props, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      play() {},
      pause() {},
      seek() {},
      release() {},
      getTracks() {},
      selectAudioTrack() {},
      selectSubtitleTrack() {},
    }));
    return ReactModule.createElement(View, props);
  });
  return { __esModule: true, default: VLCPlayer };
});


jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const metrics = {
    frame: { x: 0, y: 0, width: 320, height: 640 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const SafeAreaInsetsContext = ReactModule.createContext(metrics.insets);
  const SafeAreaFrameContext = ReactModule.createContext(metrics.frame);

  const SafeAreaProvider = ({
    children,
    initialMetrics,
    initialSafeAreaInsets,
  }) => ReactModule.createElement(
    SafeAreaFrameContext.Provider,
    { value: initialMetrics?.frame ?? metrics.frame },
    ReactModule.createElement(
      SafeAreaInsetsContext.Provider,
      {
        value:
          initialMetrics?.insets
          ?? initialSafeAreaInsets
          ?? metrics.insets,
      },
      children,
    ),
  );

  const useSafeAreaInsets = () => (
    ReactModule.useContext(SafeAreaInsetsContext) ?? metrics.insets
  );
  const useSafeAreaFrame = () => (
    ReactModule.useContext(SafeAreaFrameContext) ?? metrics.frame
  );

  return {
    SafeAreaProvider,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    SafeAreaConsumer: SafeAreaInsetsContext.Consumer,
    SafeAreaContext: SafeAreaInsetsContext,
    SafeAreaView: View,
    initialWindowMetrics: metrics,
    initialWindowSafeAreaInsets: metrics.insets,
    useSafeAreaInsets,
    useSafeAreaFrame,
    useSafeArea: useSafeAreaInsets,
    withSafeAreaInsets: (Component) => ReactModule.forwardRef(
      (props, ref) => ReactModule.createElement(
        Component,
        { ...props, ref, insets: useSafeAreaInsets() },
      ),
    ),
  };
});

jest.mock('expo-video', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const VideoView = ReactModule.forwardRef((props, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({
      enterFullscreen: jest.fn(async () => undefined),
      exitFullscreen: jest.fn(async () => undefined),
    }));
    return ReactModule.createElement(View, props);
  });
  return {
    useVideoPlayer: (_source, setup) => {
      const player = {
        play: jest.fn(),
        pause: jest.fn(),
        replaceAsync: jest.fn(async () => undefined),
        seekBy: jest.fn(),
        playing: false,
        muted: false,
        currentTime: 0,
        duration: 100,
        timeUpdateEventInterval: 0,
        availableAudioTracks: [],
        availableSubtitleTracks: [],
        addListener: jest.fn(() => ({ remove: jest.fn() })),
      };
      if (setup) setup(player);
      return player;
    },
    VideoView,
  };
});

jest.mock('expo-file-system', () => {
  class Directory {
    constructor(...parts) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part?.uri ?? '').join('/');
      this.exists = true;
    }
    create() {}
    list() { return []; }
  }

  class File {
    constructor(...parts) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part?.uri ?? '').join('/');
      this.name = String(parts.at(-1) ?? 'file');
      this.size = 0;
      this.lastModified = 0;
      this.exists = true;
      this._text = '';
    }
    create() { this.exists = true; }
    write(value) {
      this._text = typeof value === 'string' ? value : '';
      this.size = this._text.length;
      this.exists = true;
    }
    textSync() { return this._text; }
    async text() { return this._text; }
    delete() { this.exists = false; }
    rename(newName) {
      this.uri = this.uri.replace(/[^/]+$/, String(newName));
      this.name = String(newName);
    }
    static createDownloadTask(_url, destination, options) {
      options?.onProgress?.({ bytesWritten: 100, totalBytes: 100 });
      return {
        downloadAsync: async () => {
          destination.exists = true;
          destination.size = destination.size || 100;
          return destination;
        },
      };
    }
  }

  return {
    Directory,
    File,
    Paths: { document: 'file:///documents', cache: 'file:///cache' },
  };
});
