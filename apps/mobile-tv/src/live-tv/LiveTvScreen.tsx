import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import { rankStreamSources } from '@moviestv/playback';
import { fontFamily, type Theme } from '@moviestv/ui';
import { useAddons } from '../addons/useAddons';
import { useAccount } from '../auth/useAccount';
import { useI18n } from '../i18n/useI18n';
import { usePreferences } from '../preferences/usePreferences';
import { SourceChooser } from '../playback/SourceChooser';
import { playbackSourceFingerprint } from '../playback/playbackSourceIdentity';
import { webEngineSupportsMatroska } from '../playback/webContainerSupport';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { LiveTvChannelService, type LiveTvChannelLoadResult } from './LiveTvChannelService';
import { LiveTvPlaybackController, type LiveTvPlaybackState } from './LiveTvPlaybackController';
import { LiveTvPlayer } from './LiveTvPlayer';
import { LiveTvProviderChooser } from './LiveTvProviderChooser';
import { StremioLiveTvAdapter } from './StremioLiveTvAdapter';
import { RoutedLiveTvAdapter } from './RoutedLiveTvAdapter';
import {
  m3uLiveTvAdapterFor,
  m3uPlaylistStoreFor,
} from './m3u-playlist-runtime';
import { useNativeTvChannelKeys } from './useNativeTvChannelKeys';
import {
  availableLiveTvCountries,
  buildLiveTvView,
  liveTvCountryLabel,
} from './live-tv-view-model';
import {
  createLiveTvProviders,
  mergeLiveTvProviders,
  sameLiveTvProviders,
} from './live-tv-providers';
import {
  isLiveTvBrowserChannel,
  liveTvFavoriteKey,
  type LiveTvBrowserChannel,
} from './live-tv-aggregation';
import {
  guideCardRows,
  type GuideCardRow,
} from './live-tv-guide-view-model';
import {
  createLiveTvGuideRuntime,
  subscribeLiveTvGuideChanges,
} from './live-tv-guide-runtime';
import {
  type LiveTvGuideState,
} from './LiveTvGuideController';
import { LiveTvGuideTimelineScreen } from './LiveTvGuideTimelineScreen';
import {
  focusWebTvControl,
  useWebTvBackHandler,
  useWebTvModalFocusRestore,
  webTvChannelAction,
} from '../web/tvRemoteNavigation';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

export interface LiveTvScreenProps {
  mode: 'phone' | 'tv';
  onOpenProviders(): void;
}

type LoadState = { status: 'idle' | 'loading' | 'ready'; result: LiveTvChannelLoadResult | null };

const LIVE_TV_RENDER_BATCH = 250;

function countrylessFavoriteKey(channel: LiveTvChannel): string {
  return liveTvFavoriteKey({ ...channel, countryCode: undefined });
}

function emptyGuideState(): LiveTvGuideState {
  return {
    status: 'unconfigured',
    snapshot: undefined,
    matches: new Map(),
  };
}

