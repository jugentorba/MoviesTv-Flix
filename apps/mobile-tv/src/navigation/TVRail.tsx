import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CatalogScreen } from '../catalog/CatalogScreen';
import { MediaDetailsScreen } from '../catalog/MediaDetailsScreen';
import { SearchScreen } from '../catalog/SearchScreen';
import { fontFamily, type Theme } from '@moviestv/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LiveTvScreen } from '../live-tv/LiveTvScreen';
import { SettingsScreen, type SettingsPage } from '../screens/SettingsScreen';
import { useI18n } from '../i18n/useI18n';
import type { SettingsNavigationRequest } from './AppNavigator';
import { useWebTvBackHandler } from '../web/tvRemoteNavigation';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

const routes = ['Home', 'Movies', 'Series', 'Live TV', 'Search', 'Settings'] as const;
type Route = (typeof routes)[number];

const routeKey: Record<Route, string> = {
  Home: 'nav.home',
  Movies: 'nav.movies',
  Series: 'nav.series',
  'Live TV': 'nav.liveTv',
  Search: 'nav.search',
  Settings: 'nav.settings',
};

/**
 * Real icons, matching the phone tab bar. The rail previously drew characters
 * in the system font, which rendered inconsistently on Android TV.
 */
const routeIcons: Record<Route, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Movies: { active: 'film', inactive: 'film-outline' },
  Series: { active: 'tv', inactive: 'tv-outline' },
  'Live TV': { active: 'radio', inactive: 'radio-outline' },
  Search: { active: 'search', inactive: 'search-outline' },
  Settings: { active: 'settings-sharp', inactive: 'settings-outline' },
};

export function TVRail({
  variant = 'tv',
  settingsRequest,
  onSettingsRequestHandled,
}: {
  variant?: 'tv' | 'wide';
  settingsRequest?: SettingsNavigationRequest | null;
  onSettingsRequestHandled?(id: number): void;
} = {}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { t, direction } = useI18n();
  const isTv = variant === 'tv';
  const [selected, setSelected] = useState<Route>('Home');
  const [focused, setFocused] = useState<Route>('Home');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [settingsInitialPage, setSettingsInitialPage] = useState<SettingsPage>('root');
  const handledRequestRef = useRef<number | null>(null);

  const closeMediaDetails = useCallback(() => {
    if (!mediaId) return false;
    setMediaId(null);
    return true;
  }, [mediaId]);

  useWebTvBackHandler(
    Platform.OS === 'web' && isTv && Boolean(mediaId),
    closeMediaDetails,
  );

  useEffect(() => {
    if (!settingsRequest || handledRequestRef.current === settingsRequest.id) return;
    handledRequestRef.current = settingsRequest.id;
    setSettingsInitialPage(settingsRequest.page);
    setSelected('Settings');
    setMediaId(null);
    onSettingsRequestHandled?.(settingsRequest.id);
  }, [onSettingsRequestHandled, settingsRequest]);

  useEffect(() => {
    if (!isTv || !mediaId) return undefined;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setMediaId(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [isTv, mediaId]);

  const selectRoute = (route: Route, settingsPage: SettingsPage = 'root') => {
    if (route === 'Settings') setSettingsInitialPage(settingsPage);
    setSelected(route);
    setMediaId(null);
  };

  let routeContent: React.ReactNode;
  if (selected === 'Home') {
    routeContent = (
      <CatalogScreen
        route="home"
        onSelectMedia={setMediaId}
        onOpenAccount={() => selectRoute('Settings', 'account')}
        onOpenProfiles={() => selectRoute('Settings', 'profiles')}
        onOpenLibrary={() => selectRoute('Settings', 'library')}
        onOpenProviders={() => selectRoute('Settings', 'catalog-providers')}
      />
    );
  } else if (selected === 'Movies') {
    routeContent = (
      <CatalogScreen
        route="movies"
        onSelectMedia={setMediaId}
        onOpenProviders={() => selectRoute('Settings', 'catalog-providers')}
      />
    );
  } else if (selected === 'Series') {
    routeContent = (
      <CatalogScreen
        route="series"
        onSelectMedia={setMediaId}
        onOpenProviders={() => selectRoute('Settings', 'catalog-providers')}
      />
    );
  } else if (selected === 'Live TV') {
    routeContent = (
      <LiveTvScreen
        mode={isTv ? 'tv' : 'phone'}
        onOpenProviders={() => selectRoute('Settings', 'live-tv-providers')}
      />
    );
  } else if (selected === 'Search') {
    routeContent = (
      <SearchScreen
        onSelectMedia={setMediaId}
        onOpenProviders={() => selectRoute('Settings', 'catalog-providers')}
      />
    );
  } else {
    routeContent = <SettingsScreen initialPage={settingsInitialPage} />;
  }

  const content = (
    <>
      <View style={[styles.routeContent, mediaId && styles.hiddenRouteContent]}>
        {routeContent}
      </View>
      {mediaId ? (
        <View style={styles.routeContent}>
          <MediaDetailsScreen
            mediaId={mediaId}
            onBack={() => setMediaId(null)}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.layout, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
      <View testID={isTv ? 'tv-nav-rail' : 'wide-nav-rail'} style={styles.rail}>
        <Text style={styles.brand}>M</Text>
        <View style={styles.routeList}>
          {routes.map((route) => {
            const active = selected === route;
            const hasFocus = focused === route;
            return (
              <Pressable
                key={route}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`tv-nav-${route.toLowerCase().replace(/\s+/g, '-')}`}
                hasTVPreferredFocus={isTv && focused === route}
                onFocus={() => setFocused(route)}
                onPress={() => selectRoute(route)}
                style={[
                  styles.item,
                  active && styles.selected,
                  hasFocus && styles.focused,
                ]}
              >
                <View style={styles.glyph}>
                  <Ionicons
                    name={active ? routeIcons[route].active : routeIcons[route].inactive}
                    size={20}
                    color={active ? theme.colors.accentSoft : theme.colors.muted}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    active && styles.labelSelected,
                    { writingDirection: direction },
                  ]}
                >
                  {t(routeKey[route])}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.content}>{content}</View>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  layout: { flex: 1, backgroundColor: theme.colors.background },
  rail: {
    width: 184,
    backgroundColor: 'rgba(12,12,15,0.98)',
    paddingHorizontal: 14,
    paddingVertical: 22,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  brand: {
    color: theme.colors.accentSoft,
    fontFamily: fontFamily.displayBold,
    fontSize: 30,
    lineHeight: 36,
    paddingHorizontal: 12,
    marginBottom: 28,
  },
  routeList: { gap: 8 },
  item: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selected: { backgroundColor: theme.colors.surfaceElevated },
  focused: {
    borderColor: theme.colors.focus,
    backgroundColor: theme.colors.surfaceElevated,
    transform: [{ scale: 1.025 }],
  },
  glyph: { width: 24, alignItems: 'center', justifyContent: 'center' },
  label: {
    flex: 1,
    color: theme.colors.muted,
    fontFamily: fontFamily.uiMedium,
    fontSize: 15,
  },
  labelSelected: { color: theme.colors.text },
  content: { flex: 1 },
  routeContent: { flex: 1 },
  hiddenRouteContent: { display: 'none' },
});
