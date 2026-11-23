import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CatalogMediaItem } from '@moviestv/catalog';
import { continueWatchingRecords, type WatchProgressRecord } from '@moviestv/sync';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import { usePlayback } from '../playback/usePlayback';
import { usePreferences } from '../preferences/usePreferences';
import { useWatchProgress } from '../watch-progress/useWatchProgress';
import { ContinueWatchingRow } from '../catalog/ContinueWatchingRow';
import { WatchHistoryScreen } from '../watch-progress/WatchHistoryScreen';
import { MediaDetailsScreen } from '../catalog/MediaDetailsScreen';
import { MediaRow } from '../catalog/MediaRow';
import { useThemeStyles } from '../theme/ThemeProvider';

function seriesTitleFromProgressTitle(
  title: string,
): string | undefined {
  const match = /^(.*?)\s+·\s+S\d+E\d+\s+·\s+/i.exec(title.trim());
  const seriesTitle = match?.[1]?.trim();
  return seriesTitle || undefined;
}

function asCatalogItems(
  items: ReturnType<typeof usePreferences>['preferences']['myListItems'],
): CatalogMediaItem[] {
  return items.map((item) => ({
    id: item.mediaId,
    kind: item.kind,
    title: item.title,
    providerId: item.providerId,
    externalIds: item.externalIds,
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
    ...(item.backdropUrl ? { backdropUrl: item.backdropUrl } : {}),
    ...(item.year ? { year: item.year } : {}),
  }));
}

export function LibraryScreen({
  onBack,
  onOpenDownloads,
}: {
  onBack(): void;
  onOpenDownloads(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const { preferences } = usePreferences();
  const watchProgress = useWatchProgress();
  const playback = usePlayback();
  const swipeHandlers = useSwipeBack(onBack);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedFallbackIdentity, setSelectedFallbackIdentity] = useState<{
    mediaId: string;
    kind: 'movie' | 'series';
    title: string;
    externalIds: CatalogMediaItem['externalIds'];
  } | null>(null);

  const myListItems = useMemo(
    () => asCatalogItems(preferences.myListItems),
    [preferences.myListItems],
  );
  const continueWatching = useMemo(
    () => continueWatchingRecords(watchProgress.records)
      .filter((record) => (
        record.kind === 'movie'
        || Boolean(
          (
            record.externalIds?.imdb
            || record.externalIds?.tmdb
            || record.seriesId?.trim()
          )
          && record.seasonNumber !== undefined
          && record.episodeNumber !== undefined,
        )
      ))
      .slice(0, 50),
    [watchProgress.records],
  );

  const resume = async (record: WatchProgressRecord) => {
    if (await playback.resumeProgress(record)) return;

    // A failed resolver attempt leaves the global playback overlay in
    // no-sources/error. Close that failed session before showing the details
    // fallback, otherwise the overlay continues to cover the Library screen.
    playback.closePlayback();

    if (record.kind === 'movie') {
      setSelectedFallbackIdentity({
        mediaId: record.mediaId,
        kind: 'movie',
        title: record.title,
        externalIds: record.externalIds ?? {},
      });
      setSelectedMediaId(record.mediaId);
      return;
    }
    const seriesId = record.seriesId?.trim();
    if (seriesId) {
      const seriesTitle = seriesTitleFromProgressTitle(record.title);
      setSelectedFallbackIdentity(
        seriesTitle
          ? {
              mediaId: seriesId,
              kind: 'series',
              title: seriesTitle,
              externalIds: record.externalIds ?? {},
            }
          : null,
      );
      setSelectedMediaId(seriesId);
    }
  };

  const empty = myListItems.length === 0 && continueWatching.length === 0;

  return (
    <View style={styles.root} {...swipeHandlers}>
      <View
        style={[
          styles.root,
          selectedMediaId || historyOpen ? styles.hiddenContent : null,
        ]}
      >
    <ScrollView
      testID="library-screen"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <IconBackButton
          label={t('common.back')}
          onPress={onBack}
          testID="library-back"
        />

        <View style={styles.headingCopy}>
          <Text style={styles.title}>{t('library.title')}</Text>
          <Text style={styles.subtitle}>{t('library.subtitle')}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          testID="library-history"
          onPress={() => setHistoryOpen(true)}
          style={({ focused, pressed }) => [
            styles.downloadButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.downloadIcon}>◷</Text>
          <Text style={styles.downloadText}>{t('library.history')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          testID="library-downloads"
          onPress={onOpenDownloads}
          style={({ focused, pressed }) => [
            styles.downloadButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.downloadIcon}>↓</Text>
          <Text style={styles.downloadText}>{t('library.downloads')}</Text>
        </Pressable>
      </View>

      {continueWatching.length ? (
        <ContinueWatchingRow
          records={continueWatching}
          onResume={(record) => { void resume(record); }}
        />
      ) : null}

      {myListItems.length ? (
        <MediaRow
          section={{
            id: 'library:my-list',
            title: t('library.myList'),
            kinds: ['movie', 'series'],
          }}
          items={myListItems}
          onSelectMedia={(item) => {
            setSelectedFallbackIdentity({
              mediaId: item.id,
              kind: item.kind,
              title: item.title,
              externalIds: item.externalIds,
            });
            setSelectedMediaId(item.id);
          }}
        />
      ) : null}

      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>☆</Text>
          <Text style={styles.emptyText}>{t('library.empty')}</Text>
        </View>
      ) : null}
    </ScrollView>
      </View>
      {historyOpen ? (
        <View style={styles.root}>
          <WatchHistoryScreen onBack={() => setHistoryOpen(false)} />
        </View>
      ) : null}
      {selectedMediaId ? (
        <View style={styles.root}>
          <MediaDetailsScreen
            mediaId={selectedMediaId}
            fallbackIdentity={selectedFallbackIdentity ?? undefined}
            onBack={() => {
              setSelectedMediaId(null);
              setSelectedFallbackIdentity(null);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1 },
  hiddenContent: { display: 'none' },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 1500,
    alignSelf: 'center',
    paddingTop: 26,
    paddingBottom: 110,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: '4%',
    marginBottom: 30,
  },
  headingCopy: { flex: 1, minWidth: 0 },
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
    lineHeight: 18,
    marginTop: 3,
  },
  headerButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 13,
  },
  headerButtonText: { color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  downloadButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingHorizontal: 15,
  },
  downloadIcon: { color: '#0a0a0c', fontSize: 16, fontWeight: '900' },
  downloadText: { color: '#0a0a0c', fontSize: 11, fontWeight: '900' },
  empty: {
    minHeight: 330,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: '8%',
  },
  emptyIcon: { color: theme.colors.border, fontSize: 62, fontWeight: '900' },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  focused: { borderColor: theme.colors.focus, transform: [{ scale: 1.025 }] },
  pressed: { opacity: 0.72 },
});
