import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  dedupeCatalogItems,
  type CatalogMediaItem,
  type CatalogSection,
} from '@moviestv/catalog';
import { MAX_MY_LIST_ITEMS, sameMyListMedia } from '@moviestv/core';
import { continueWatchingRecords } from '@moviestv/sync';
import { fontFamily, gradients, type Theme } from '@moviestv/ui';
import { avatarFor } from '../profiles/avatars';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAccount } from '../auth/useAccount';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useI18n } from '../i18n/useI18n';
import { useOptionalAddons } from '../addons/useAddons';
import { usePlayback } from '../playback/usePlayback';
import { usePreferences } from '../preferences/usePreferences';
import { ProfilesContext } from '../profiles/useProfiles';
import {
  filterCatalogSections,
  genreSectionsFor,
  getCatalogViewState,
  type CatalogDestination,
  type CatalogRow,
} from './catalog-view-model';
import { useWatchProgress } from '../watch-progress/useWatchProgress';
import {
  buildContinueWatching,
  progressByMediaId,
  watchedByMediaId,
} from '../watch-progress/continueWatching';
import { ContinueWatchingRow } from './ContinueWatchingRow';
import { MediaRow } from './MediaRow';
import { markStartup } from '../app/startupTiming';
import { readCatalogSnapshot, writeCatalogSnapshot } from './catalogSnapshot';
import {
  applyHomeLayout,
  EMPTY_HOME_LAYOUT,
  readHomeLayout,
  type HomeLayout,
} from './homeLayout';
import { MediaQuickActions } from './MediaQuickActions';
import { isInMyList, myListTargetFromCatalog, toggleMyList } from './myListActions';
import { useCatalog } from './useCatalog';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

const MAX_CATALOG_SECTION_CONCURRENCY = 6;

