import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { usePlayback } from '../playback/usePlayback';
import { useImmersiveSurfaceActive } from '../playback/immersiveSurface';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useContext } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { CatalogScreen } from '../catalog/CatalogScreen';
import { MediaDetailsScreen } from '../catalog/MediaDetailsScreen';
import { SearchScreen } from '../catalog/SearchScreen';
import { LiveTvScreen } from '../live-tv/LiveTvScreen';
import { SettingsScreen, type SettingsPage } from '../screens/SettingsScreen';
import { useI18n } from '../i18n/useI18n';
import { fontFamily, theme } from '@moviestv/ui';
import type { SettingsNavigationRequest } from './AppNavigator';

type CatalogRoute = 'home' | 'movies' | 'series';
type PhoneTabParamList = {
  Home: undefined;
  Movies: undefined;
  Series: undefined;
  'Live TV': undefined;
  Search: undefined;
  Settings: { initialPage?: SettingsPage; requestId?: number } | undefined;
};

const Tab = createBottomTabNavigator<PhoneTabParamList>();

/**
 * Real icons instead of text glyphs. The previous implementation drew the tab
 * icons as characters (`⌂`, `●`, `▤`...) in the system font, which is why they
 * read as thin and inconsistent across platforms.
 */
const tabIcons: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Movies: { active: 'film', inactive: 'film-outline' },
  Series: { active: 'tv', inactive: 'tv-outline' },
  'Live TV': { active: 'radio', inactive: 'radio-outline' },
  Search: { active: 'search', inactive: 'search-outline' },
  Settings: { active: 'settings-sharp', inactive: 'settings-outline' },
};

function TabIcon(
  { routeName, color, focused }: { routeName: string; color: string; focused: boolean },
) {
  const icons = tabIcons[routeName] ?? tabIcons.Home;
  return (
    <Ionicons
      accessibilityElementsHidden
      name={focused ? icons.active : icons.inactive}
      size={focused ? 23 : 22}
      color={color}
    />
  );
}


function useAndroidDetailsBack(
  mediaId: string | null,
  closeDetails: () => void,
) {
  useEffect(() => {
    if (Platform.OS !== 'android' || !mediaId) return undefined;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        closeDetails();
        return true;
      },
    );
    return () => subscription.remove();
  }, [closeDetails, mediaId]);
}

function CatalogTab({
  route,
  onOpenAccount,
  onOpenProfiles,
  onOpenLibrary,
  onOpenProviders,
}: {
  route: CatalogRoute;
  onOpenAccount?(): void;
  onOpenProfiles?(): void;
  onOpenLibrary?(): void;
  onOpenProviders?(): void;
}) {
  const [mediaId, setMediaId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setMediaId(null), []);
  useAndroidDetailsBack(mediaId, closeDetails);
  return (
    <View style={{ flex: 1 }}>
      <View style={mediaId ? { display: 'none' } : { flex: 1 }}>
        <CatalogScreen
          route={route}
          onSelectMedia={setMediaId}
          onOpenAccount={onOpenAccount}
          onOpenProfiles={onOpenProfiles}
          onOpenLibrary={onOpenLibrary}
          onOpenProviders={onOpenProviders}
        />
      </View>
      {mediaId ? (
        <View style={{ flex: 1 }}>
          <MediaDetailsScreen
            mediaId={mediaId}
            onBack={closeDetails}
          />
        </View>
      ) : null}
    </View>
  );
}

function SearchTab({
  onOpenProviders,
}: {
  onOpenProviders?(): void;
}) {
  const [mediaId, setMediaId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setMediaId(null), []);
  useAndroidDetailsBack(mediaId, closeDetails);
  return (
    <View style={{ flex: 1 }}>
      <View style={mediaId ? { display: 'none' } : { flex: 1 }}>
        <SearchScreen
          onSelectMedia={setMediaId}
          onOpenProviders={onOpenProviders}
        />
      </View>
      {mediaId ? (
        <View style={{ flex: 1 }}>
          <MediaDetailsScreen
            mediaId={mediaId}
            onBack={closeDetails}
          />
        </View>
      ) : null}
    </View>
  );
}