function FocusButton({
  label,
  testID,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string;
  testID?: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      focusable={!disabled}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        selected && styles.buttonSelected,
        focused && !disabled && styles.focused,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function FavoriteButton({
  favorite,
  testID,
  onPress,
}: {
  favorite: boolean;
  testID?: string;
  onPress(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={favorite
        ? t('liveTv.removeFavorite')
        : t('liveTv.addFavorite')}
      testID={testID}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={({ focused, pressed }) => [
        styles.favoriteButton,
        favorite && styles.favoriteButtonActive,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.favoriteIcon, favorite && styles.favoriteIconActive]}>
        {favorite ? '★' : '☆'}
      </Text>
    </Pressable>
  );
}

function ChannelRow({
  channel,
  countryLabel,
  favorite,
  guideRows = [],
  selected = false,
  preferredFocus = false,
  onToggleFavorite,
  onOpenGuide,
  onPress,
}: {
  channel: LiveTvChannel;
  countryLabel?: string;
  favorite: boolean;
  guideRows?: readonly GuideCardRow[];
  selected?: boolean;
  preferredFocus?: boolean;
  onToggleFavorite(): void;
  onOpenGuide?(): void;
  onPress(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const rowRef = useRef<React.ElementRef<typeof View>>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !preferredFocus) return;
    focusWebTvControl(rowRef.current);
  }, [preferredFocus]);

  return (
    <Pressable
      ref={rowRef}
      focusable
      hasTVPreferredFocus={preferredFocus}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={`live-tv-channel-${channel.id}`}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.channelRow,
        selected && styles.channelSelected,
        focused && styles.channelFocused,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.logoShell}>
        {channel.posterUrl ? (
          <Image source={{ uri: channel.posterUrl }} style={styles.logo} resizeMode="contain" />
        ) : (
          <Text style={styles.logoFallback}>{channel.title.slice(0, 2).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.channelCopy}>
        <Text style={styles.channelTitle} numberOfLines={1}>{channel.title}</Text>
        {countryLabel ? <Text style={styles.channelMeta}>{countryLabel}</Text> : null}
        {guideRows.map((row) => (
          <Text
            key={row.kind}
            numberOfLines={1}
            style={styles.guideRow}
          >
            <Text style={styles.guideKind}>{row.kind}</Text>
            {'  '}{row.time}  {row.title}
          </Text>
        ))}
      </View>
      {onOpenGuide ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('liveTv.programmeGuide')}
          testID={`live-tv-guide-${channel.id}`}
          onPress={(event) => {
            event.stopPropagation();
            onOpenGuide();
          }}
          style={({ focused, pressed }) => [
            styles.guideButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.guideButtonText}>EPG</Text>
        </Pressable>
      ) : null}
      <FavoriteButton
        favorite={favorite}
        testID={`live-tv-favorite-${channel.id}`}
        onPress={onToggleFavorite}
      />
    </Pressable>
  );
}

export function LiveTvScreen({ mode, onOpenProviders }: LiveTvScreenProps) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const { installed } = useAddons();
  const { userId } = useAccount();
  const { preferences, setFavoriteChannelIds } = usePreferences();
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const { t, locale } = useI18n();
  const addonProviders = useMemo(
    () => createLiveTvProviders(installed),
    [installed],
  );
  const addonAdapter = useMemo(() => new StremioLiveTvAdapter(), []);
  const playlistStore = useMemo(() => m3uPlaylistStoreFor(userId), [userId]);
  const playlistAdapter = useMemo(
    () => m3uLiveTvAdapterFor(userId),
    [userId],
  );
  const adapter = useMemo(
    () => new RoutedLiveTvAdapter(addonAdapter, playlistAdapter),
    [addonAdapter, playlistAdapter],
  );
  const [playlistProviders, setPlaylistProviders] = useState<
    LiveTvProviderDescriptor[]
  >([]);
  const providers = useMemo(
    () => mergeLiveTvProviders(addonProviders, playlistProviders),
    [addonProviders, playlistProviders],
  );
  const service = useMemo(
    () => new LiveTvChannelService(adapter),
    [adapter, userId],
  );
  const guideRuntime = useMemo(
    () => createLiveTvGuideRuntime(userId),
    [userId],
  );
  const guideController = guideRuntime.controller;
  const controller = useMemo(
    () => new LiveTvPlaybackController(
      adapter,
      (sources) => rankStreamSources(sources, {
        preferredAudioLanguages:
          preferencesRef.current.preferredAudioLanguages,
        preferWebCompatible: Platform.OS === 'web',
        webMatroskaSupported: Platform.OS === 'web' && webEngineSupportsMatroska(),
      }).map(({ source }) => source),
    ),
    [adapter],
  );
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle', result: null });
  const [playback, setPlayback] = useState<LiveTvPlaybackState>(controller.state);
  const [query, setQuery] = useState('');
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [phonePlayerOpen, setPhonePlayerOpen] = useState(false);
  const [phoneChannelListOpen, setPhoneChannelListOpen] = useState(false);
  const [tvPlayerOpen, setTvPlayerOpen] = useState(false);
  const [tvChannelListOpen, setTvChannelListOpen] = useState(false);
  const [sourceChooserOpen, setSourceChooserOpen] = useState(false);
  const [providerChooserOpen, setProviderChooserOpen] = useState(false);
  const [guideState, setGuideState] = useState<LiveTvGuideState>(
    () => emptyGuideState(),
  );
  const [guideChannelId, setGuideChannelId] = useState<string | null>(null);
  const [guideNowMs, setGuideNowMs] = useState(() => Date.now());
  const [zapChannelIds, setZapChannelIds] = useState<string[]>([]);
  const [channelRenderWindow, setChannelRenderWindow] = useState({
    filterKey: '',
    limit: LIVE_TV_RENDER_BATCH,
  });
  const loadTokenRef = useRef(0);
  const lastChannelResultRef = useRef<LiveTvChannelLoadResult | null>(null);
  const guideLoadTokenRef = useRef(0);
  const liveTvIdentityRef = useRef(userId);
  const favoriteChannelIdsRef = useRef(preferences.favoriteChannelIds);
  const favoriteMigrationRef = useRef<{
    signature: string;
    status: 'pending' | 'failed';
  } | null>(null);
  const [effectiveFavoriteChannelIds, setEffectiveFavoriteChannelIds] = useState(
    () => [...preferences.favoriteChannelIds],
  );
  const suppressGuideReloadForChannelsRef = useRef<readonly LiveTvChannel[] | null>(null);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setPlayback);
    return () => {
      unsubscribe();
      controller.close();
    };
  }, [controller]);

  useEffect(() => {
    if (liveTvIdentityRef.current === userId) return;
    liveTvIdentityRef.current = userId;
    loadTokenRef.current += 1;
    guideLoadTokenRef.current += 1;
    lastChannelResultRef.current = null;
    setLoadState({ status: 'idle', result: null });
    setGuideState(emptyGuideState());
    setGuideChannelId(null);
    setPhoneChannelListOpen(false);
    setTvChannelListOpen(false);
    setSourceChooserOpen(false);
    setProviderChooserOpen(false);
    setPhonePlayerOpen(false);
    setTvPlayerOpen(false);
    setZapChannelIds([]);
    favoriteMigrationRef.current = null;
    controller.close();
    void controller.setPreferredProvider(null);
  }, [controller, userId]);

  // Playlist providers live in secure storage, so they are read asynchronously
  // and refreshed whenever the playlist settings screen changes them.
  useEffect(() => {
    let active = true;
    const apply = (next: LiveTvProviderDescriptor[]) => {
      if (!active) return;
      // Keep the previous array when the content is unchanged: a new identity
      // here would restart the channel load for the same providers.
      setPlaylistProviders((current) => (
        sameLiveTvProviders(current, next) ? current : next
      ));
    };
    apply([]);
    const refresh = () => {
      void playlistAdapter.providers()
        .then(apply)
        .catch(() => apply([]));
    };
    refresh();
    const unsubscribe = playlistStore.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [playlistAdapter, playlistStore]);

  useEffect(() => {
    favoriteChannelIdsRef.current = preferences.favoriteChannelIds;
    setEffectiveFavoriteChannelIds([...preferences.favoriteChannelIds]);
  }, [preferences.favoriteChannelIds]);

  const favoriteIds = useMemo(
    () => new Set(effectiveFavoriteChannelIds),
    [effectiveFavoriteChannelIds],
  );

  const favoriteKeys = useCallback((channel: LiveTvChannel) => {
    const keys = isLiveTvBrowserChannel(channel)
      ? [
        liveTvFavoriteKey(channel),
        channel.id,
        ...channel.variants.flatMap((variant) => [
          variant.channel.id,
          liveTvFavoriteKey(variant.channel),
        ]),
      ]
      : [liveTvFavoriteKey(channel), channel.id];

    return [...new Set(keys.filter(Boolean))];
  }, []);

  const isFavorite = useCallback(
    (channel: LiveTvChannel) => (
      favoriteKeys(channel).some((id) => favoriteIds.has(id))
    ),
    [favoriteIds, favoriteKeys],
  );

  const toggleFavorite = useCallback((channel: LiveTvChannel) => {
    const next = new Set(favoriteChannelIdsRef.current);
    const keys = favoriteKeys(channel);
    const currentlyFavorite = keys.some((id) => next.has(id));

    for (const id of keys) next.delete(id);
    if (!currentlyFavorite) next.add(liveTvFavoriteKey(channel));

    const nextIds = [...next].sort();
    favoriteChannelIdsRef.current = nextIds;
    setEffectiveFavoriteChannelIds(nextIds);
    void setFavoriteChannelIds(nextIds).catch(() => undefined);
  }, [
    favoriteKeys,
    setFavoriteChannelIds,
  ]);

  const load = useCallback(async (
    refresh = false,
    suppressGuideReload = false,
  ): Promise<LiveTvChannelLoadResult | null> => {
    const token = ++loadTokenRef.current;
    if (!providers.length) {
      setLoadState({ status: 'idle', result: null });
      return null;
    }
    setLoadState((current) => ({ status: 'loading', result: current.result }));
    try {
      const result = await service.load(providers, { refresh });
      if (token !== loadTokenRef.current) return null;
      lastChannelResultRef.current = result;
      if (suppressGuideReload) {
        suppressGuideReloadForChannelsRef.current = result.channels;
      }
      setLoadState({ status: 'ready', result });
      return result;
    } catch {
      if (token !== loadTokenRef.current) return null;
      const failedProviderIds = [...new Set(
        providers
          .map((provider) => provider.addonId?.trim())
          .filter((addonId): addonId is string => Boolean(addonId)),
      )].sort();
      const result: LiveTvChannelLoadResult = {
        channels: lastChannelResultRef.current?.channels ?? [],
        failedProviderIds,
        providerCount: providers.length,
        truncatedProviderIds: [],
      };
      lastChannelResultRef.current = result;
      if (suppressGuideReload) {
        suppressGuideReloadForChannelsRef.current = result.channels;
      }
      setLoadState({ status: 'ready', result });
      return result;
    }
  }, [providers, service]);

  useEffect(() => { void load(false); }, [load]);

  const channels = useMemo(
    () => loadState.result?.channels ?? [],
    [loadState.result],
  );

  useEffect(() => {
    const currentChannel = playback.channel;
    if (!currentChannel) return;

    const currentFavoriteAliases = favoriteKeys(currentChannel);
    const refreshed = channels.find(
      (channel) => channel.id === currentChannel.id,
    ) ?? channels.find(
      (channel) => (
        liveTvFavoriteKey(channel)
        === liveTvFavoriteKey(currentChannel)
      ),
    ) ?? channels.find((channel) => {
      const aliases = favoriteKeys(channel);
      return aliases.includes(currentChannel.id)
        || currentFavoriteAliases.includes(channel.id)
        || aliases.some((alias) => currentFavoriteAliases.includes(alias));
    });

    if (!refreshed || !isLiveTvBrowserChannel(refreshed)) {
      if (loadState.status === 'ready' || providers.length === 0) {
        setPhoneChannelListOpen(false);
        setTvChannelListOpen(false);
        setSourceChooserOpen(false);
        setPhonePlayerOpen(false);
        setTvPlayerOpen(false);
        setZapChannelIds([]);
        controller.close();
      }
      return;
    }

    if (refreshed.id !== currentChannel.id) {
      setZapChannelIds((current) => current.map((id) => (
        id === currentChannel.id ? refreshed.id : id
      )));
    }

    controller.updateLogicalChannel(refreshed);
  }, [
    channels,
    controller,
    favoriteKeys,
    loadState.status,
    playback.channel?.id,
    providers.length,
  ]);

  useEffect(() => {
    if (!channels.length || !preferences.favoriteChannelIds.length) return;

    let changed = false;
    const migrated = new Set<string>();

    for (const favoriteId of preferences.favoriteChannelIds) {
      let channel = channels.find((candidate) => (
        favoriteKeys(candidate).includes(favoriteId)
      ));
      const countrylessMatches = channels.filter((candidate) => (
        countrylessFavoriteKey(candidate) === favoriteId
      ));

      if (favoriteId.startsWith('live-tv-favorite:--:')) {
        const enrichedByCanonicalKey = new Map<string, LiveTvBrowserChannel>();
        for (const candidate of countrylessMatches) {
          const canonical = liveTvFavoriteKey(candidate);
          if (canonical === favoriteId) continue;
          enrichedByCanonicalKey.set(canonical, candidate);
        }
        if (enrichedByCanonicalKey.size === 1) {
          channel = [...enrichedByCanonicalKey.values()][0];
        }
      } else if (!channel && countrylessMatches.length === 1) {
        [channel] = countrylessMatches;
      }

      if (!channel) {
        migrated.add(favoriteId);
        continue;
      }

      const canonicalFavorite = liveTvFavoriteKey(channel);
      migrated.add(canonicalFavorite);
      if (canonicalFavorite !== favoriteId) changed = true;
    }

    const next = [...migrated].sort();
    if (
      changed
      || next.length !== preferences.favoriteChannelIds.length
    ) {
      const migrationSignature = JSON.stringify([
        preferences.favoriteChannelIds,
        next,
      ]);
      if (favoriteMigrationRef.current?.signature === migrationSignature) {
        return;
      }

      favoriteMigrationRef.current = {
        signature: migrationSignature,
        status: 'pending',
      };
      favoriteChannelIdsRef.current = next;
      setEffectiveFavoriteChannelIds(next);
      void setFavoriteChannelIds(next)
        .then(() => {
          if (favoriteMigrationRef.current?.signature === migrationSignature) {
            favoriteMigrationRef.current = null;
          }
        })
        .catch(() => {
          if (favoriteMigrationRef.current?.signature === migrationSignature) {
            favoriteMigrationRef.current = {
              signature: migrationSignature,
              status: 'failed',
            };
          }
        });
    }
  }, [
    channels,
    favoriteKeys,
    preferences.favoriteChannelIds,
    setFavoriteChannelIds,
  ]);

  const countries = useMemo(
    () => availableLiveTvCountries(channels),
    [channels],
  );

  useEffect(() => {
    let active = true;

    const reload = () => {
      const token = ++guideLoadTokenRef.current;
      const nowMs = Date.now();
      setGuideNowMs(nowMs);
      void guideController.load(channels, nowMs)
        .then((next) => {
          if (active && token === guideLoadTokenRef.current) {
            setGuideState(next);
          }
        });
    };

    if (suppressGuideReloadForChannelsRef.current === channels) {
      suppressGuideReloadForChannelsRef.current = null;
    } else {
      reload();
    }
    const unsubscribe = subscribeLiveTvGuideChanges(reload);

    return () => {
      active = false;
      guideLoadTokenRef.current += 1;
      unsubscribe();
    };
  }, [channels, guideController]);

  useEffect(() => {
    const timer = setInterval(() => {
      setGuideNowMs(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const refreshGuide = useCallback(async (
    guideChannels: readonly LiveTvChannel[] = channels,
  ) => {
    const token = ++guideLoadTokenRef.current;
    const nowMs = Date.now();
    setGuideNowMs(nowMs);
    const next = await guideController.refresh(guideChannels, nowMs);
    if (token !== guideLoadTokenRef.current) return;
    setGuideState(next);
  }, [channels, guideController]);

  const refreshAll = useCallback(async () => {
    setSourceChooserOpen(false);
    setProviderChooserOpen(false);
    const result = await load(true, true);
    if (!result) return;
    await refreshGuide(result.channels);
  }, [load, refreshGuide]);

  const visibleChannels = useMemo(() => {
    const base = buildLiveTvView(channels, query, countryCode);
    return favoritesOnly ? base.filter(isFavorite) : base;
  }, [channels, countryCode, favoritesOnly, isFavorite, query]);

  const channelRenderFilterKey = [
    userId ?? 'guest',
    favoritesOnly ? 'favorites' : 'all',
    countryCode ?? '',
    query.trim().toLowerCase(),
  ].join('\u0000');
  const effectiveChannelRenderLimit =
    channelRenderWindow.filterKey === channelRenderFilterKey
      ? channelRenderWindow.limit
      : LIVE_TV_RENDER_BATCH;

  const renderedChannels = useMemo(() => {
    const base = visibleChannels.slice(0, effectiveChannelRenderLimit);
    const current = playback.channel;
    if (!current || base.length >= visibleChannels.length) return base;

    const currentKey = liveTvFavoriteKey(current);
    if (base.some((channel) => (
      liveTvFavoriteKey(channel) === currentKey
    ))) return base;

    const selected = visibleChannels.find((channel) => (
      channel.id === current.id
      || liveTvFavoriteKey(channel) === currentKey
    ));
    if (!selected) return base;

    return [
      ...base.slice(0, Math.max(0, base.length - 1)),
      selected,
    ];
  }, [
    effectiveChannelRenderLimit,
    playback.channel,
    visibleChannels,
  ]);

  const canRenderMoreChannels =
    effectiveChannelRenderLimit < visibleChannels.length;

  const renderMoreChannels = useCallback(() => {
    setChannelRenderWindow((current) => {
      const currentLimit = current.filterKey === channelRenderFilterKey
        ? current.limit
        : LIVE_TV_RENDER_BATCH;
      return {
        filterKey: channelRenderFilterKey,
        limit: Math.min(
          visibleChannels.length,
          currentLimit + LIVE_TV_RENDER_BATCH,
        ),
      };
    });
  }, [channelRenderFilterKey, visibleChannels.length]);

  const selectedSource = playback.selectedSourceId
    ? playback.sources.find((source) => source.id === playback.selectedSourceId) ?? null
    : null;
  const channelProviders = useMemo(() => {
    if (!playback.channel || !isLiveTvBrowserChannel(playback.channel)) {
      return [];
    }
    const seen = new Set<string>();
    return playback.channel.variants
      .map((variant) => variant.provider)
      .filter((provider) => {
        const id = provider.addonId?.trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }, [playback.channel]);
  const preferredProviderId = controller.getPreferredProviderId();
  const activeProviderId = controller.getActiveProviderId();
  const providerButtonName = channelProviders.find(
    (provider) => provider.addonId.trim() === preferredProviderId,
  )?.name ?? channelProviders.find(
    (provider) => provider.addonId.trim() === activeProviderId,
  )?.name ?? t('liveTv.autoProvider');
  const providerButtonLabel =
    `${t('common.provider')}: ${preferredProviderId
      ? providerButtonName
      : t('liveTv.autoProvider')}`;
  const zapChannels = useMemo(() => {
    if (!zapChannelIds.length) return visibleChannels;
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const byKey = new Map<string, LiveTvBrowserChannel>();
    for (const channel of channels) {
      for (const key of favoriteKeys(channel)) {
        if (!byKey.has(key)) byKey.set(key, channel);
      }
    }
    const seen = new Set<string>();
    const snapshot = zapChannelIds.flatMap((id) => {
      const channel = byId.get(id) ?? byKey.get(id);
      if (!channel || seen.has(channel.id)) return [];
      seen.add(channel.id);
      return [channel];
    });
    return snapshot.length ? snapshot : visibleChannels;
  }, [
    channels,
    favoriteKeys,
    visibleChannels,
    zapChannelIds,
  ]);
  const currentIndex = playback.channel
    ? zapChannels.findIndex((channel) => (
      liveTvFavoriteKey(channel) === liveTvFavoriteKey(playback.channel!)
    ))
    : -1;
  const zapNext = useCallback(() => {
    if (currentIndex < 0 || zapChannels.length < 2) return;
    void controller.next(zapChannels, providers);
  }, [controller, currentIndex, providers, zapChannels]);
  const zapPrevious = useCallback(() => {
    if (currentIndex < 0 || zapChannels.length < 2) return;
    void controller.previous(zapChannels, providers);
  }, [controller, currentIndex, providers, zapChannels]);
  useNativeTvChannelKeys({
    enabled: (
      mode === 'tv'
      && tvPlayerOpen
      && !tvChannelListOpen
      && !sourceChooserOpen
      && !providerChooserOpen
      && currentIndex >= 0
      && zapChannels.length > 1
    ),
    onNext: zapNext,
    onPrevious: zapPrevious,
  });
  const guideChannel = guideChannelId
    ? channels.find((channel) => channel.id === guideChannelId) ?? null
    : null;

  const selectChannel = useCallback((channel: LiveTvBrowserChannel) => {
    setSourceChooserOpen(false);
    setProviderChooserOpen(false);
    setPhoneChannelListOpen(false);
    setTvChannelListOpen(false);
    setZapChannelIds((current) => {
      const selectedKeys = favoriteKeys(channel);
      if (
        current.length
        && current.some((key) => selectedKeys.includes(key))
      ) {
        return current;
      }
      return visibleChannels.map((candidate) => liveTvFavoriteKey(candidate));
    });
    if (mode === 'phone') {
      setPhonePlayerOpen(true);
      setPhoneChannelListOpen(false);
    } else {
      setTvPlayerOpen(true);
      setTvChannelListOpen(false);
    }
    void controller.selectLogicalChannel(channel);
  }, [controller, favoriteKeys, mode, visibleChannels]);

  const openGuide = useCallback((channelId: string) => {
    setPhoneChannelListOpen(false);
    setTvChannelListOpen(false);
    setSourceChooserOpen(false);
    setProviderChooserOpen(false);
    setPhonePlayerOpen(false);
    setTvPlayerOpen(false);
    setZapChannelIds([]);
    controller.close();
    setGuideChannelId(channelId);
  }, [controller]);

  const closePhonePlayer = useCallback(() => {
    setPhoneChannelListOpen(false);
    setSourceChooserOpen(false);
    setProviderChooserOpen(false);
    setPhonePlayerOpen(false);
    setZapChannelIds([]);
    controller.close();
  }, [controller]);

  const handlePhoneRequestClose = useCallback(() => {
    if (providerChooserOpen) {
      setProviderChooserOpen(false);
      return;
    }
    if (sourceChooserOpen) {
      setSourceChooserOpen(false);
      return;
    }
    if (phoneChannelListOpen) {
      setPhoneChannelListOpen(false);
      return;
    }
    closePhonePlayer();
  }, [
    closePhonePlayer,
    phoneChannelListOpen,
    providerChooserOpen,
    sourceChooserOpen,
  ]);

  const closeTvPlayer = useCallback(() => {
    setTvChannelListOpen(false);
    setSourceChooserOpen(false);
    setProviderChooserOpen(false);
    setTvPlayerOpen(false);
    setZapChannelIds([]);
    controller.close();
  }, [controller]);

  const openProvidersFromPlayer = useCallback(() => {
    if (mode === 'tv') {
      closeTvPlayer();
    } else {
      closePhonePlayer();
    }
    onOpenProviders();
  }, [
    closePhonePlayer,
    closeTvPlayer,
    mode,
    onOpenProviders,
  ]);

  const handleWebTvBack = useCallback(() => {
    if (guideChannelId) {
      setGuideChannelId(null);
      return true;
    }
    if (mode !== 'tv' || !tvPlayerOpen) return false;
    if (providerChooserOpen) {
      setProviderChooserOpen(false);
      return true;
    }
    if (sourceChooserOpen) {
      setSourceChooserOpen(false);
      return true;
    }
    if (tvChannelListOpen) {
      setTvChannelListOpen(false);
      return true;
    }
    closeTvPlayer();
    return true;
  }, [
    closeTvPlayer,
    guideChannelId,
    mode,
    providerChooserOpen,
    sourceChooserOpen,
    tvChannelListOpen,
    tvPlayerOpen,
  ]);

  const webTvPlayerOpen = (
    Platform.OS === 'web'
    && mode === 'tv'
    && tvPlayerOpen
  );
  useWebTvModalFocusRestore(webTvPlayerOpen);
  useWebTvModalFocusRestore(
    webTvPlayerOpen && tvChannelListOpen,
  );
  useWebTvBackHandler(
    Platform.OS === 'web'
      && mode === 'tv'
      && (Boolean(guideChannelId) || tvPlayerOpen),
    handleWebTvBack,
  );

  useEffect(() => {
    if (
      !webTvPlayerOpen
      || tvChannelListOpen
      || sourceChooserOpen
      || providerChooserOpen
      || typeof document === 'undefined'
    ) return undefined;

    const handleChannelRemoteKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) return;

      const action = webTvChannelAction(event);
      if (!action) return;

      if (action === 'list') {
        event.preventDefault();
        event.stopPropagation();
        setTvChannelListOpen(true);
        return;
      }

      if (currentIndex < 0 || zapChannels.length < 2) return;
      event.preventDefault();
      event.stopPropagation();

      if (action === 'next') {
        zapNext();
      } else {
        zapPrevious();
      }
    };

    document.addEventListener('keydown', handleChannelRemoteKey);
    return () => {
      document.removeEventListener('keydown', handleChannelRemoteKey);
    };
  }, [
    currentIndex,
    providerChooserOpen,
    sourceChooserOpen,
    tvChannelListOpen,
    webTvPlayerOpen,
    zapChannels.length,
    zapNext,
    zapPrevious,
  ]);

  useEffect(() => {
    if (mode !== 'tv' || !tvPlayerOpen) return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (providerChooserOpen) {
        setProviderChooserOpen(false);
        return true;
      }
      if (sourceChooserOpen) {
        setSourceChooserOpen(false);
        return true;
      }
      if (tvChannelListOpen) {
        setTvChannelListOpen(false);
        return true;
      }
      closeTvPlayer();
      return true;
    });
    return () => subscription.remove();
  }, [
    closeTvPlayer,
    mode,
    providerChooserOpen,
    sourceChooserOpen,
    tvChannelListOpen,
    tvPlayerOpen,
  ]);

  useEffect(() => {
    if (!guideChannelId) return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setGuideChannelId(null);
      return true;
    });
    return () => subscription.remove();
  }, [guideChannelId]);

  if (guideChannel) {
    return (
      <LiveTvGuideTimelineScreen
        channel={guideChannel}
        guideState={guideState}
        controller={guideController}
        nowMs={guideNowMs}
        onBack={() => setGuideChannelId(null)}
        onPlay={() => {
          setGuideChannelId(null);
          selectChannel(guideChannel);
        }}
      />
    );
  }

  if (!providers.length) {
    return (
      <View testID="live-tv-screen" style={styles.centerState}>
        <Text style={styles.stateTitle}>{t('liveTv.noProvider')}</Text>
        <FocusButton
          label={t('common.provider')}
          testID="open-live-tv-providers"
          onPress={onOpenProviders}
        />
      </View>
    );
  }

  const providerChooser = (
    providerChooserOpen && channelProviders.length > 1
      ? (
        <LiveTvProviderChooser
          providers={channelProviders.map((provider) => ({
            id: provider.addonId.trim(),
            name: provider.name,
          }))}
          preferredProviderId={preferredProviderId}
          activeProviderId={activeProviderId}
          onSelect={(providerId) => {
            setProviderChooserOpen(false);
            void controller.setPreferredProvider(providerId);
          }}
          onClose={() => setProviderChooserOpen(false)}
        />
      )
      : null
  );

  const playerBody = (
    <>
      {playback.status === 'resolving' ? (
        <View style={styles.playerState}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.stateBody}>{t('playback.findingSources')}</Text>
        </View>
      ) : playback.status === 'error' ? (
        <View style={styles.playerState}>
          <Text style={styles.stateTitle}>{t('liveTv.channelUnavailable')}</Text>
          <FocusButton
            label={t('liveTv.retry')}
            testID="live-tv-player-retry"
            onPress={() => { void controller.retry(); }}
          />
          <FocusButton
            label={t('common.provider')}
            testID="live-tv-player-providers"
            onPress={openProvidersFromPlayer}
          />
        </View>
      ) : playback.status === 'ready' && selectedSource ? (
        <LiveTvPlayer
          key={playbackSourceFingerprint(selectedSource)}
          source={selectedSource}
          preferredAudioLanguages={
            preferences.preferredAudioLanguages
          }
          onPress={
            mode === 'phone'
              ? () => setPhoneChannelListOpen(true)
              : tvPlayerOpen
                ? () => setTvChannelListOpen(true)
                : undefined
          }
          onPlaybackError={() => controller.sourceFailed(selectedSource.id, selectedSource)}
        />
      ) : (
        <View style={styles.playerState}>
          <Text style={styles.stateBody}>{t('liveTv.selectChannel')}</Text>
        </View>
      )}
    </>
  );

  const countryFilters = (
    <ScrollView
      horizontal
      contentContainerStyle={styles.filters}
      showsHorizontalScrollIndicator={false}
    >
      <FocusButton
        label={`★ ${t('liveTv.favorites')}`}
        testID="live-tv-favorites-filter"
        selected={favoritesOnly}
        onPress={() => {
          setFavoritesOnly((value) => {
            const next = !value;
            if (next) setCountryCode(null);
            return next;
          });
        }}
      />
      <FocusButton
        label={t('liveTv.allCountries')}
        testID="live-tv-country-all"
        selected={!favoritesOnly && countryCode === null}
        onPress={() => {
          setFavoritesOnly(false);
          setCountryCode(null);
        }}
      />
      {countries.map((country) => (
        <FocusButton
          key={country}
          label={liveTvCountryLabel(country, locale)}
          testID={`live-tv-country-${country}`}
          selected={!favoritesOnly && countryCode === country}
          onPress={() => {
            setFavoritesOnly(false);
            setCountryCode(country);
          }}
        />
      ))}
    </ScrollView>
  );

  const channelRows = renderedChannels.map((channel) => {
    const nowNext = guideController.nowNext(
      guideState,
      channel.id,
      guideNowMs,
    );
    const guideRows = guideCardRows(nowNext, locale);
    const hasGuide = guideState.matches.has(channel.id);

    return (
      <ChannelRow
        key={channel.id}
        channel={channel}
        countryLabel={
          channel.countryCode
            ? liveTvCountryLabel(channel.countryCode, locale)
            : undefined
        }
        favorite={isFavorite(channel)}
        guideRows={guideRows}
        selected={Boolean(playback.channel && liveTvFavoriteKey(playback.channel) === liveTvFavoriteKey(channel))}
        preferredFocus={
          mode === 'tv'
          && tvChannelListOpen
          && Boolean(playback.channel && liveTvFavoriteKey(playback.channel) === liveTvFavoriteKey(channel))
        }
        onToggleFavorite={() => toggleFavorite(channel)}
        onOpenGuide={
          hasGuide ? () => openGuide(channel.id) : undefined
        }
        onPress={() => selectChannel(channel)}
      />
    );
  });

  const tvPlayerPanel = (
    <View style={styles.playerPanel}>
      {playerBody}
      {playback.channel ? (
        <View style={styles.zapBar}>
          <FocusButton
            label={t('liveTv.previousChannel')}
            testID="live-tv-previous"
            disabled={currentIndex < 0 || zapChannels.length < 2}
            onPress={zapPrevious}
          />
          <FocusButton
            label={t('liveTv.nextChannel')}
            testID="live-tv-next"
            disabled={currentIndex < 0 || zapChannels.length < 2}
            onPress={zapNext}
          />
        </View>
      ) : null}
    </View>
  );

  const listPanel = (
    <View
      style={[
        styles.listPanel,
        mode === 'tv'
          ? {
              paddingTop: safeInsetEdge(
                theme.spacing.lg,
                safeAreaInsets.top,
                12,
              ),
              paddingLeft: safeInsetEdge(
                theme.spacing.lg,
                safeAreaInsets.left,
                12,
              ),
              paddingBottom: safeInsetEdge(
                theme.spacing.lg,
                safeAreaInsets.bottom,
                12,
              ),
            }
          : undefined,
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('nav.liveTv')}</Text>
        <FocusButton
          label={t('liveTv.refresh')}
          testID="live-tv-refresh"
          onPress={() => {
            void refreshAll();
          }}
        />
      </View>

      <TextInput
        testID="live-tv-search"
        value={query}
        onChangeText={setQuery}
        placeholder={t('liveTv.searchChannels')}
        placeholderTextColor={theme.colors.muted}
        style={styles.search}
      />

      {countryFilters}

      {loadState.status === 'loading' && !loadState.result ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.stateBody}>{t('liveTv.loadingChannels')}</Text>
        </View>
      ) : null}

      {loadState.result && loadState.result.failedProviderIds.length > 0 ? (
        <Text style={styles.warning}>
          {t(
            loadState.result.failedProviderIds.length === loadState.result.providerCount
              ? 'liveTv.allProvidersFailed'
              : 'liveTv.partialFailure',
          )}
        </Text>
      ) : null}

      {loadState.result && loadState.result.truncatedProviderIds?.length ? (
        <Text testID="live-tv-truncated-warning" style={styles.warning}>
          {t('liveTv.playlistTruncated')}
        </Text>
      ) : null}

      {guideState.status === 'stale' || guideState.status === 'unavailable' ? (
        <Text testID="live-tv-guide-warning" style={styles.guideWarning}>
          {t(
            guideState.status === 'stale'
              ? 'liveTv.guideStale'
              : 'liveTv.guideUnavailable',
          )}
        </Text>
      ) : null}

      {loadState.status === 'ready' && visibleChannels.length === 0 ? (
        <Text style={styles.stateBody}>{t('liveTv.noChannels')}</Text>
      ) : null}

      {mode === 'tv' ? (
        <ScrollView
          testID="live-tv-tv-channel-list-scroll"
          style={styles.tvChannelListScroll}
          contentContainerStyle={styles.channelList}
        >
          {channelRows}
          {canRenderMoreChannels ? (
            <FocusButton
              label={t('search.loadMore')}
              onPress={renderMoreChannels}
            />
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.channelList}>
          {channelRows}
          {canRenderMoreChannels ? (
            <FocusButton
              label={t('search.loadMore')}
              onPress={renderMoreChannels}
            />
          ) : null}
        </View>
      )}
    </View>
  );

  const currentFavorite = playback.channel
    ? isFavorite(playback.channel)
    : false;

  if (mode === 'tv') {
    if (tvPlayerOpen) {
      return (
        <View
          aria-modal={true}
          testID="live-tv-tv-player-modal"
          style={styles.modalRoot}
        >
          <View style={styles.modalPlayer}>
            {playerBody}
          </View>

          <View
            style={[
              styles.tvBoxWrap,
              {
                paddingTop: safeInsetEdge(theme.spacing.lg, safeAreaInsets.top, 8),
                paddingLeft: safeInsetEdge(theme.spacing.md, safeAreaInsets.left, 8),
              },
            ]}
          >
            <View style={styles.tvBoxRow}>
              <FocusButton
                label={t('common.back')}
                testID="live-tv-tv-player-back"
                onPress={closeTvPlayer}
              />
              <FocusButton
                label={`☰ ${t('liveTv.channels')}`}
                testID="live-tv-tv-player-channels"
                onPress={() => {
                  setSourceChooserOpen(false);
                  setProviderChooserOpen(false);
                  setTvChannelListOpen((value) => !value);
                }}
              />
            </View>

            {/* The channel box: number, name, now/next and the remote hints,
                so a viewer never has to open a menu to know what is on. */}
            <View testID="live-tv-tv-channel-box" style={styles.tvChannelBox}>
              <View style={styles.tvChannelNumber}>
                <Text
                  testID="live-tv-tv-channel-number"
                  style={styles.tvChannelNumberText}
                >
                  {currentIndex >= 0 ? currentIndex + 1 : '–'}
                </Text>
              </View>
              <View style={styles.tvChannelCopy}>
                <Text numberOfLines={1} style={styles.tvChannelTitle}>
                  {playback.channel?.title ?? t('nav.liveTv')}
                </Text>
                {playback.channel?.countryCode ? (
                  <Text style={styles.tvChannelMeta}>
                    {liveTvCountryLabel(playback.channel.countryCode, locale)}
                  </Text>
                ) : null}
                {playback.channel ? (
                  <Text
                    numberOfLines={2}
                    style={styles.tvNowNext}
                    testID="live-tv-tv-now-next"
                  >
                    {guideCardRows(
                      guideController.nowNext(guideState, playback.channel.id, guideNowMs),
                      locale,
                    )
                      .map((row) => `${row.kind} ${row.time} · ${row.title}`)
                      .join('   ')}
                  </Text>
                ) : null}
                <Text style={styles.tvRemoteHint}>{t('liveTv.tvRemoteHint')}</Text>
              </View>
              {playback.channel ? (
                <FavoriteButton
                  favorite={currentFavorite}
                  testID="live-tv-tv-player-favorite"
                  onPress={() => toggleFavorite(playback.channel!)}
                />
              ) : null}
            </View>
          </View>

          <View
            style={[
              styles.modalControls,
              {
                paddingLeft: safeInsetEdge(
                  theme.spacing.md,
                  safeAreaInsets.left,
                  8,
                ),
                paddingRight: safeInsetEdge(
                  theme.spacing.md,
                  safeAreaInsets.right,
                  8,
                ),
                paddingBottom: safeInsetEdge(
                  theme.spacing.xl,
                  safeAreaInsets.bottom,
                  8,
                ),
              },
            ]}
          >
            <FocusButton
              label={t('liveTv.previousChannel')}
              testID="live-tv-previous"
              disabled={currentIndex < 0 || zapChannels.length < 2}
              onPress={zapPrevious}
            />
            <FocusButton
              label={t('liveTv.nextChannel')}
              testID="live-tv-next"
              disabled={currentIndex < 0 || zapChannels.length < 2}
              onPress={zapNext}
            />
            {playback.sources.length > 1 ? (
              <FocusButton
                label={t('playback.changeSource')}
                testID="live-tv-change-source"
                onPress={() => {
                  setPhoneChannelListOpen(false);
                  setTvChannelListOpen(false);
                  setProviderChooserOpen(false);
                  setSourceChooserOpen(true);
                }}
              />
            ) : null}
            {channelProviders.length > 1 ? (
              <FocusButton
                label={providerButtonLabel}
                testID="live-tv-change-provider"
                onPress={() => {
                  setPhoneChannelListOpen(false);
                  setTvChannelListOpen(false);
                  setSourceChooserOpen(false);
                  setProviderChooserOpen(true);
                }}
              />
            ) : null}
          </View>

          {tvChannelListOpen ? (
            <View
              aria-modal={true}
              testID="live-tv-tv-player-channel-drawer"
              style={[
                styles.tvChannelDrawer,
                {
                  top: safeInsetEdge(88, safeAreaInsets.top, 72),
                  left: safeInsetEdge(42, safeAreaInsets.left, 24),
                  bottom: safeInsetEdge(88, safeAreaInsets.bottom, 72),
                },
              ]}
            >
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>{t('liveTv.channels')}</Text>
                <FocusButton
                  label="✕"
                  testID="live-tv-tv-player-channel-drawer-close"
                  onPress={() => setTvChannelListOpen(false)}
                />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('liveTv.searchChannels')}
                placeholderTextColor={theme.colors.muted}
                style={styles.search}
              />
              {countryFilters}
              <ScrollView style={styles.drawerList} contentContainerStyle={styles.drawerListContent}>
                {channelRows}
                {canRenderMoreChannels ? (
                  <FocusButton
                    label={t('search.loadMore')}
                    onPress={renderMoreChannels}
                  />
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          {sourceChooserOpen && playback.status === 'ready' ? (
            <SourceChooser
              sources={playback.sources}
              selectedSourceId={playback.selectedSourceId}
              onSelect={(sourceId) => {
                controller.selectSource(sourceId);
                setSourceChooserOpen(false);
              }}
              onClose={() => setSourceChooserOpen(false)}
            />
          ) : null}
          {providerChooser}
        </View>
      );
    }

    return (
      <View testID="live-tv-screen" style={styles.tvLayout}>
        {listPanel}
        {tvPlayerPanel}
      </View>
    );
  }

  return (
    <View testID="live-tv-screen" style={styles.phoneRoot}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.phoneContent,
          {
            paddingTop: safeInsetEdge(
              theme.spacing.lg,
              safeAreaInsets.top,
              12,
            ),
            paddingRight: safeInsetEdge(
              theme.spacing.lg,
              safeAreaInsets.right,
              12,
            ),
            paddingBottom: safeInsetEdge(
              96,
              safeAreaInsets.bottom,
              80,
            ),
            paddingLeft: safeInsetEdge(
              theme.spacing.lg,
              safeAreaInsets.left,
              12,
            ),
          },
        ]}
      >
        {listPanel}
      </ScrollView>

      <Modal
        visible={phonePlayerOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handlePhoneRequestClose}
      >
        <View testID="live-tv-phone-player-modal" style={styles.modalRoot}>
          <View
            style={[
              styles.modalHeader,
              {
                paddingTop: safeInsetEdge(
                  theme.spacing.xl,
                  safeAreaInsets.top,
                  8,
                ),
                paddingLeft: safeInsetEdge(
                  theme.spacing.md,
                  safeAreaInsets.left,
                  8,
                ),
                paddingRight: safeInsetEdge(
                  theme.spacing.md,
                  safeAreaInsets.right,
                  8,
                ),
              },
            ]}
          >
            <FocusButton
              label={t('common.back')}
              testID="live-tv-player-back"
              onPress={closePhonePlayer}
            />
            <View style={styles.modalChannelCopy}>
              <Text numberOfLines={1} style={styles.modalChannelTitle}>
                {playback.channel?.title ?? t('nav.liveTv')}
              </Text>
              {playback.channel?.countryCode ? (
                <Text style={styles.modalChannelMeta}>
                  {liveTvCountryLabel(playback.channel.countryCode, locale)}
                </Text>
              ) : null}
            </View>
            {playback.channel ? (
              <FavoriteButton
                favorite={currentFavorite}
                testID="live-tv-player-favorite"
                onPress={() => toggleFavorite(playback.channel!)}
              />
            ) : null}
            <FocusButton
              label={`☰ ${t('liveTv.channels')}`}
              testID="live-tv-player-channels"
              onPress={() => {
                setSourceChooserOpen(false);
                setProviderChooserOpen(false);
                setPhoneChannelListOpen((value) => !value);
              }}
            />
          </View>

          <View style={styles.modalPlayer}>
            {playerBody}
          </View>

          <View
            style={[
              styles.modalControls,
              {
                paddingLeft: safeInsetEdge(
                  theme.spacing.md,
                  safeAreaInsets.left,
                  8,
                ),
                paddingRight: safeInsetEdge(
                  theme.spacing.md,
                  safeAreaInsets.right,
                  8,
                ),
                paddingBottom: safeInsetEdge(
                  theme.spacing.xl,
                  safeAreaInsets.bottom,
                  8,
                ),
              },
            ]}
          >
            <FocusButton
              label={t('liveTv.previousChannel')}
              testID="live-tv-previous"
              disabled={currentIndex < 0 || zapChannels.length < 2}
              onPress={zapPrevious}
            />
            <FocusButton
              label={t('liveTv.nextChannel')}
              testID="live-tv-next"
              disabled={currentIndex < 0 || zapChannels.length < 2}
              onPress={zapNext}
            />
            {playback.sources.length > 1 ? (
              <FocusButton
                label={t('playback.changeSource')}
                testID="live-tv-change-source"
                onPress={() => {
                  setPhoneChannelListOpen(false);
                  setTvChannelListOpen(false);
                  setProviderChooserOpen(false);
                  setSourceChooserOpen(true);
                }}
              />
            ) : null}
            {channelProviders.length > 1 ? (
              <FocusButton
                label={providerButtonLabel}
                testID="live-tv-change-provider"
                onPress={() => {
                  setPhoneChannelListOpen(false);
                  setTvChannelListOpen(false);
                  setSourceChooserOpen(false);
                  setProviderChooserOpen(true);
                }}
              />
            ) : null}
          </View>

          {phoneChannelListOpen ? (
            <View
              testID="live-tv-player-channel-drawer"
              style={[
                styles.channelDrawer,
                {
                  top: safeInsetEdge(96, safeAreaInsets.top, 80),
                  right: safeInsetEdge(12, safeAreaInsets.right, 8),
                  bottom: safeInsetEdge(96, safeAreaInsets.bottom, 80),
                  left: safeInsetEdge(12, safeAreaInsets.left, 8),
                },
              ]}
            >
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>{t('liveTv.channels')}</Text>
                <FocusButton
                  label="✕"
                  testID="live-tv-player-channel-drawer-close"
                  onPress={() => setPhoneChannelListOpen(false)}
                />
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('liveTv.searchChannels')}
                placeholderTextColor={theme.colors.muted}
                style={styles.search}
              />
              {countryFilters}
              <ScrollView style={styles.drawerList} contentContainerStyle={styles.drawerListContent}>
                {channelRows}
                {canRenderMoreChannels ? (
                  <FocusButton
                    label={t('search.loadMore')}
                    onPress={renderMoreChannels}
                  />
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          {sourceChooserOpen && playback.status === 'ready' ? (
            <SourceChooser
              sources={playback.sources}
              selectedSourceId={playback.selectedSourceId}
              onSelect={(sourceId) => {
                controller.selectSource(sourceId);
                setSourceChooserOpen(false);
              }}
              onClose={() => setSourceChooserOpen(false)}
            />
          ) : null}
          {providerChooser}
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  phoneRoot: { flex: 1, backgroundColor: theme.colors.background },
  phoneContent: { padding: theme.spacing.lg, paddingBottom: 96 },
  tvLayout: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.background },
  listPanel: { flex: 1, minWidth: 300, gap: theme.spacing.md },
  playerPanel: {
    flex: 1.5,
    minHeight: 280,
    backgroundColor: '#000000',
    position: 'relative',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  title: { color: theme.colors.text, fontSize: 30, fontWeight: '900' },
  search: {
    minHeight: 48,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
  },
  filters: { gap: theme.spacing.sm, paddingRight: theme.spacing.lg },
  tvChannelListScroll: { flex: 1 },
  channelList: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
  },
  channelRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
  },
  channelSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceElevated,
  },
  channelFocused: {
    borderColor: theme.colors.focus,
    backgroundColor: theme.colors.surfaceElevated,
  },
  logoShell: {
    width: 72,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
  },
  logo: { width: '90%', height: '90%' },
  logoFallback: { color: theme.colors.accentSoft, fontWeight: '900' },
  channelCopy: { flex: 1, marginLeft: theme.spacing.md },
  channelTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  channelMeta: { color: theme.colors.muted, marginTop: 3, fontSize: 11, fontWeight: '700' },
  guideRow: {
    color: theme.colors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  guideKind: {
    color: theme.colors.accentSoft,
    fontSize: 9,
    fontWeight: '900',
  },
  guideButton: {
    minWidth: 46,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  guideButtonText: {
    color: theme.colors.text,
    fontSize: 10,
    fontWeight: '900',
  },
  favoriteButton: {
    minWidth: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: theme.colors.surfaceElevated,
  },
  favoriteButtonActive: { borderColor: theme.colors.accent },
  favoriteIcon: { color: theme.colors.muted, fontSize: 21, fontWeight: '900' },
  favoriteIconActive: { color: theme.colors.accentSoft },
  button: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceElevated,
  },
  buttonText: { color: theme.colors.text, fontSize: 12, fontWeight: '800' },
  focused: { borderColor: theme.colors.focus },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.xl,
  },
  playerState: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  stateTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateBody: { color: theme.colors.muted, fontSize: 14, textAlign: 'center' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  warning: { color: theme.colors.accentSoft, fontSize: 12, fontWeight: '700' },
  guideWarning: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  zapBar: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },
  modalHeader: {
    position: 'absolute',
    zIndex: 30,
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
    backgroundColor: 'rgba(5,5,7,0.72)',
  },
  tvBoxWrap: {
    position: 'absolute',
    zIndex: 30,
    top: 0,
    left: 0,
    right: 0,
    gap: 10,
    alignItems: 'flex-start',
  },
  tvBoxRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tvChannelBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    maxWidth: 620,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(8,8,12,0.78)',
  },
  tvChannelNumber: {
    minWidth: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 8,
  },
  tvChannelNumberText: {
    color: theme.colors.onAccent,
    fontFamily: fontFamily.displayBold,
    fontSize: 24,
  },
  tvChannelCopy: { flexShrink: 1, gap: 2 },
  tvChannelTitle: {
    color: '#ffffff',
    fontFamily: fontFamily.displayBold,
    fontSize: 20,
  },
  tvChannelMeta: { color: 'rgba(255,255,255,0.6)', fontFamily: fontFamily.ui, fontSize: 12 },
  tvNowNext: { color: 'rgba(255,255,255,0.82)', fontFamily: fontFamily.ui, fontSize: 13 },
  tvRemoteHint: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: fontFamily.ui,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  modalChannelCopy: { flex: 1 },
  modalChannelTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  modalNowNext: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    marginTop: 2,
  },
  modalChannelMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  modalPlayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  modalControls: {
    position: 'absolute',
    zIndex: 30,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    backgroundColor: 'rgba(5,5,7,0.72)',
  },
  tvChannelDrawer: {
    position: 'absolute',
    zIndex: 40,
    top: 88,
    left: 42,
    bottom: 88,
    width: '46%',
    minWidth: 420,
    maxWidth: 720,
    gap: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(12,12,15,0.97)',
    padding: theme.spacing.md,
  },
  channelDrawer: {
    position: 'absolute',
    zIndex: 40,
    top: 96,
    right: 12,
    bottom: 96,
    left: 12,
    gap: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(9,9,11,0.98)',
    padding: theme.spacing.md,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  drawerTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '900' },
  drawerList: { flex: 1 },
  drawerListContent: { gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
});
