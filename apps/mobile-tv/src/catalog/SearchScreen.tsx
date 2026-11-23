import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  dedupeCatalogItems,
  normalizeSearchQuery,
  type CatalogMediaItem,
} from '@moviestv/catalog';
import { type Theme, fontFamily } from '@moviestv/ui';
import { clearRecentSearches, readRecentSearches, rememberSearch } from './recentSearches';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { MediaCard } from './MediaCard';
import { MediaQuickActions } from './MediaQuickActions';
import { isInMyList, myListTargetFromCatalog, toggleMyList } from './myListActions';
import { usePreferences } from '../preferences/usePreferences';
import { useCatalog } from './useCatalog';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

function usableSearchItems(
  items: readonly CatalogMediaItem[],
): CatalogMediaItem[] {
  return items
    .filter((item) => item.id?.trim() && item.title?.trim())
    .slice(0, 300);
}

function appendUniqueSearchItems(
  current: readonly CatalogMediaItem[],
  next: readonly CatalogMediaItem[],
): CatalogMediaItem[] {
  return dedupeCatalogItems([[
    ...current,
    ...next,
  ]]).slice(0, 300);
}

interface SearchScreenProps {
  onSelectMedia(mediaId: string): void;
  onOpenProviders?(): void;
}

export function SearchScreen({
  onSelectMedia,
  onOpenProviders,
}: SearchScreenProps) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { service } = useCatalog();
  const { t } = useI18n();
  const { preferences, setMyListItems } = usePreferences();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CatalogMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [quickItem, setQuickItem] = useState<CatalogMediaItem | null>(null);
  const selectResult = useCallback(
    (item: CatalogMediaItem) => onSelectMedia(item.id.trim()),
    [onSelectMedia],
  );
  const prefetchDetails = useCallback(
    (item: CatalogMediaItem) => {
      const mediaId = item.id?.trim();
      if (!mediaId) return;
      void service.getDetails(mediaId).catch(() => undefined);
    },
    [service],
  );
  const [kindFilter, setKindFilter] = useState<'all' | 'movie' | 'series'>('all');
  useEffect(() => {
    let active = true;
    void readRecentSearches().then((terms) => { if (active) setRecent(terms); });
    return () => { active = false; };
  }, []);

  const visibleItems = items.filter(
    (item) => kindFilter === 'all' || item.kind === kindFilter,
  );

  const searchGenerationRef = useRef(0);
  const loadMoreTokenRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    const generation = ++searchGenerationRef.current;
    loadMoreTokenRef.current += 1;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);
    setNextCursor(null);

    const normalized = normalizeSearchQuery(query)?.slice(0, 200) ?? '';
    if (!normalized) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      void service.search(normalized)
        .then((page) => {
          if (!active || generation !== searchGenerationRef.current) return;
          const nextItems = usableSearchItems(page.items);
          setItems(nextItems);
          setNextCursor(page.nextCursor?.trim() || null);
          if (nextItems.length > 0) {
            void rememberSearch(normalized).then(setRecent);
          }
        })
        .catch(() => {
          if (!active || generation !== searchGenerationRef.current) return;
          setItems([]);
          setNextCursor(null);
          setError(t('common.unavailable'));
        })
        .finally(() => {
          if (active && generation === searchGenerationRef.current) {
            setLoading(false);
          }
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, service, t]);

  const normalized = normalizeSearchQuery(query)?.slice(0, 200) ?? '';

  const loadMore = useCallback(() => {
    if (
      !normalized
      || !nextCursor
      || loadMoreInFlightRef.current
      || items.length >= 300
    ) return;

    const generation = searchGenerationRef.current;
    const token = ++loadMoreTokenRef.current;
    const cursor = nextCursor;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    setError(null);

    void service.search(normalized, cursor)
      .then((page) => {
        if (
          generation !== searchGenerationRef.current
          || token !== loadMoreTokenRef.current
        ) return;
        const nextItems = usableSearchItems(page.items);
        setItems((current) => appendUniqueSearchItems(
          current,
          nextItems,
        ));
        setNextCursor(page.nextCursor?.trim() || null);
      })
      .catch(() => {
        if (
          generation === searchGenerationRef.current
          && token === loadMoreTokenRef.current
        ) {
          setError(t('common.unavailable'));
        }
      })
      .finally(() => {
        if (token !== loadMoreTokenRef.current) return;
        loadMoreInFlightRef.current = false;
        setLoadingMore(false);
      });
  }, [items.length, nextCursor, normalized, service, t]);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        {
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
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('nav.search')}</Text>
        <Text style={styles.kicker}>MOVIESTV-FLIX</Text>
      </View>

      <View style={styles.searchShell}>
        <Ionicons name="search" size={22} color={theme.colors.muted} />
        <TextInput
          value={query}
          onChangeText={(value) => {
            loadMoreTokenRef.current += 1;
            loadMoreInFlightRef.current = false;
            setNextCursor(null);
            setLoadingMore(false);
            setQuery(value);
          }}
          placeholder={t('search.placeholder')}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={styles.input}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setQuery('')}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={16} color={theme.colors.text} />
          </Pressable>
        ) : null}
      </View>

      {!normalized ? (
        <View style={styles.emptyIntro}>
          <Ionicons name="search" size={54} color={theme.colors.border} />
          <Text style={styles.hint}>{t('search.minChars')}</Text>
          {recent.length > 0 ? (
            <View style={styles.recentBlock}>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>{t('search.recent')}</Text>
                <Pressable
                  accessibilityRole="button"
                  testID="search-clear-recent"
                  onPress={() => {
                    void clearRecentSearches();
                    setRecent([]);
                  }}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Text style={styles.recentClear}>{t('search.clearRecent')}</Text>
                </Pressable>
              </View>
              <View style={styles.recentRow}>
                {recent.map((term) => (
                  <Pressable
                    key={term}
                    accessibilityRole="button"
                    testID={`search-recent-${term}`}
                    onPress={() => setQuery(term)}
                    style={({ pressed }) => [styles.recentChip, pressed && styles.pressed]}
                  >
                    <Ionicons name="time-outline" size={13} color={theme.colors.muted} />
                    <Text style={styles.recentChipText} numberOfLines={1}>{term}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
          <Text style={styles.stateText}>{t('search.searching')}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>{t('common.unavailable')}</Text>
        </View>
      ) : null}

      {!loading && !error && normalized && items.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>{t('common.noResults')}</Text>
          <Text style={styles.stateText}>{t('search.tryDifferent')}</Text>
          {onOpenProviders ? (
            <Pressable
              accessibilityRole="button"
              focusable
              testID="search-open-providers"
              onPress={onOpenProviders}
              style={({ focused, pressed }) => [
                styles.providerButton,
                focused && styles.loadMoreFocused,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.providerButtonText}>
                {t('playback.manageProviders')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {items.length > 0 ? (
        <>
          <View style={styles.resultHeader}>
            <Text style={styles.resultTitle}>{t('search.results')}</Text>
            <View style={styles.countBadge}>
              <Text style={styles.resultCount}>{visibleItems.length}</Text>
            </View>
          </View>
          {items.some((item) => item.kind === 'movie') && items.some((item) => item.kind === 'series') ? (
            <View style={styles.filterRow}>
              {(['all', 'movie', 'series'] as const).map((value) => (
                <Pressable
                  key={value}
                  testID={`search-filter-${value}`}
                  accessibilityRole="button"
                  onPress={() => setKindFilter(value)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    kindFilter === value && styles.filterChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[
                    styles.filterChipText,
                    kindFilter === value && styles.filterChipTextActive,
                  ]}>
                    {value === 'all'
                      ? t('search.filterAll')
                      : value === 'movie'
                        ? t('search.filterMovies')
                        : t('search.filterSeries')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {visibleItems.length === 0 ? (
            <Text style={styles.hint}>{t('search.noMatchFilter')}</Text>
          ) : null}
          <View style={styles.grid}>
            {visibleItems.map((item, index) => (
              <MediaCard
                key={`${item.providerId ?? 'catalog'}:${item.id}:${index}`}
                item={item}
                onPress={selectResult}
                onLongPress={setQuickItem}
                onPressIn={prefetchDetails}
              />
            ))}
          </View>
          {nextCursor && items.length < 300 ? (
            <Pressable
              accessibilityRole="button"
              focusable={!loadingMore}
              disabled={loadingMore}
              testID="search-load-more"
              onPress={loadMore}
              style={({ focused, pressed }) => [
                styles.loadMoreButton,
                focused && styles.loadMoreFocused,
                pressed && !loadingMore && styles.pressed,
              ]}
            >
              {loadingMore ? (
                <ActivityIndicator color={theme.colors.accent} />
              ) : null}
              <Text style={styles.loadMoreText}>{t('search.loadMore')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <MediaQuickActions
        item={quickItem}
        inMyList={(() => {
          const target = quickItem ? myListTargetFromCatalog(quickItem) : null;
          return target ? isInMyList(preferences.myListItems, target) : false;
        })()}
        onToggleMyList={() => {
          if (!quickItem) return;
          const target = myListTargetFromCatalog(quickItem);
          if (target) {
            void setMyListItems(toggleMyList(preferences.myListItems, target));
          }
          setQuickItem(null);
        }}
        onOpenDetails={() => {
          const item = quickItem;
          setQuickItem(null);
          if (item?.id.trim()) onSelectMedia(item.id.trim());
        }}
        onClose={() => setQuickItem(null)}
      />
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    paddingHorizontal: '5%',
    paddingTop: 34,
    paddingBottom: 110,
    maxWidth: 1500,
    width: '100%',
    alignSelf: 'center',
  },
  header: { marginBottom: 22 },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  kicker: {
    color: theme.colors.muted,
    fontSize: 10,
    letterSpacing: 1.7,
    fontWeight: '900',
    marginTop: 4,
  },
  searchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    gap: 10,
  },
  searchIcon: { color: theme.colors.muted, fontSize: 23, fontWeight: '900' },
  input: {
    flex: 1,
    minHeight: 56,
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  clearButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceElevated,
  },
  clearText: { color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  emptyIntro: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyIcon: { color: theme.colors.border, fontSize: 54, fontWeight: '900' },
  recentBlock: { alignSelf: 'stretch', marginTop: 22, gap: 10 },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  recentTitle: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  recentClear: { color: theme.colors.accentSoft, fontFamily: fontFamily.uiMedium, fontSize: 12 },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '60%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  recentChipText: { color: theme.colors.text, fontFamily: fontFamily.ui, fontSize: 13 },
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  filterChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  filterChipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  filterChipText: { color: theme.colors.muted, fontFamily: fontFamily.uiMedium, fontSize: 12 },
  filterChipTextActive: { color: theme.colors.onAccent },
  hint: { color: theme.colors.muted, fontSize: 13, textAlign: 'center' },
  stateBox: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.xl,
  },
  stateTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '900' },
  stateText: { color: theme.colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  providerButton: {
    minHeight: 44,
    marginTop: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  providerButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 30,
    marginBottom: 14,
  },
  resultTitle: { color: theme.colors.text, fontSize: 21, fontWeight: '900' },
  countBadge: {
    minWidth: 27,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceElevated,
  },
  resultCount: { color: theme.colors.muted, fontSize: 10, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  loadMoreButton: {
    minHeight: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 24,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  loadMoreFocused: {
    borderColor: theme.colors.accent,
  },
  loadMoreText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  pressed: { opacity: 0.72 },
});
