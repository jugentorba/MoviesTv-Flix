import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fontFamily, type Theme } from '@moviestv/ui';
import {
  type BufferMode,
  nextBufferMode,
  readBufferMode,
  writeBufferMode,
} from '../playback/bufferMode';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ProvidersScreen } from '../addons/ProvidersScreen';
import { AboutScreen } from './AboutScreen';
import { StorageSettingsScreen } from './StorageSettingsScreen';
import { AppearanceSettingsScreen } from './AppearanceSettingsScreen';
import { HomeSettingsScreen } from './HomeSettingsScreen';
import {
  DEFAULT_PLAYER_PREFERENCES,
  loadPlayerPreferences,
  nextUpNextSeconds,
  playerPreferencesSnapshot,
  setPlayerPreferences,
  subscribePlayerPreferences,
  type PlayerPreferences,
} from '../playback/playerPreferences';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useWebTvLayoutOverride } from '../app/platform';
import { AccountScreen } from '../auth/AccountScreen';
import { DownloadsScreen } from '../downloads/DownloadsScreen';
import { LiveTvGuideSettingsScreen } from '../live-tv/LiveTvGuideSettingsScreen';
import { LiveTvPlaylistSettingsScreen } from '../live-tv/LiveTvPlaylistSettingsScreen';
import { LibraryScreen } from './LibraryScreen';
import { PwaInstallScreen } from './PwaInstallScreen';
import { PreviewDiagnosticsScreen } from './PreviewDiagnosticsScreen';
import { AppUpdateScreen } from './AppUpdateScreen';
import { AppLanguageScreen } from '../languages/AppLanguageScreen';
import { OrderedLanguageScreen } from '../languages/OrderedLanguageScreen';
import { useI18n } from '../i18n/useI18n';
import { usePreferences } from '../preferences/usePreferences';
import { ProfilesScreen } from '../profiles/ProfilesScreen';
import { useWebTvBackHandler } from '../web/tvRemoteNavigation';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

export type SettingsPage =
  | 'root'
  | 'account'
  | 'profiles'
  | 'library'
  | 'downloads'
  | 'install-app'
  | 'preview-diagnostics'
  | 'app-updates'
  | 'about'
  | 'storage'
  | 'appearance'
  | 'home-layout'
  | 'app-language'
  | 'audio-languages'
  | 'subtitle-languages'
  | 'catalog-providers'
  | 'stream-providers'
  | 'live-tv-providers'
  | 'live-tv-playlists'
  | 'live-tv-guide';

export function settingsBackTarget(page: SettingsPage): SettingsPage {
  return page === 'downloads'
    ? 'library'
    : page === 'root'
      ? 'root'
      : 'root';
}

export function settingsHistoryBackTarget(
  page: SettingsPage,
  history: readonly SettingsPage[],
): { page: SettingsPage; history: SettingsPage[] } {
  if (page === 'root') return { page: 'root', history: [...history] };
  const nextHistory = [...history];
  const previous = nextHistory.pop() ?? settingsBackTarget(page);
  return { page: previous, history: nextHistory };
}

