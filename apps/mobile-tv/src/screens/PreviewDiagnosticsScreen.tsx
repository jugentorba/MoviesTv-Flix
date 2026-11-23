import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { AddonStateRecord } from '@moviestv/addons';
import { type Theme } from '@moviestv/ui';
import { safeInsetEdge } from '../app/safeAreaLayout';
import {
  readWebTvLayoutOverride,
  useFormFactor,
  type FormFactor,
} from '../app/platform';
import { useAccount } from '../auth/useAccount';
import { useAddons } from '../addons/useAddons';
import { useThemeStyles } from '../theme/ThemeProvider';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface PreviewDiagnostic {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
}

export function accountPreviewDiagnostic({
  backendAvailable,
  signedIn,
  loading,
}: {
  backendAvailable: boolean;
  signedIn: boolean;
  loading: boolean;
}): PreviewDiagnostic {
  if (loading) {
    return {
      id: 'account-sync',
      label: 'Account sync',
      status: 'info',
      detail: 'Checking backend configuration',
    };
  }
  if (!backendAvailable) {
    return {
      id: 'account-sync',
      label: 'Account sync',
      status: 'warn',
      detail: 'Guest mode — backend not configured',
    };
  }
  return {
    id: 'account-sync',
    label: 'Account sync',
    status: 'pass',
    detail: signedIn ? 'Backend available · signed in' : 'Backend available · signed out',
  };
}

export function previewBuildDiagnostic(
  rawBuildId: string | undefined,
): PreviewDiagnostic {
  const normalized = rawBuildId?.trim().toLowerCase() ?? '';
  const safeBuildId = /^[a-f0-9]{7,40}$/.test(normalized)
    ? normalized.slice(0, 16)
    : null;

  return {
    id: 'native-build-id',
    label: 'Build revision',
    status: safeBuildId ? 'pass' : 'info',
    detail: safeBuildId ?? 'Not stamped',
  };
}

export function providerPreviewDiagnostics(
  records: readonly AddonStateRecord[],
  ready: boolean,
  syncStatus: string,
): PreviewDiagnostic[] {
  const capabilities = (record: AddonStateRecord) => (
    record.descriptor?.capabilities
    ?? record.syncIdentity?.capabilities
    ?? []
  );
  const counts = (predicate: (caps: readonly string[]) => boolean) => {
    const matching = records.filter((record) => predicate(capabilities(record)));
    const setupRequired = matching.filter(
      (record) => record.installed.setupIncomplete,
    ).length;
    const disabled = matching.filter((record) => (
      !record.installed.enabled
      && !record.installed.setupIncomplete
    )).length;
    return {
      installed: matching.length,
      ready: matching.filter((record) => (
        record.installed.enabled
        && !record.installed.setupIncomplete
      )).length,
      setupRequired,
      disabled,
    };
  };
  const catalog = counts((caps) => caps.includes('catalog'));
  const stream = counts((caps) => caps.includes('stream'));
  const subtitle = counts((caps) => caps.includes('subtitle'));
  const liveTv = counts((caps) => caps.includes('live-tv'));
  const detail = ({
    ready,
    installed,
    setupRequired,
    disabled,
  }: {
    ready: number;
    installed: number;
    setupRequired: number;
    disabled: number;
  }) => ([
    `${ready} ready / ${installed} installed`,
    setupRequired > 0 ? `${setupRequired} setup required` : null,
    disabled > 0 ? `${disabled} disabled` : null,
  ].filter(Boolean).join(' · '));

  return [
    {
      id: 'providers-catalog',
      label: 'Catalog providers',
      status: catalog.ready > 0 ? 'pass' : 'info',
      detail: detail(catalog),
    },
    {
      id: 'providers-stream',
      label: 'Stream providers',
      status: stream.ready > 0 ? 'pass' : 'warn',
      detail: detail(stream),
    },
    {
      id: 'providers-subtitle',
      label: 'Subtitle providers',
      status: subtitle.ready > 0
        ? 'pass'
        : subtitle.installed > 0
          ? 'warn'
          : 'info',
      detail: detail(subtitle),
    },
    {
      id: 'providers-live-tv',
      label: 'Live TV providers',
      status: liveTv.ready > 0 ? 'pass' : 'warn',
      detail: detail(liveTv),
    },
    {
      id: 'providers-sync',
      label: 'Provider state',
      status: !ready ? 'info' : syncStatus === 'error' ? 'warn' : 'pass',
      detail: !ready ? 'Loading' : syncStatus,
    },
  ];
}