async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!items.length) return [];

  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(items[index]!, index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

const routeTitleKey: Record<CatalogDestination, string> = {
  home: 'nav.home',
  movies: 'nav.movies',
  series: 'nav.series',
};

interface CatalogScreenProps {
  route: CatalogDestination;
  onSelectMedia(mediaId: string): void;
  onOpenAccount?(): void;
  onOpenProfiles?(): void;
  onOpenLibrary?(): void;
  onOpenProviders?(): void;
}

export function CatalogScreen({
  route,
  onSelectMedia,
  onOpenAccount,
  onOpenProfiles,
  onOpenLibrary,
  onOpenProviders,
}: CatalogScreenProps) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { service } = useCatalog();
  // The first surface a user waits for is the catalog, not the splash.
  React.useEffect(() => { markStartup('catalog-mounted'); }, []);

  const playback = usePlayback();
  const { preferences, setMyListItems } = usePreferences();
  // Long-press quick actions; null means the sheet is closed.
  const [quickItem, setQuickItem] = useState<CatalogMediaItem | null>(null);
  const selectRowItem = useCallback(
    (item: CatalogMediaItem) => onSelectMedia(item.id.trim()),
    [onSelectMedia],
  );
  // The details screen fetches on mount; starting that on touch-down hides most
  // of the wait behind the finger. The service caches the result, so if the
  // press is abandoned nothing is wasted beyond one warm cache entry.
  const prefetchDetails = useCallback(
    (item: CatalogMediaItem) => {
      const mediaId = item.id?.trim();
      if (!mediaId) return;
      void service.getDetails(mediaId).catch(() => undefined);
    },
    [service],
  );
  const watchProgress = useWatchProgress();
  const account = useAccount();
  const profiles = useContext(ProfilesContext);
  const activeProfile = profiles?.activeProfile;
  // Same separation as every other store: guest and each profile own their rows.
  const snapshotScope = `${account.userId ?? 'guest'}:${activeProfile?.id ?? 'main'}`;
  const networkLoadedRef = React.useRef(false);
  // Row order and visibility chosen in Settings → Home screen.
  const [homeLayout, setHomeLayout] = React.useState<HomeLayout>(EMPTY_HOME_LAYOUT);
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [rows, setRows] = useState<CatalogRow[]>([]);
  // Genre chips for this tab, and the single row shown while one is selected.
  const [genreOptions, setGenreOptions] = useState<Array<{ section: CatalogSection; genre: string }>>([]);
  const [genreFilter, setGenreFilter] = useState<{ section: CatalogSection; genre: string } | null>(null);
  const [genreRow, setGenreRow] = useState<CatalogRow | null>(null);
  const [genreLoading, setGenreLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMoreRowIds, setLoadingMoreRowIds] = useState<string[]>([]);
  const rowLoadGenerationRef = useRef(0);
  const loadingMoreRowsRef = useRef(new Set<string>());
  const myListItemsRef = useRef(preferences.myListItems);

  useEffect(() => {
    myListItemsRef.current = preferences.myListItems;
  }, [preferences.myListItems]);

  React.useEffect(() => {
    let active = true;
    void readHomeLayout(snapshotScope).then((stored) => {
      if (active) setHomeLayout(stored);
    });
    return () => { active = false; };
  }, [snapshotScope]);

  // Built from local progress: providers do not know what this person was
  // watching, so the row is ours to synthesise.
  const continueEntries = React.useMemo(
    () => buildContinueWatching(watchProgress.records),
    [watchProgress.records],
  );
  const continueProgress = React.useMemo(
    () => progressByMediaId(continueEntries),
    [continueEntries],
  );
  const watched = React.useMemo(
    () => watchedByMediaId(watchProgress.records),
    [watchProgress.records],
  );

  // One list: the synthetic Continue Watching row plus whatever providers
  // returned. The home layout therefore applies to it too — it can be moved or
  // hidden like any other row.
  const selectGenre = useCallback((
    entry: { section: CatalogSection; genre: string } | null,
  ) => {
    setGenreFilter(entry);
    setGenreRow(null);
    if (!entry) return;
    setGenreLoading(true);
    void service.browse(entry.section.id)
      .then((page) => {
        setGenreRow({
          section: entry.section,
          items: page.items,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        });
      })
      .catch(() => setGenreRow(null))
      .finally(() => setGenreLoading(false));
  }, [service]);

  const combinedRows = React.useMemo<CatalogRow[]>(() => {
    const continueRow: CatalogRow[] = continueEntries.length > 0
      ? [{
        section: {
          id: 'continue-watching',
          title: t('continueWatching.title'),
          kinds: ['movie', 'series'],
        },
        items: continueEntries.map((entry) => entry.item),
      }]
      : [];
    return applyHomeLayout(homeLayout, [...continueRow, ...rows]);
  }, [continueEntries, homeLayout, rows, t]);

  // Paint the last rows first, then let the network replace them. The cache in
  // the service is memory-only, so a cold start would otherwise show a spinner.
  useEffect(() => {
    let active = true;
    networkLoadedRef.current = false;
    void readCatalogSnapshot(snapshotScope, route).then((snapshot) => {
      if (!active || !snapshot || networkLoadedRef.current) return;
      setRows(snapshot);
      setLoading(false);
    });
    return () => { active = false; };
  }, [route, snapshotScope]);

  useEffect(() => {
    let active = true;
    rowLoadGenerationRef.current += 1;
    loadingMoreRowsRef.current.clear();
    setLoadingMoreRowIds([]);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const allSections = await service.getSections();
        setGenreOptions(genreSectionsFor(route, allSections));
        const sections = filterCatalogSections(route, allSections);
        const partialRows = new Map<number, CatalogRow>();
        const settledRows = await mapSettledWithConcurrency(
          sections,
          MAX_CATALOG_SECTION_CONCURRENCY,
          async (section, index) => {
            const page = await service.browse(section.id);
            const row: CatalogRow = {
              section,
              items: page.items.slice(0, 200),
              ...(page.nextCursor && page.items.length < 200
                ? { nextCursor: page.nextCursor }
                : {}),
            };

            if (
              active
              && row.section.title?.trim()
              && row.items.length > 0
            ) {
              partialRows.set(index, row);
              setRows(
                [...partialRows.entries()]
                  .sort(([left], [right]) => left - right)
                  .map(([, value]) => value),
              );
            }
            return row;
          },
        );
        const loadedRows = settledRows
          .filter((result): result is PromiseFulfilledResult<CatalogRow> => result.status === 'fulfilled')
          .map((result) => result.value)
          .filter((row) => row.section.title?.trim() && row.items.length > 0);
        const firstFailure = settledRows.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );

        if (active) {
          networkLoadedRef.current = true;
          setRows(loadedRows);
          const hasContent = loadedRows.some((row) => row.items.length > 0);
          if (hasContent) {
            void writeCatalogSnapshot(snapshotScope, route, loadedRows);
          }
          if (!hasContent && firstFailure) {
            setError(t('common.unavailable'));
          }
        }
      } catch {
        if (active) setError(t('common.unavailable'));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      rowLoadGenerationRef.current += 1;
      loadingMoreRowsRef.current.clear();
    };
  }, [reloadKey, route, service, t]);

  const loadMoreRow = useCallback(async (sectionId: string) => {
    const row = rows.find((candidate) => candidate.section.id === sectionId);
    const cursor = row?.nextCursor?.trim();
    if (
      !row
      || !cursor
      || row.items.length >= 200
      || loadingMoreRowsRef.current.has(sectionId)
    ) return;

    const generation = rowLoadGenerationRef.current;
    loadingMoreRowsRef.current.add(sectionId);
    setLoadingMoreRowIds((current) => (
      current.includes(sectionId) ? current : [...current, sectionId]
    ));

    try {
      const page = await service.browse(sectionId, cursor);
      if (generation !== rowLoadGenerationRef.current) return;

      setRows((currentRows) => currentRows.map((currentRow) => {
        if (
          currentRow.section.id !== sectionId
          || currentRow.nextCursor?.trim() !== cursor
        ) return currentRow;

        const appended = page.items.filter(
          (item) => item.id?.trim() && item.title?.trim(),
        );
        const items = dedupeCatalogItems([[
          ...currentRow.items,
          ...appended,
        ]]).slice(0, 200);
        const nextCursor = page.nextCursor?.trim();
        const canContinue = Boolean(
          nextCursor
          && nextCursor !== cursor
          && items.length < 200,
        );

        return {
          ...currentRow,
          items,
          nextCursor: canContinue ? nextCursor : undefined,
        };
      }));
    } catch {
      // Keep the existing row usable. The user can retry loading the page.
    } finally {
      loadingMoreRowsRef.current.delete(sectionId);
      if (generation === rowLoadGenerationRef.current) {
        setLoadingMoreRowIds((current) => current.filter(
          (id) => id !== sectionId,
        ));
      }
    }
  }, [rows, service]);

  const state = getCatalogViewState({ loading, error, rows });
  const hero = useMemo(
    () => route === 'home' ? rows.flatMap((row) => row.items).find((item) => Boolean(item.id?.trim() && item.title?.trim() && item.backdropUrl)) ?? rows.flatMap((row) => row.items).find((item) => Boolean(item.id?.trim() && item.title?.trim())) : undefined,
    [route, rows],
  );
  const compact = width < 720;
  // A catalog can be installed but unusable: a provider synced from another
  // device keeps its identity, never its private link. Say that instead of
  // telling the user to add a catalog they already added.
  const localAddons = useOptionalAddons();
  const providersNeedingSetup = localAddons?.installed.filter(
    (record) => record.installed.setupIncomplete,
  ).length ?? 0;
  const emptyCatalogHint = providersNeedingSetup > 0
    ? t('catalog.needsSetupHint', { count: providersNeedingSetup })
    : t('catalog.emptyHint');
  const heroIdentity = hero
    ? {
        mediaId: hero.id,
        kind: hero.kind,
        externalIds: hero.externalIds,
      }
    : null;
  const heroInMyList = Boolean(
    heroIdentity
    && preferences.myListItems.some(
      (item) => sameMyListMedia(item, heroIdentity),
    ),
  );
  const toggleHeroMyList = () => {
    if (!hero || !heroIdentity) return;

    const currentItems = myListItemsRef.current;
    const currentlyInMyList = currentItems.some(
      (item) => sameMyListMedia(item, heroIdentity),
    );
    const nextItems = currentlyInMyList
      ? currentItems.filter(
          (item) => !sameMyListMedia(item, heroIdentity),
        )
      : [
          ...currentItems
            .filter((item) => !sameMyListMedia(item, heroIdentity))
            .slice(-(MAX_MY_LIST_ITEMS - 1)),
          {
            mediaId: hero.id.trim(),
            kind: hero.kind,
            title: hero.title.trim(),
            providerId: hero.providerId,
            externalIds: hero.externalIds,
            ...(hero.posterUrl ? { posterUrl: hero.posterUrl } : {}),
            ...(hero.backdropUrl ? { backdropUrl: hero.backdropUrl } : {}),
            ...(hero.year ? { year: hero.year } : {}),
          },
        ];

    myListItemsRef.current = nextItems;
    void setMyListItems(nextItems).catch(() => undefined);
  };
  const accountLabel = t(account.userId ? 'catalog.synced' : 'catalog.signIn');
  const continueWatching = useMemo(
    () => route === 'home'
      ? continueWatchingRecords(watchProgress.records)
        .filter((record) => (
          Boolean(record.mediaId?.trim() && record.title?.trim())
          && (record.kind === 'movie'
          || Boolean(
            (
              record.externalIds?.imdb
              || record.externalIds?.tmdb
              || record.seriesId?.trim()
            )
            && record.seasonNumber !== undefined
            && record.episodeNumber !== undefined,
          ))
        ))
        .slice(0, 20)
      : [],
    [route, watchProgress.records],
  );

  const myListItems = useMemo<CatalogMediaItem[]>(
    () => route === 'home'
      ? preferences.myListItems.filter((item) => item.mediaId?.trim() && item.title?.trim()).slice(0, MAX_MY_LIST_ITEMS).map((item) => ({
        id: item.mediaId,
        kind: item.kind,
        title: item.title,
        providerId: item.providerId,
        externalIds: item.externalIds,
        ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
        ...(item.backdropUrl ? { backdropUrl: item.backdropUrl } : {}),
        ...(item.year ? { year: item.year } : {}),
      }))
      : [],
    [preferences.myListItems, route],
  );
  const myListTitle = t('catalog.myList');

  const resumeRecord = async (record: (typeof continueWatching)[number]) => {
    if (!record.mediaId?.trim()) return;
    if (await playback.resumeProgress(record)) return;

    // Failed resume attempts leave the global playback overlay in a terminal
    // state. Close it before navigating to the catalog details fallback.
    playback.closePlayback();

    if (record.kind === 'movie') {
      onSelectMedia(record.mediaId);
      return;
    }
    const seriesId = record.seriesId?.trim();
    if (seriesId) onSelectMedia(seriesId);
  };

  // The header is absolutely positioned over the scroll view so artwork can run
  // underneath it. Content that is not artwork — the empty, error and loading
  // cards — must be pushed clear of it, otherwise the card starts under the
  // status bar and the header overlaps its text.
  const headerClearance = safeInsetEdge(14, safeAreaInsets.top, 8) + 62;
  // The home top bar is an absolute gradient, so the first block of content has
  // to make room for it. A hero does that with its own top padding; without a
  // hero (no catalog data yet, but Continue Watching or My List exists) the
  // first row would render behind the header.
  const homeContentGap = route === 'home' && !hero
    ? { marginTop: headerClearance }
    : undefined;
  const firstSubRowHasGap = continueWatching.length === 0;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        {
          paddingBottom: safeInsetEdge(110, safeAreaInsets.bottom, 88),
        },
      ]}
    >
      {route === 'home' ? (
        <LinearGradient
          pointerEvents="box-none"
          colors={gradients.scrimTop}
          style={[
            styles.homeTopBar,
            {
              paddingTop: safeInsetEdge(14, safeAreaInsets.top, 8),
              paddingLeft: safeAreaInsets.left > 0
                ? safeInsetEdge(16, safeAreaInsets.left, 8)
                : '4%',
              paddingRight: safeAreaInsets.right > 0
                ? safeInsetEdge(16, safeAreaInsets.right, 8)
                : '4%',
            },
          ]}
        >
          <Text numberOfLines={1} style={styles.homeBrand}>MOVIESTV-FLIX</Text>
          <View style={styles.homeTopActions}>
            {onOpenProfiles ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profiles"
                testID="home-profiles"
                onPress={onOpenProfiles}
                style={({ focused, pressed }) => [
                  styles.profileButton,
                  focused && styles.accountButtonFocused,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.profileAvatar}>
                  <Ionicons
                    name={avatarFor(activeProfile?.avatarId).icon}
                    size={16}
                    color="#0a0a0c"
                  />
                </View>
                {!compact ? (
                  <Text numberOfLines={1} style={styles.profileName}>
                    {activeProfile?.name?.trim() || 'Main'}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
            {onOpenLibrary && !compact ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Library"
                testID="home-library"
                onPress={onOpenLibrary}
                style={({ focused, pressed }) => [
                  styles.libraryButton,
                  focused && styles.accountButtonFocused,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="star-outline" size={18} color={theme.colors.text} />
                {!compact ? <Text style={styles.accountLabel}>{myListTitle}</Text> : null}
              </Pressable>
            ) : null}
            {onOpenAccount ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={accountLabel}
                testID="home-account"
                onPress={onOpenAccount}
                style={({ focused, pressed }) => [
                  styles.accountButton,
                  focused && styles.accountButtonFocused,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={account.userId ? 'person-circle' : 'person-circle-outline'}
                  size={18}
                  color={theme.colors.text}
                />
                {(!compact || !account.userId) ? (
                  <Text style={styles.accountLabel}>{accountLabel}</Text>
                ) : null}
                <View
                  style={[
                    styles.accountStatus,
                    account.userId
                      ? styles.accountStatusSynced
                      : account.backendAvailable
                        ? styles.accountStatusAvailable
                        : styles.accountStatusGuest,
                  ]}
                />
              </Pressable>
            ) : null}
          </View>
        </LinearGradient>
      ) : null}

      {route !== 'home' ? (
        <View
          style={[
            styles.sectionHeader,
            {
              paddingTop: safeInsetEdge(
                theme.spacing.xl,
                safeAreaInsets.top,
                12,
              ),
            },
          ]}
        >
          <Text style={styles.routeTitle}>{t(routeTitleKey[route])}</Text>
        </View>
      ) : null}

      {hero ? (
        <Hero
          item={hero}
          compact={compact}
          onDetails={() => { if (hero.id.trim()) onSelectMedia(hero.id.trim()); }}
          onPlay={() => {
            void service.getDetails(hero.id).then((details) => {
              if (details?.kind === 'movie') {
                return playback.playMovie(details);
              }
              onSelectMedia(hero.id.trim());
              return undefined;
            }).catch(() => { if (hero.id.trim()) onSelectMedia(hero.id.trim()); });
          }}
          inMyList={heroInMyList}
          myListLabel={myListTitle}
          onToggleMyList={toggleHeroMyList}
        />
      ) : null}

      {continueWatching.length ? (
        <View style={homeContentGap}>
          <ContinueWatchingRow
            records={continueWatching}
            onResume={(record) => { void resumeRecord(record); }}
          />
        </View>
      ) : null}

      {myListItems.length ? (
        <View style={firstSubRowHasGap ? homeContentGap : undefined}>
        <MediaRow
          section={{ id: 'my-list', title: myListTitle, kinds: ['movie', 'series'] }}
          items={myListItems}
          onSelectMedia={selectRowItem}
          onLongPressMedia={setQuickItem}
          onPrefetchMedia={prefetchDetails}
        />
        </View>
      ) : null}

      {state === 'loading' ? (
        <View style={[styles.stateBox, { marginTop: headerClearance }]}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={styles.stateTitle}>{t('common.loading')}</Text>
        </View>
      ) : null}

      {state === 'error' ? (
        <View style={[styles.stateBox, { marginTop: headerClearance }]}>
          <Text style={styles.stateTitle}>{t('common.unavailable')}</Text>
          <Pressable
            onPress={() => setReloadKey((key) => key + 1)}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {state === 'empty' ? (
        <View style={[styles.stateBox, { marginTop: headerClearance }]}>
          <Text style={styles.stateTitle}>{t('common.noResults')}</Text>
          {onOpenProviders ? (
            <>
              <Text style={styles.stateBody}>{emptyCatalogHint}</Text>
              <Pressable
                testID="catalog-empty-open-providers"
                onPress={onOpenProviders}
                style={({ focused, pressed }) => [
                  styles.retry,
                  focused && styles.heroActionFocused,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.retryText}>
                  {t('playback.manageProviders')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {genreOptions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreRow}
          style={[
            styles.genreScroller,
            firstSubRowHasGap && myListItems.length === 0 ? homeContentGap : null,
          ]}
        >
          {[null, ...genreOptions].map((entry) => {
            const active = entry
              ? genreFilter?.section.id === entry.section.id
              : genreFilter === null;
            return (
              <Pressable
                key={entry?.section.id ?? 'all'}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={entry ? `catalog-genre-${entry.genre}` : 'catalog-genre-all'}
                onPress={() => selectGenre(entry)}
                style={({ pressed }) => [
                  styles.genreChip,
                  active && styles.genreChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.genreChipText, active && styles.genreChipTextActive]}>
                  {entry ? entry.genre : t('catalog.allGenres')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {genreFilter ? (
        genreLoading && !genreRow ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
          </View>
        ) : genreRow && genreRow.items.length > 0 ? (
          <MediaRow
            section={genreRow.section}
            items={genreRow.items}
            onSelectMedia={selectRowItem}
            onLongPressMedia={setQuickItem}
            onPrefetchMedia={prefetchDetails}
          />
        ) : (
          <View style={styles.stateBox}>
            <Text style={styles.stateTitle}>{t('common.noResults')}</Text>
          </View>
        )
      ) : combinedRows.map((row, index) => (
        <View
          key={`${row.section.id}:${index}`}
          style={index === 0 && firstSubRowHasGap && myListItems.length === 0 && genreOptions.length === 0
            ? homeContentGap
            : undefined}
        >
          <MediaRow
            section={row.section}
            items={row.items}
            onSelectMedia={selectRowItem}
            onLongPressMedia={setQuickItem}
            onPrefetchMedia={prefetchDetails}
            progressByMediaId={continueProgress}
            watchedByMediaId={watched}
            onLoadMore={
              !loading && row.nextCursor
                ? () => { void loadMoreRow(row.section.id); }
                : undefined
            }
            loadingMore={loadingMoreRowIds.includes(row.section.id)}
            loadMoreLabel={t('search.loadMore')}
          />
        </View>
      ))}

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

function Hero({
  item,
  compact,
  onDetails,
  onPlay,
  inMyList,
  myListLabel,
  onToggleMyList,
}: {
  item: CatalogMediaItem;
  compact: boolean;
  onDetails(): void;
  onPlay(): void;
  inMyList: boolean;
  myListLabel: string;
  onToggleMyList(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  return (
    <View style={[styles.hero, compact && styles.heroCompact]}>
      <ImageBackground
        source={item.backdropUrl ? { uri: item.backdropUrl } : undefined}
        resizeMode="cover"
        style={[styles.heroImage, compact && styles.heroImageCompact]}
        imageStyle={styles.heroImageStyle}
      >
        <View style={styles.heroShade}>
          <View style={[styles.heroContent, compact && styles.heroContentCompact]}>
            <Text style={styles.heroKicker}>
              {t(item.kind === 'movie' ? 'common.movie' : 'common.series')}
            </Text>
            <Text numberOfLines={2} style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
              {item.title}
            </Text>
            <View style={styles.heroMeta}>
              {Number.isInteger(item.year) && item.year! >= 1888 && item.year! <= 3000 ? <Text style={styles.heroMetaText}>{item.year}</Text> : null}
              {typeof item.rating === 'number' && Number.isFinite(item.rating) ? <Text style={styles.heroMetaText}>★ {Math.max(0, Math.min(10, item.rating)).toFixed(1)}</Text> : null}
              {item.genres?.filter((genre) => genre?.trim()).slice(0, 2).map((genre, index) => (
                <Text key={`${genre}:${index}`} style={styles.heroMetaText}>{genre}</Text>
              ))}
            </View>
            {item.overview ? (
              <Text numberOfLines={compact ? 2 : 3} style={styles.heroOverview}>
                {item.overview}
              </Text>
            ) : null}
            <View style={styles.heroActions}>
              <Pressable
                accessibilityRole="button"
                focusable
                testID="catalog-hero-play"
                onPress={onPlay}
                style={({ focused, pressed }) => [
                  styles.heroPlay,
                  focused && styles.heroActionFocused,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="play" size={14} color="#0a0a0c" />
                <Text style={styles.heroPlayText}>{t('playback.play')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                focusable
                testID="catalog-hero-details"
                onPress={onDetails}
                style={({ focused, pressed }) => [
                  styles.heroInfo,
                  focused && styles.heroActionFocused,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.heroInfoText}>ⓘ {t('common.details')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                focusable
                testID="catalog-hero-my-list"
                onPress={onToggleMyList}
                style={({ focused, pressed }) => [
                  styles.heroInfo,
                  focused && styles.heroActionFocused,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.heroInfoText}>
                  {inMyList ? '✓' : '+'} {myListLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  genreScroller: { marginTop: 8, marginBottom: 4 },
  genreRow: { gap: 8, paddingHorizontal: '5%', paddingVertical: 6 },
  genreChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  genreChipActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  genreChipText: {
    color: theme.colors.muted,
    fontFamily: fontFamily.uiMedium,
    fontSize: 12,
  },
  genreChipTextActive: { color: theme.colors.onAccent },
  content: {
    paddingBottom: 110,
    width: '100%',
    maxWidth: 1600,
    alignSelf: 'center',
  },
  homeTopBar: {
    position: 'absolute',
    zIndex: 20,
    top: 0,
    left: 0,
    right: 0,
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: '4%',
    paddingTop: 14,
    paddingBottom: 14,
  },
  homeBrand: {
    flexShrink: 1,
    color: theme.colors.accentSoft,
    fontFamily: fontFamily.displayBold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.6,
  },
  homeTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileButton: {
    minWidth: 42,
    height: 42,
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(12,12,15,0.72)',
    paddingHorizontal: 7,
  },
  profileAvatar: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  profileAvatarText: {
    color: '#0a0a0c',
    fontSize: 13,
    fontWeight: '900',
  },
  profileName: {
    maxWidth: 92,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    paddingRight: 4,
  },
  libraryButton: {
    minWidth: 42,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(12,12,15,0.72)',
    paddingHorizontal: 10,
  },
  libraryIcon: { color: '#ffffff', fontSize: 19, fontWeight: '900' },
  accountButton: {
    minWidth: 42,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(12,12,15,0.72)',
    paddingHorizontal: 10,
  },
  accountButtonFocused: {
    borderColor: theme.colors.focus,
    transform: [{ scale: 1.06 }],
  },
  accountIcon: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  accountLabel: { color: '#ffffff', fontSize: 11, fontWeight: '900', paddingRight: 2 },
  accountStatus: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginRight: 3,
  },
  accountStatusSynced: { backgroundColor: '#45d483' },
  accountStatusAvailable: { backgroundColor: theme.colors.accentSoft },
  accountStatusGuest: { backgroundColor: theme.colors.muted },
  sectionHeader: {
    paddingHorizontal: '4%',
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  routeTitle: {
    color: theme.colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  hero: {
    minHeight: 510,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.xl,
  },
  heroCompact: { minHeight: 420 },
  heroImage: { minHeight: 510, justifyContent: 'flex-end' },
  heroImageCompact: { minHeight: 420 },
  heroImageStyle: { opacity: 0.92 },
  heroShade: {
    flex: 1,
    minHeight: 510,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  heroContent: {
    width: '100%',
    maxWidth: 820,
    paddingHorizontal: '4%',
    paddingTop: 125,
    paddingBottom: 52,
  },
  heroContentCompact: { paddingBottom: 34, paddingTop: 150 },
  heroKicker: {
    color: theme.colors.accentSoft,
    fontSize: 11,
    letterSpacing: 1.8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 56,
    lineHeight: 60,
    fontWeight: '900',
    letterSpacing: -1.5,
    marginTop: 7,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroTitleCompact: { fontSize: 38, lineHeight: 43 },
  heroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  heroMetaText: {
    color: '#f1f1f3',
    fontSize: 12,
    fontWeight: '800',
  },
  heroOverview: {
    color: '#f1f1f3',
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 720,
    marginTop: 13,
    textShadowColor: 'rgba(0,0,0,0.72)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  heroPlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  heroPlayIcon: { color: '#0a0a0c', fontSize: 13, fontWeight: '900' },
  heroPlayText: { color: '#0a0a0c', fontSize: 13, fontWeight: '900' },
  heroInfo: {
    backgroundColor: 'rgba(45,45,52,0.82)',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  heroInfoText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  heroActionFocused: {
    borderWidth: 2,
    borderColor: theme.colors.focus,
    transform: [{ scale: 1.04 }],
  },
  stateBox: {
    minHeight: 220,
    marginHorizontal: '4%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.xl,
    marginBottom: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  stateTitle: { color: theme.colors.text, fontSize: 19, fontWeight: '900' },
  stateBody: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 520,
  },
  retry: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: '#ffffff', fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