function SettingsEntry({
  icon,
  label,
  detail,
  testID,
  direction,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  testID: string;
  direction: 'ltr' | 'rtl';
  onPress(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.entry,
        { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' },
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconShell}>
        <Ionicons name={icon} size={19} color={theme.colors.accentSoft} />
      </View>
      <View style={styles.entryCopy}>
        <Text style={[styles.entryLabel, { writingDirection: direction }]}>{label}</Text>
        {detail ? <Text style={[styles.entryDetail, { writingDirection: direction }]}>{detail}</Text> : null}
      </View>
      <Text style={styles.chevron}>{direction === 'rtl' ? '‹' : '›'}</Text>
    </Pressable>
  );
}


function SettingsToggle({
  icon,
  label,
  detail,
  value,
  testID,
  direction,
  onChange,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  value: boolean;
  testID: string;
  direction: 'ltr' | 'rtl';
  onChange(value: boolean): void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      testID={testID}
      onPress={() => onChange(!value)}
      style={({ focused, pressed }) => [
        styles.entry,
        { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' },
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconShell}>
        <Ionicons name={icon} size={19} color={theme.colors.accentSoft} />
      </View>
      <View style={styles.entryCopy}>
        <Text style={[styles.entryLabel, { writingDirection: direction }]}>{label}</Text>
        {detail ? <Text style={[styles.entryDetail, { writingDirection: direction }]}>{detail}</Text> : null}
      </View>
      <View style={[styles.switchTrack, value && styles.switchTrackOn]}>
        <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
      </View>
    </Pressable>
  );
}

function sectionLabels(t: (key: string) => string) {
  return {
    app: t('settingsScreen.app'),
    install: t('settingsScreen.install'),
    installDetail: t('settingsScreen.installDetail'),
    previewDiagnostics: t('settingsScreen.previewDiagnostics'),
    previewDiagnosticsDetail: t('settingsScreen.previewDiagnosticsDetail'),
    updates: t('settingsScreen.updates'),
    updatesDetail: t('settingsScreen.updatesDetail'),
    tvLayout: t('settingsScreen.tvLayout'),
    tvLayoutDetail: t('settingsScreen.tvLayoutDetail'),
    account: t('settingsScreen.account'),
    playback: t('settingsScreen.playback'),
    providers: t('settingsScreen.providers'),
    accountLabel: t('settingsScreen.accountLabel'),
    sync: t('settingsScreen.sync'),
    profiles: t('settingsScreen.profiles'),
    profilesDetail: t('settingsScreen.profilesDetail'),
    library: t('settingsScreen.library'),
    libraryDetail: t('settingsScreen.libraryDetail'),
    downloads: t('settingsScreen.downloads'),
    downloadsDetail: t('settingsScreen.downloadsDetail'),
    appLanguageDetail: t('settingsScreen.appLanguageDetail'),
    audioDetail: t('settingsScreen.audioDetail'),
    subtitleDetail: t('settingsScreen.subtitleDetail'),
    autoplay: t('settingsScreen.autoplay'),
    autoplayDetail: t('settingsScreen.autoplayDetail'),
    catalogs: t('settingsScreen.catalogs'),
    catalogsDetail: t('settingsScreen.catalogsDetail'),
    movieProviders: t('settingsScreen.movieProviders'),
    tvProviders: t('settingsScreen.tvProviders'),
    tvGuide: t('settingsScreen.tvGuide'),
    tvGuideDetail: t('settingsScreen.tvGuideDetail'),
    playlists: t('settingsScreen.playlists'),
    playlistsDetail: t('settingsScreen.playlistsDetail'),
  };
}

function SectionTitle({ children }: { children: string }) {
  const styles = useThemeStyles(createStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function SettingsScreen({
  initialPage = 'root',
}: {
  initialPage?: SettingsPage;
}) {
  const styles = useThemeStyles(createStyles);
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const pageHistoryRef = useRef<SettingsPage[]>(
    initialPage === 'root' ? [] : ['root'],
  );
  const { t, direction } = useI18n();
  const copy = sectionLabels(t);
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const previewMode = process.env.EXPO_PUBLIC_PREVIEW_MODE === '1';
  const [bufferMode, setBufferMode] = useState<BufferMode>('balanced');
  const [playerPrefs, setPlayerPrefs] =
    useState<PlayerPreferences>(DEFAULT_PLAYER_PREFERENCES);

  useEffect(() => {
    let active = true;
    void loadPlayerPreferences().then((value) => {
      if (active) setPlayerPrefs(value);
    });
    const unsubscribe = subscribePlayerPreferences(() => {
      setPlayerPrefs(playerPreferencesSnapshot());
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void readBufferMode().then((mode) => { if (active) setBufferMode(mode); });
    return () => { active = false; };
  }, []);
  const [forceWebTvLayout, setForceWebTvLayout] = useWebTvLayoutOverride();
  const {
    preferences,
    setAppLocale,
    setPreferredAudioLanguages,
    setPreferredSubtitleLanguages,
    setSubtitlesEnabled,
    setAutoplay,
  } = usePreferences();

  useEffect(() => {
    pageHistoryRef.current = initialPage === 'root' ? [] : ['root'];
    setPage(initialPage);
  }, [initialPage]);

  const navigateToPage = useCallback((nextPage: SettingsPage) => {
    setPage((current) => {
      if (current === nextPage) return current;
      pageHistoryRef.current = [
        ...pageHistoryRef.current,
        current,
      ].slice(-24);
      return nextPage;
    });
  }, []);

  const handleSettingsBack = useCallback(() => {
    if (page === 'root') return false;
    const target = settingsHistoryBackTarget(page, pageHistoryRef.current);
    pageHistoryRef.current = target.history;
    setPage(target.page);
    return true;
  }, [page]);

  useWebTvBackHandler(
    Platform.OS === 'web' && page !== 'root',
    handleSettingsBack,
  );

  useEffect(() => {
    if (
      page === 'root'
      || (Platform.OS !== 'android' && !Platform.isTV)
    ) return undefined;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleSettingsBack,
    );
    return () => subscription.remove();
  }, [handleSettingsBack, page]);

  if (page === 'account') return <AccountScreen onBack={() => { handleSettingsBack(); }} />;
  if (page === 'profiles') return <ProfilesScreen onBack={() => { handleSettingsBack(); }} />;
  if (page === 'library' || page === 'downloads') {
    return (
      <View style={styles.subpageStack}>
        <View
          style={[
            styles.subpageStack,
            page === 'downloads' ? styles.hiddenSubpage : null,
          ]}
        >
          <LibraryScreen
            onBack={() => { handleSettingsBack(); }}
            onOpenDownloads={() => navigateToPage('downloads')}
          />
        </View>
        {page === 'downloads' ? (
          <View style={styles.subpageStack}>
            <DownloadsScreen onBack={() => { handleSettingsBack(); }} />
          </View>
        ) : null}
      </View>
    );
  }
  if (page === 'install-app') {
    return <PwaInstallScreen onBack={() => { handleSettingsBack(); }} />;
  }
  if (page === 'preview-diagnostics') {
    return <PreviewDiagnosticsScreen onBack={() => { handleSettingsBack(); }} />;
  }
  if (page === 'app-updates') {
    return <AppUpdateScreen onBack={() => { handleSettingsBack(); }} />;
  }
  if (page === 'about') {
    return <AboutScreen onBack={() => { handleSettingsBack(); }} />;
  }
  if (page === 'storage') {
    return <StorageSettingsScreen onBack={() => { handleSettingsBack(); }} />;
  }
  if (page === 'appearance') {
    return <AppearanceSettingsScreen onBack={() => { handleSettingsBack(); }} />;
  }
  if (page === 'home-layout') {
    return <HomeSettingsScreen onBack={() => { handleSettingsBack(); }} />;
  }

  if (page === 'app-language') {
    return (
      <AppLanguageScreen
        selected={preferences.appLocale}
        onSelect={(value) => { void setAppLocale(value).catch(() => undefined); }}
        onBack={() => { handleSettingsBack(); }}
      />
    );
  }

  if (page === 'audio-languages') {
    return (
      <OrderedLanguageScreen
        kind="audio"
        selected={preferences.preferredAudioLanguages}
        onChange={(value) => { void setPreferredAudioLanguages(value).catch(() => undefined); }}
        onBack={() => { handleSettingsBack(); }}
      />
    );
  }

  if (page === 'subtitle-languages') {
    return (
      <OrderedLanguageScreen
        kind="subtitle"
        selected={preferences.preferredSubtitleLanguages}
        onChange={(value) => { void setPreferredSubtitleLanguages(value).catch(() => undefined); }}
        onBack={() => { handleSettingsBack(); }}
        subtitlesEnabled={preferences.subtitlesEnabled}
        onSubtitlesEnabledChange={(value) => { void setSubtitlesEnabled(value).catch(() => undefined); }}
      />
    );
  }

  if (page === 'catalog-providers') {
    return <ProvidersScreen kind="catalog" onBack={() => { handleSettingsBack(); }} />;
  }

  if (page === 'stream-providers') {
    return <ProvidersScreen kind="stream" onBack={() => { handleSettingsBack(); }} />;
  }

  if (page === 'live-tv-providers') {
    return <ProvidersScreen kind="live-tv" onBack={() => { handleSettingsBack(); }} />;
  }

  if (page === 'live-tv-playlists') {
    return <LiveTvPlaylistSettingsScreen onBack={() => { handleSettingsBack(); }} />;
  }

  if (page === 'live-tv-guide') {
    return <LiveTvGuideSettingsScreen onBack={() => { handleSettingsBack(); }} />;
  }

  return (
    <ScrollView
      testID="settings-screen"
      style={[styles.screen, { direction }]}
      contentContainerStyle={[
        styles.content,
        {
          direction,
          paddingTop: safeInsetEdge(34, safeAreaInsets.top, 12),
          paddingBottom: safeInsetEdge(110, safeAreaInsets.bottom, 88),
          paddingLeft: safeAreaInsets.left > 0
            ? safeInsetEdge(20, safeAreaInsets.left, 12)
            : '5%',
          paddingRight: safeAreaInsets.right > 0
            ? safeInsetEdge(20, safeAreaInsets.right, 12)
            : '5%',
        },
      ]}
    >
      <Text style={[styles.title, { writingDirection: direction }]}>{t('settings.title')}</Text>
      <Text style={[styles.subtitle, { writingDirection: direction }]}>MoviesTv-Flix</Text>

      <View style={styles.section}>
        <SectionTitle>{copy.account}</SectionTitle>
        <View style={styles.entries}>
          <SettingsEntry
            icon="person-circle-outline"
            label={copy.accountLabel}
            detail={copy.sync}
            testID="settings-account"
            direction={direction}
            onPress={() => navigateToPage('account')}
          />
          <SettingsEntry
            icon="people-outline"
            label={copy.profiles}
            detail={copy.profilesDetail}
            testID="settings-profiles"
            direction={direction}
            onPress={() => navigateToPage('profiles')}
          />
          <SettingsEntry
            icon="star-outline"
            label={copy.library}
            detail={copy.libraryDetail}
            testID="settings-library"
            direction={direction}
            onPress={() => navigateToPage('library')}
          />
          <SettingsEntry
            icon="download-outline"
            label={copy.downloads}
            detail={copy.downloadsDetail}
            testID="settings-downloads"
            direction={direction}
            onPress={() => navigateToPage('downloads')}
          />
        </View>
      </View>

      <View style={styles.section}>
          <SectionTitle>{copy.app}</SectionTitle>
          <View style={styles.entries}>
            <SettingsEntry
              icon="refresh-outline"
              label={copy.updates}
              detail={copy.updatesDetail}
              testID="settings-app-updates"
              direction={direction}
              onPress={() => navigateToPage('app-updates')}
            />
            <SettingsEntry
              icon="color-palette-outline"
              label={t('settingsScreen.appearance')}
              detail={t('settingsScreen.appearanceDetail')}
              testID="settings-appearance"
              direction={direction}
              onPress={() => navigateToPage('appearance')}
            />
            <SettingsEntry
              icon="grid-outline"
              label={t('settingsScreen.homeLayout')}
              detail={t('settingsScreen.homeLayoutDetail')}
              testID="settings-home-layout"
              direction={direction}
              onPress={() => navigateToPage('home-layout')}
            />
            <SettingsEntry
              icon="server-outline"
              label={t('settingsScreen.storage')}
              detail={t('settingsScreen.storageDetail')}
              testID="settings-storage"
              direction={direction}
              onPress={() => navigateToPage('storage')}
            />
            <SettingsEntry
              icon="information-circle-outline"
              label={t('settingsScreen.about')}
              detail={t('settingsScreen.aboutDetail')}
              testID="settings-about"
              direction={direction}
              onPress={() => navigateToPage('about')}
            />
            {Platform.OS === 'web' ? (
              <SettingsToggle
                icon="tv-outline"
                label={copy.tvLayout}
                detail={copy.tvLayoutDetail}
                value={forceWebTvLayout}
                testID="settings-web-tv-layout"
                direction={direction}
                onChange={setForceWebTvLayout}
              />
            ) : null}
            {Platform.OS === 'web' ? (
              <SettingsEntry
                icon="cloud-download-outline"
                label={copy.install}
                detail={copy.installDetail}
                testID="settings-install-app"
                direction={direction}
                onPress={() => navigateToPage('install-app')}
              />
            ) : null}
            {previewMode ? (
              <SettingsEntry
                icon="pulse-outline"
                label={copy.previewDiagnostics}
                detail={copy.previewDiagnosticsDetail}
                testID="settings-preview-diagnostics"
                direction={direction}
                onPress={() => navigateToPage('preview-diagnostics')}
              />
            ) : null}
          </View>
        </View>

      <View style={styles.section}>
        <SectionTitle>{copy.playback}</SectionTitle>
        <View style={styles.entries}>
          <SettingsEntry
            icon="language-outline"
            label={t('settings.appLanguage')}
            detail={copy.appLanguageDetail}
            testID="settings-app-language"
            direction={direction}
            onPress={() => navigateToPage('app-language')}
          />
          <SettingsEntry
            icon="volume-medium-outline"
            label={t('settings.audioLanguages')}
            detail={copy.audioDetail}
            testID="settings-audio-languages"
            direction={direction}
            onPress={() => navigateToPage('audio-languages')}
          />
          <SettingsEntry
            icon="text-outline"
            label={t('settings.subtitleLanguages')}
            detail={copy.subtitleDetail}
            testID="settings-subtitle-languages"
            direction={direction}
            onPress={() => navigateToPage('subtitle-languages')}
          />
          <SettingsToggle
            icon="play-circle-outline"
            label={copy.autoplay}
            detail={copy.autoplayDetail}
            value={preferences.autoplay}
            testID="settings-autoplay"
            direction={direction}
            onChange={(value) => { void setAutoplay(value).catch(() => undefined); }}
          />
          <SettingsToggle
            icon="play-forward-outline"
            label={t('settingsScreen.skipIntro')}
            detail={t('settingsScreen.skipIntroDetail')}
            value={playerPrefs.skipIntroEnabled}
            testID="settings-skip-intro"
            direction={direction}
            onChange={(value) => setPlayerPreferences({ ...playerPrefs, skipIntroEnabled: value })}
          />
          <SettingsEntry
            icon="timer-outline"
            label={t('settingsScreen.upNextCountdown')}
            detail={`${playerPrefs.upNextSeconds}s`}
            testID="settings-up-next-countdown"
            direction={direction}
            onPress={() => setPlayerPreferences({
              ...playerPrefs,
              upNextSeconds: nextUpNextSeconds(playerPrefs.upNextSeconds),
            })}
          />
          <SettingsEntry
            icon="speedometer-outline"
            label={t('settings.streamingBuffer')}
            detail={t(`settings.bufferMode.${bufferMode}`)}
            testID="settings-buffer-mode"
            direction={direction}
            onPress={() => {
              const next = nextBufferMode(bufferMode);
              setBufferMode(next);
              void writeBufferMode(next);
            }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>{copy.providers}</SectionTitle>
        <View style={styles.entries}>
          <SettingsEntry
            icon="grid-outline"
            label={copy.catalogs}
            detail={copy.catalogsDetail}
            testID="settings-catalog-providers"
            direction={direction}
            onPress={() => navigateToPage('catalog-providers')}
          />
          <SettingsEntry
            icon="play-circle-outline"
            label={`${t('nav.movies')} / ${t('nav.series')}`}
            detail={copy.movieProviders}
            testID="settings-stream-providers"
            direction={direction}
            onPress={() => navigateToPage('stream-providers')}
          />
          <SettingsEntry
            icon="tv-outline"
            label={t('nav.liveTv')}
            detail={copy.tvProviders}
            testID="settings-live-tv-providers"
            direction={direction}
            onPress={() => navigateToPage('live-tv-providers')}
          />
          <SettingsEntry
            icon="list-outline"
            label={copy.playlists}
            detail={copy.playlistsDetail}
            testID="settings-live-tv-playlists"
            direction={direction}
            onPress={() => navigateToPage('live-tv-playlists')}
          />
          <SettingsEntry
            icon="calendar-outline"
            label={copy.tvGuide}
            detail={copy.tvGuideDetail}
            testID="settings-live-tv-guide"
            direction={direction}
            onPress={() => navigateToPage('live-tv-guide')}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  subpageStack: { flex: 1 },
  hiddenSubpage: { display: 'none' },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingHorizontal: '5%',
    paddingTop: 34,
    paddingBottom: 110,
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 4,
    marginBottom: 30,
  },
  section: { marginBottom: 28 },
  sectionTitle: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingHorizontal: 3,
  },
  entries: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  entry: {
    minHeight: 76,
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  iconShell: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: theme.colors.surfaceElevated,
  },
  icon: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  entryCopy: { flex: 1, paddingVertical: 12 },
  focused: { backgroundColor: theme.colors.surfaceElevated },
  pressed: { opacity: 0.75 },
  entryLabel: { color: theme.colors.text, fontFamily: fontFamily.uiMedium, fontSize: 16 },
  entryDetail: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  chevron: { color: theme.colors.subtle, fontSize: 22 },
  switchTrack: {
    width: 46,
    height: 28,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 3,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  switchTrackOn: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: theme.colors.muted,
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#ffffff',
  },
});