export function pwaBuildIdFromServiceWorker(
  source: string,
): string | null {
  const match = source.match(/^\s*const\s+CACHE\s*=\s*(['"])moviestv-shell-([a-f0-9]{16})\1\s*;/im);
  return match?.[2]?.toLowerCase() ?? null;
}

export function pwaBuildIdFromDocument(
  documentObject: {
    querySelector?(selector: string): {
      content?: unknown;
      getAttribute?(name: string): string | null;
    } | null;
  } | null | undefined,
): string | null {
  const meta = documentObject?.querySelector?.(
    'meta[name="moviestv-build-id"]',
  );
  const raw = typeof meta?.content === 'string'
    ? meta.content
    : meta?.getAttribute?.('content');
  const normalized = raw?.trim().toLowerCase() ?? '';
  return /^[a-f0-9]{16}$/.test(normalized)
    ? normalized
    : null;
}

export function webTvLayoutPreviewDiagnostic(
  formFactor: FormFactor | undefined,
  forced: boolean,
): PreviewDiagnostic {
  const tv = formFactor === 'tv';
  return {
    id: 'web-tv-layout',
    label: 'TV layout mode',
    status: tv ? 'pass' : 'info',
    detail: forced
      ? 'Forced on this browser'
      : tv
        ? 'Auto-detected TV'
        : 'Automatic',
  };
}

export function secureContextPreviewDiagnostic(
  secure: boolean | undefined,
): PreviewDiagnostic {
  return {
    id: 'secure-context',
    label: 'Secure context',
    status: secure === true
      ? 'pass'
      : secure === false
        ? 'fail'
        : 'info',
    detail: secure === true
      ? 'HTTPS / trusted context'
      : secure === false
        ? 'Browser does not consider this page secure'
        : 'Secure-context capability unavailable',
  };
}

export function pwaUpdateDiagnostic(
  runningBuildId: string | null,
  networkBuildId: string | null,
): PreviewDiagnostic {
  if (!networkBuildId) {
    return {
      id: 'pwa-update',
      label: 'PWA update',
      status: 'info',
      detail: 'Network build ID unavailable',
    };
  }
  if (!runningBuildId) {
    return {
      id: 'pwa-update',
      label: 'PWA update',
      status: 'warn',
      detail: `Running page build ID unavailable · network ${networkBuildId}`,
    };
  }
  if (runningBuildId === networkBuildId) {
    return {
      id: 'pwa-update',
      label: 'PWA update',
      status: 'pass',
      detail: 'Current',
    };
  }
  return {
    id: 'pwa-update',
    label: 'PWA update',
    status: 'warn',
    detail: `Update available · ${networkBuildId}`,
  };
}

export function browserMediaPreviewDiagnostics(
  canPlayType: (type: string) => string,
  mseH264Supported?: boolean,
): PreviewDiagnostic[] {
  const probe = (type: string): string => {
    try {
      return canPlayType(type) || '';
    } catch {
      return '';
    }
  };

  const h264 = probe('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  const hevc = probe('video/mp4; codecs="hvc1.1.6.L93.B0"');
  const av1 = probe('video/mp4; codecs="av01.0.04M.08"');
  const dolbyVision = probe('video/mp4; codecs="dvh1.05.06"')
    || probe('video/mp4; codecs="dvhe.05.06"');
  const dts = [
    'dtsc',
    'dtsh',
    'dtse',
    'dtsl',
    'dtsx',
    'dtsy',
  ].map((codec) => (
    probe(`audio/mp4; codecs="${codec}"`)
      || probe(`video/mp4; codecs="${codec}"`)
  )).find(Boolean) ?? '';
  const trueHd = probe('audio/mp4; codecs="mlpa"')
    || probe('video/mp4; codecs="mlpa"');
  const nativeHls = probe('application/vnd.apple.mpegurl')
    || probe('application/x-mpegURL');
  const webm = probe('video/webm');
  const hlsPath: PreviewDiagnostic = nativeHls
    ? {
        id: 'hls-path',
        label: 'HLS playback path',
        status: 'pass',
        detail: 'Native HLS',
      }
    : mseH264Supported === true
      ? {
          id: 'hls-path',
          label: 'HLS playback path',
          status: 'pass',
          detail: 'hls.js via Media Source Extensions',
        }
      : mseH264Supported === false
        ? {
            id: 'hls-path',
            label: 'HLS playback path',
            status: 'fail',
            detail: 'No native HLS or H.264 Media Source Extensions',
          }
        : {
            id: 'hls-path',
            label: 'HLS playback path',
            status: 'info',
            detail: 'Media Source Extensions capability unavailable',
          };

  return [
    {
      id: 'h264',
      label: 'H.264 MP4',
      status: h264 ? 'pass' : 'warn',
      detail: h264 || 'Browser did not advertise support',
    },
    {
      id: 'hevc',
      label: 'HEVC / H.265 MP4',
      status: hevc ? 'pass' : 'info',
      detail: hevc || 'Browser did not advertise support',
    },
    {
      id: 'av1',
      label: 'AV1 MP4',
      status: av1 ? 'pass' : 'info',
      detail: av1 || 'Browser did not advertise support',
    },
    {
      id: 'dolby-vision',
      label: 'Dolby Vision',
      status: dolbyVision ? 'pass' : 'info',
      detail: dolbyVision || 'Browser did not advertise support',
    },
    {
      id: 'dts',
      label: 'DTS audio',
      status: dts ? 'pass' : 'info',
      detail: dts || 'Browser did not advertise support',
    },
    {
      id: 'truehd',
      label: 'TrueHD audio',
      status: trueHd ? 'pass' : 'info',
      detail: trueHd || 'Browser did not advertise support',
    },
    {
      id: 'native-hls',
      label: 'Native HLS',
      status: nativeHls ? 'pass' : 'info',
      detail: nativeHls || 'Uses hls.js when supported',
    },
    {
      id: 'webm',
      label: 'WebM',
      status: webm ? 'pass' : 'info',
      detail: webm || 'Not advertised by this browser',
    },
    hlsPath,
  ];
}

export function pwaBuildIdFromCacheKeys(
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const match = key.match(/^moviestv-shell-([a-f0-9]{16})$/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

function statusGlyph(status: DiagnosticStatus): string {
  if (status === 'pass') return '✓';
  if (status === 'fail') return '!';
  if (status === 'warn') return '△';
  return '•';
}

type DiagnosticFetcher = (
  input: string,
  init: {
    method: 'GET';
    redirect: 'follow';
    cache?: 'no-store';
    signal?: unknown;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const defaultDiagnosticFetcher: DiagnosticFetcher = (input, init) => fetch(
  input,
  init as Parameters<typeof fetch>[1],
);

const MAX_DIAGNOSTIC_TEXT_BYTES = 262_144;

function diagnosticUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function boundedDiagnosticText(
  response: Awaited<ReturnType<DiagnosticFetcher>>,
  timeout: Promise<never>,
): Promise<string> {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength) {
    const normalized = declaredLength.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error('diagnostic-invalid-length');
    }
    const parsed = Number(normalized);
    if (
      !Number.isSafeInteger(parsed)
      || parsed > MAX_DIAGNOSTIC_TEXT_BYTES
    ) {
      throw new Error('diagnostic-too-large');
    }
  }

  const text = await Promise.race([response.text(), timeout]);
  if (diagnosticUtf8ByteLength(text) > MAX_DIAGNOSTIC_TEXT_BYTES) {
    throw new Error('diagnostic-too-large');
  }
  return text;
}

async function networkPwaBuildId(
  fetcher: DiagnosticFetcher = defaultDiagnosticFetcher,
  timeoutMs = 5_000,
): Promise<string | null> {
  const AbortControllerImpl = (globalThis as {
    AbortController?: new () => { signal: unknown; abort(): void };
  }).AbortController;
  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('diagnostic-timeout'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetcher('/service-worker.js', {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      }),
      timeout,
    ]);
    if (!response.ok) return null;
    const source = await boundedDiagnosticText(response, timeout);
    return pwaBuildIdFromServiceWorker(source);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function endpointPreviewDiagnostic(
  path: string,
  label: string,
  expectJson = false,
  fetcher: DiagnosticFetcher = defaultDiagnosticFetcher,
  timeoutMs = 5_000,
): Promise<PreviewDiagnostic> {
  const AbortControllerImpl = (globalThis as {
    AbortController?: new () => { signal: unknown; abort(): void };
  }).AbortController;
  const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('diagnostic-timeout'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetcher(path, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      }),
      timeout,
    ]);
    if (!response.ok) {
      return {
        id: path,
        label,
        status: 'fail',
        detail: `HTTP ${response.status}`,
      };
    }
    if (expectJson) {
      const text = await boundedDiagnosticText(response, timeout);
      try {
        JSON.parse(text);
      } catch {
        return {
          id: path,
          label,
          status: 'fail',
          detail: 'Route returned non-JSON content',
        };
      }
    }
    return {
      id: path,
      label,
      status: 'pass',
      detail: 'Available',
    };
  } catch (error) {
    return {
      id: path,
      label,
      status: 'fail',
      detail: error instanceof Error && error.message === 'diagnostic-timeout'
        ? 'Request timed out'
        : 'Request failed',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectPreviewDiagnostics(
  formFactor?: FormFactor,
): Promise<PreviewDiagnostic[]> {
  const results: PreviewDiagnostic[] = [{
    id: 'platform',
    label: 'Platform',
    status: 'info',
    detail: Platform.OS,
  }];
  if (formFactor) {
    results.push({
      id: 'form-factor',
      label: 'Layout',
      status: formFactor === 'tv' ? 'pass' : 'info',
      detail: formFactor,
    });
  }

  if (Platform.OS !== 'web') {
    results.push(
      {
        id: 'native-build',
        label: 'Native runtime',
        status: 'pass',
        detail: 'Native app runtime detected',
      },
      previewBuildDiagnostic(process.env.EXPO_PUBLIC_BUILD_SHA),
    );
    return results;
  }

  results.push(webTvLayoutPreviewDiagnostic(
    formFactor,
    readWebTvLayoutOverride(),
  ));

  const runtime = globalThis as typeof globalThis & {
    isSecureContext?: boolean;
    navigator?: {
      onLine?: boolean;
      standalone?: boolean;
      serviceWorker?: { controller?: unknown };
    };
    matchMedia?: (query: string) => { matches: boolean };
    document?: {
      createElement?(tagName: string): {
        canPlayType(type: string): string;
      };
      querySelector?(selector: string): {
        content?: unknown;
        getAttribute?(name: string): string | null;
      } | null;
    };
    caches?: {
      keys(): Promise<string[]>;
    };
    MediaSource?: {
      isTypeSupported?(type: string): boolean;
    };
  };
  const online = runtime.navigator?.onLine !== false;
  results.push({
    id: 'network',
    label: 'Network',
    status: online ? 'pass' : 'fail',
    detail: online ? 'Online' : 'Offline',
  });
  results.push(secureContextPreviewDiagnostic(
    runtime.isSecureContext,
  ));

  const standalone = Boolean(
    runtime.matchMedia?.('(display-mode: standalone)').matches
    || runtime.navigator?.standalone,
  );
  results.push({
    id: 'install-mode',
    label: 'Install mode',
    status: standalone ? 'pass' : 'warn',
    detail: standalone ? 'Standalone PWA' : 'Browser tab',
  });

  const serviceWorkerSupported = Boolean(runtime.navigator?.serviceWorker);
  const serviceWorkerControlled = Boolean(
    runtime.navigator?.serviceWorker?.controller,
  );
  results.push({
    id: 'service-worker',
    label: 'Service worker',
    status: serviceWorkerControlled
      ? 'pass'
      : serviceWorkerSupported
        ? 'warn'
        : 'fail',
    detail: serviceWorkerControlled
      ? 'Active'
      : serviceWorkerSupported
        ? 'Supported but not controlling this page'
        : 'Not supported',
  });

  const runningPwaBuildId = pwaBuildIdFromDocument(
    runtime.document,
  );
  results.push({
    id: 'pwa-running-build',
    label: 'Running PWA build',
    status: runningPwaBuildId ? 'pass' : 'warn',
    detail: runningPwaBuildId ?? 'No stamped page build found',
  });

  let activePwaBuildId: string | null = null;
  if (runtime.caches) {
    try {
      activePwaBuildId = pwaBuildIdFromCacheKeys(
        await runtime.caches.keys(),
      );
      results.push({
        id: 'pwa-build',
        label: 'PWA build',
        status: activePwaBuildId ? 'pass' : 'warn',
        detail: activePwaBuildId ?? 'No stamped MoviesTv-Flix cache found',
      });
    } catch {
      results.push({
        id: 'pwa-build',
        label: 'PWA build',
        status: 'warn',
        detail: 'Cache storage is unavailable',
      });
    }
  }
  results.push(pwaUpdateDiagnostic(
    runningPwaBuildId,
    await networkPwaBuildId(),
  ));

  const video = runtime.document?.createElement?.('video');
  if (video) {
    let mseH264Supported: boolean | undefined;
    try {
      const isTypeSupported = runtime.MediaSource?.isTypeSupported;
      if (typeof isTypeSupported === 'function') {
        mseH264Supported = Boolean(isTypeSupported.call(
          runtime.MediaSource,
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
        ));
      }
    } catch {
      mseH264Supported = false;
    }

    results.push(...browserMediaPreviewDiagnostics(
      (type) => video.canPlayType(type),
      mseH264Supported,
    ));
  }

  const endpointResults = await Promise.all([
    endpointPreviewDiagnostic('/manifest.webmanifest', 'Web app manifest'),
    endpointPreviewDiagnostic('/service-worker.js', 'Service worker file'),
    endpointPreviewDiagnostic('/api/runtime-config', 'Runtime config route', true),
    endpointPreviewDiagnostic(
      '/api/nuvio-catalog/manifest.json',
      'Nuvio catalog proxy',
      true,
    ),
    endpointPreviewDiagnostic(
      '/api/cinemeta/manifest.json',
      'Cinemeta catalog proxy',
      true,
    ),
  ]);
  results.push(...endpointResults);
  return results;
}

export function PreviewDiagnosticsScreen({
  onBack,
}: {
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const formFactor = useFormFactor();
  const account = useAccount();
  const addons = useAddons();
  const requestGenerationRef = useRef(0);
  const [items, setItems] = useState<PreviewDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    void collectPreviewDiagnostics(formFactor)
      .then((nextItems) => {
        if (generation === requestGenerationRef.current) {
          setItems([
            ...nextItems,
            ...providerPreviewDiagnostics(
              addons.installed,
              addons.ready,
              addons.syncStatus,
            ),
            accountPreviewDiagnostic({
              backendAvailable: account.backendAvailable,
              signedIn: Boolean(account.userId),
              loading: account.loading,
            }),
          ]);
        }
      })
      .finally(() => {
        if (generation === requestGenerationRef.current) {
          setLoading(false);
        }
      });
  }, [
    account.backendAvailable,
    account.loading,
    account.userId,
    addons.installed,
    addons.ready,
    addons.syncStatus,
    formFactor,
  ]);

  useEffect(() => {
    refresh();
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [refresh]);

  return (
    <ScrollView
      testID="preview-diagnostics-screen"
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: safeInsetEdge(32, safeAreaInsets.top, 12),
          paddingBottom: safeInsetEdge(32, safeAreaInsets.bottom, 12),
          paddingLeft: safeInsetEdge(20, safeAreaInsets.left, 12),
          paddingRight: safeInsetEdge(20, safeAreaInsets.right, 12),
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ focused, pressed }) => [
          styles.back,
          focused && styles.focused,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>
      <Text style={styles.title}>Preview diagnostics</Text>
      <Text style={styles.subtitle}>
        Device checks only. No provider keys or private URLs are displayed.
      </Text>

      <View style={styles.card}>
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.glyph}>{statusGlyph(item.status)}</Text>
            <View style={styles.copy}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.detail}>{item.detail}</Text>
            </View>
          </View>
        ))}
        {loading ? <Text style={styles.loading}>Checking…</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        testID="preview-diagnostics-refresh"
        onPress={refresh}
        style={({ focused, pressed }) => [
          styles.refresh,
          focused && styles.focused,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.refreshText}>Run checks again</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingHorizontal: '5%',
    paddingVertical: 32,
  },
  back: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 16 },
  backText: { color: theme.colors.muted, fontSize: 16, fontWeight: '800' },
  title: {
    color: theme.colors.text,
    fontSize: 30,
    fontWeight: '900',
    marginTop: 14,
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 20,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  glyph: {
    color: theme.colors.accent,
    width: 20,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  copy: { flex: 1, paddingVertical: 10 },
  label: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  detail: { color: theme.colors.muted, fontSize: 11, marginTop: 3 },
  loading: {
    color: theme.colors.muted,
    padding: 16,
    textAlign: 'center',
  },
  refresh: {
    minHeight: 52,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  refreshText: { color: theme.colors.text, fontWeight: '900' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.75 },
});