export function PhoneTabs({
  settingsRequest,
  onSettingsRequestHandled,
  openAccountFirst = false,
}: {
  settingsRequest?: SettingsNavigationRequest | null;
  onSettingsRequestHandled?(id: number): void;
  /** First launch: land on the account screen so the user can choose a mode. */
  openAccountFirst?: boolean;
} = {}) {
  const { t } = useI18n();
  // While a film is playing the player owns the screen: the tab bar is drawn by
  // the navigator above the screen tree, so it used to sit on top of the player.
  const playback = usePlayback();
  // The offline player is a route of its own, so it announces itself instead of
  // going through `selectedSource`.
  const immersive = useImmersiveSurfaceActive();
  // The bar floats, so its 8 pt margin has to clear the home indicator too.
  const safeAreaInsets = useContext(SafeAreaInsetsContext);
  const bottomMargin = Math.max(8, (safeAreaInsets?.bottom ?? 0) + 4);
  const playerActive = Boolean(playback.selectedSource) || immersive;
  const navigationRef = useNavigationContainerRef<PhoneTabParamList>();
  const handledRequestRef = useRef<number | null>(null);

  const handlePendingSettingsRequest = useCallback(() => {
    if (!settingsRequest || !navigationRef.isReady()) return;
    if (handledRequestRef.current === settingsRequest.id) return;

    handledRequestRef.current = settingsRequest.id;
    navigationRef.navigate('Settings', {
      initialPage: settingsRequest.page,
      requestId: settingsRequest.id,
    });
    onSettingsRequestHandled?.(settingsRequest.id);
  }, [navigationRef, onSettingsRequestHandled, settingsRequest]);

  useEffect(() => {
    handlePendingSettingsRequest();
  }, [handlePendingSettingsRequest]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={handlePendingSettingsRequest}
    >
      <Tab.Navigator
        backBehavior="history"
        initialRouteName={openAccountFirst ? 'Settings' : 'Home'}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.colors.accentSoft,
          tabBarInactiveTintColor: theme.colors.subtle,
          tabBarActiveBackgroundColor: 'rgba(108,75,239,0.16)',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon routeName={route.name} color={color} focused={focused} />
          ),
          tabBarLabelStyle: {
            fontFamily: fontFamily.uiSemiBold,
            fontSize: 10,
            letterSpacing: 0.2,
            marginTop: 1,
          },
          tabBarItemStyle: {
            marginVertical: 5,
            marginHorizontal: 1,
            paddingTop: 4,
            borderRadius: 12,
          },
          tabBarStyle: {
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: bottomMargin,
            minHeight: 72,
            display: playerActive ? 'none' : 'flex',
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            borderRadius: 20,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden',
          },
        })}
      >
        <Tab.Screen name="Home" options={{ tabBarLabel: t('nav.home') }}>
          {({ navigation }) => (
            <CatalogTab
              route="home"
              onOpenAccount={() => navigation.navigate('Settings', { initialPage: 'account' })}
              onOpenProfiles={() => navigation.navigate('Settings', { initialPage: 'profiles' })}
              onOpenLibrary={() => navigation.navigate('Settings', { initialPage: 'library' })}
              onOpenProviders={() => navigation.navigate('Settings', { initialPage: 'catalog-providers' })}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Movies" options={{ tabBarLabel: t('nav.movies') }}>
          {({ navigation }) => (
            <CatalogTab
              route="movies"
              onOpenProviders={() => navigation.navigate('Settings', { initialPage: 'catalog-providers' })}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Series" options={{ tabBarLabel: t('nav.series') }}>
          {({ navigation }) => (
            <CatalogTab
              route="series"
              onOpenProviders={() => navigation.navigate('Settings', { initialPage: 'catalog-providers' })}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Live TV" options={{ tabBarLabel: t('nav.liveTv') }}>{({ navigation }) => <LiveTvScreen mode="phone" onOpenProviders={() => navigation.navigate('Settings', { initialPage: 'live-tv-providers' })} />}</Tab.Screen>
        <Tab.Screen name="Search" options={{ tabBarLabel: t('nav.search') }}>
          {({ navigation }) => (
            <SearchTab
              onOpenProviders={() => navigation.navigate('Settings', { initialPage: 'catalog-providers' })}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Settings" options={{ tabBarLabel: t('nav.settings') }}>
          {({ route }) => {
            const params = route.params as { initialPage?: SettingsPage } | undefined;
            return (
              <SettingsScreen
                initialPage={params?.initialPage ?? (openAccountFirst ? 'account' : 'root')}
              />
            );
          }}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
