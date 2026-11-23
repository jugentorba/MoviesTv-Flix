import React, { useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { MediaDetails, SeriesEpisode } from '@moviestv/catalog';
import {
  MAX_MY_LIST_ITEMS,
  sameMyListMedia,
  type MyListMediaIdentity,
  type StreamSource,
} from '@moviestv/core';
import {
  continueWatchingRecords,
  findWatchProgressRecord,
  isPlaybackResumable,
} from '@moviestv/sync';
import { fontFamily, gradients, typography, type Theme } from '@moviestv/ui';
import { LinearGradient } from 'expo-linear-gradient';
import type { OfflineMediaSnapshot } from '../downloads/offlineDownloadMetadata';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useDownloadManager } from '../downloads/useDownloadManager';
import { useI18n } from '../i18n/useI18n';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import { usePreferences } from '../preferences/usePreferences';
import { canDownloadSource } from '../playback/downloadSource';
import { SourceChooser } from '../playback/SourceChooser';
import { usePlayback } from '../playback/usePlayback';
import { WatchProgressContext } from '../watch-progress/useWatchProgress';
import { SeriesEpisodeBrowser } from './SeriesEpisodeBrowser';
import { useCatalog } from './useCatalog';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

function seriesTitleFromProgressTitle(
  title: string,
): string | undefined {
  const match = /^(.*?)\s+·\s+S\d+E\d+\s+·\s+/i.exec(title.trim());
  const seriesTitle = match?.[1]?.trim();
  return seriesTitle || undefined;
}

function sameSeriesIdentity(
  details: Pick<MediaDetails, 'id' | 'externalIds'>,
  record: Pick<
    import('@moviestv/sync').WatchProgressRecord,
    'seriesId' | 'externalIds'
  >,
): boolean {
  const detailsId = details.id.trim();
  const recordSeriesId = record.seriesId?.trim();
  if (detailsId && recordSeriesId && detailsId === recordSeriesId) {
    return true;
  }

  const detailsImdb = details.externalIds.imdb?.trim().toLowerCase();
  const recordImdb = record.externalIds?.imdb?.trim().toLowerCase();
  const detailsTmdb = details.externalIds.tmdb?.trim();
  const recordTmdb = record.externalIds?.tmdb?.trim();

  if (detailsImdb && recordImdb && detailsImdb !== recordImdb) return false;
  if (detailsTmdb && recordTmdb && detailsTmdb !== recordTmdb) return false;

  return Boolean(
    (detailsImdb && recordImdb && detailsImdb === recordImdb)
    || (detailsTmdb && recordTmdb && detailsTmdb === recordTmdb),
  );
}

interface MediaDetailsFallbackIdentity extends MyListMediaIdentity {
  title: string;
}

interface MediaDetailsScreenProps {
  mediaId: string;
  fallbackIdentity?: MediaDetailsFallbackIdentity;
  onBack(): void;
}

export function MediaDetailsScreen({
  mediaId,
  fallbackIdentity,
  onBack,
}: MediaDetailsScreenProps) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { service } = useCatalog();
  const { preferences } = usePreferences();
  const watchProgress = useContext(WatchProgressContext);
  const { t } = useI18n();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const normalizedRouteMediaId = mediaId.trim();
  const persistedMyListIdentity = preferences.myListItems.find(
    (item) => item.mediaId.trim() === normalizedRouteMediaId,
  );
  const persistedProgressIdentity = watchProgress?.records.flatMap<MediaDetailsFallbackIdentity>((record) => {
    if (
      record.kind === 'movie'
      && record.mediaId.trim() === normalizedRouteMediaId
    ) {
      return [{
        mediaId: record.mediaId,
        kind: 'movie' as const,
        title: record.title,
        externalIds: record.externalIds ?? {},
      }];
    }
    if (
      record.kind === 'episode'
      && record.seriesId?.trim() === normalizedRouteMediaId
    ) {
      const title = seriesTitleFromProgressTitle(record.title);
      return title ? [{
        mediaId: normalizedRouteMediaId,
        kind: 'series' as const,
        title,
        externalIds: record.externalIds ?? {},
      }] : [];
    }
    return [];
  })[0];
  const persistedMyListFallback = persistedMyListIdentity
    ? {
        mediaId: persistedMyListIdentity.mediaId,
        kind: persistedMyListIdentity.kind,
        title: persistedMyListIdentity.title,
        externalIds: persistedMyListIdentity.externalIds,
      }
    : undefined;
  const fallbackCandidates = [
    fallbackIdentity,
    persistedMyListFallback,
    persistedProgressIdentity,
  ].filter((candidate): candidate is MediaDetailsFallbackIdentity => (
    Boolean(candidate)
  ));
  const effectiveFallbackIdentity = fallbackCandidates.find((candidate) => (
    Boolean(
      candidate.externalIds.imdb?.trim()
      || candidate.externalIds.tmdb?.trim(),
    )
  )) ?? fallbackCandidates[0];
  const fallbackMediaId =
    effectiveFallbackIdentity?.mediaId?.trim() ?? '';
  const fallbackTitle =
    effectiveFallbackIdentity?.title?.trim() ?? '';
  const fallbackKind = effectiveFallbackIdentity?.kind;
  const fallbackImdb = effectiveFallbackIdentity?.externalIds.imdb
    ?.trim()
    .toLowerCase();
  const fallbackTmdb =
    effectiveFallbackIdentity?.externalIds.tmdb?.trim();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const normalizedMediaId = mediaId.trim();
    if (!normalizedMediaId) {
      setDetails(null); setError(t('common.unavailable')); setLoading(false); return () => { active = false; };
    }
    const load = async (): Promise<MediaDetails | null> => {
      try {
        const direct = await service.getDetails(normalizedMediaId);
        if (direct) return direct;
      } catch {
        // A removed or unavailable provider can still be recovered below.
      }

      if (
        !fallbackTitle
        || !fallbackKind
        || (!fallbackImdb && !fallbackTmdb)
      ) {
        return null;
      }

      const page = await service.search(fallbackTitle);
      const fallbackMatchIdentity = {
        mediaId: fallbackMediaId || normalizedMediaId,
        kind: fallbackKind,
        externalIds: {
          ...(fallbackImdb ? { imdb: fallbackImdb } : {}),
          ...(fallbackTmdb ? { tmdb: fallbackTmdb } : {}),
        },
      };
      for (const item of page.items) {
        const recoveredId = item.id.trim();
        if (
          !recoveredId
          || recoveredId === normalizedMediaId
          || !sameMyListMedia(
            {
              mediaId: recoveredId,
              kind: item.kind,
              externalIds: item.externalIds,
            },
            fallbackMatchIdentity,
          )
        ) {
          continue;
        }

        try {
          const recovered = await service.getDetails(recoveredId);
          if (recovered) return recovered;
        } catch {
          // Try the next matching provider result.
        }
      }

      return null;
    };

    void load()
      .then((value) => {
        if (!active) return;
        setDetails(value);
        if (!value) setError(t('common.unavailable'));
      })
      .catch(() => {
        if (active) setError(t('common.unavailable'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [
    fallbackImdb,
    fallbackKind,
    fallbackMediaId,
    fallbackTitle,
    fallbackTmdb,
    mediaId,
    service,
    t,
  ]);

  if (loading) {
    return (
      <View
        style={[
          styles.fullState,
          {
            paddingTop: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.top,
              12,
            ),
            paddingRight: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.right,
              12,
            ),
            paddingBottom: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.bottom,
              12,
            ),
            paddingLeft: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.left,
              12,
            ),
          },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={styles.stateText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (error || !details) {
    return (
      <View
        style={[
          styles.fullState,
          {
            paddingTop: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.top,
              12,
            ),
            paddingRight: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.right,
              12,
            ),
            paddingBottom: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.bottom,
              12,
            ),
            paddingLeft: safeInsetEdge(
              theme.spacing.xl,
              safeAreaInsets.left,
              12,
            ),
          },
        ]}
      >
        <Text style={styles.stateTitle}>{t('common.unavailable')}</Text>
        <ActionButton label={t('common.back')} onPress={onBack} />
      </View>
    );
  }

  return <DetailsContent details={details} onBack={onBack} />;
}

function ActionButton({
  label,
  onPress,
  primary = false,
  testID,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  testID?: string;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      testID={testID}
      focusable
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.actionButton,
        primary && styles.actionButtonPrimary,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionButtonText, primary && styles.actionButtonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function DetailsContent({ details, onBack }: { details: MediaDetails; onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const { preferences, setMyListItems } = usePreferences();
  const myListItemsRef = React.useRef(preferences.myListItems);
  // Edge swipe mirrors the system back gesture this screen does not inherit.
  const swipeHandlers = useSwipeBack(onBack);

  useEffect(() => {
    myListItemsRef.current = preferences.myListItems;
  }, [preferences.myListItems]);

  const {
    playMovie,
    resolveMovieSources,
    resolveEpisodeSources,
    resumeProgress,
  } = usePlayback();
  const downloads = useDownloadManager();
  const watchProgress = React.useContext(WatchProgressContext);
  const [downloadSources, setDownloadSources] = useState<StreamSource[]>([]);
  const [downloadChooserOpen, setDownloadChooserOpen] = useState(false);
  const [downloadResolving, setDownloadResolving] = useState(false);
  const [downloadResolvingEpisodeId, setDownloadResolvingEpisodeId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadTitle, setDownloadTitle] = useState<string | null>(null);
  const [downloadMedia, setDownloadMedia] = useState<OfflineMediaSnapshot | null>(null);
  const compact = width < 720;
  const canPlayMovie = details.kind === 'movie'
    && Boolean(details.id?.trim() && details.title?.trim());
  const movieProgress = canPlayMovie && watchProgress
    ? findWatchProgressRecord(watchProgress.records, {
      mediaId: details.id,
      kind: 'movie',
      title: details.title,
      externalIds: details.externalIds,
    })
    : undefined;
  const resumable = Boolean(movieProgress && isPlaybackResumable(movieProgress));
  const resumePercent = movieProgress && movieProgress.durationSeconds > 0
    ? Math.max(0, Math.min(100, (movieProgress.positionSeconds / movieProgress.durationSeconds) * 100))
    : 0;
  const seriesResume = details.kind === 'series'
    ? continueWatchingRecords(watchProgress?.records ?? [])
      .find((record) => (
        record.kind === 'episode'
        && sameSeriesIdentity(details, record)
      ))
    : undefined;
  const canBrowseEpisodes = details.kind === 'series'
    && Boolean(details.id?.trim() && details.title?.trim())
    && (details.seasons ?? []).some(
      (season) => Number.isInteger(season.seasonNumber) && season.seasonNumber >= 0,
    );

  const myListIdentity = {
    mediaId: details.id.trim(),
    kind: details.kind,
    externalIds: details.externalIds,
  };
  const inMyList = preferences.myListItems.some(
    (item) => sameMyListMedia(item, myListIdentity),
  );

  const toggleMyList = () => {
    const currentItems = myListItemsRef.current;
    const currentlyInMyList = currentItems.some(
      (item) => sameMyListMedia(item, myListIdentity),
    );
    const nextItems = currentlyInMyList
      ? currentItems.filter(
          (item) => !sameMyListMedia(item, myListIdentity),
        )
      : [
          ...currentItems
            .filter((item) => !sameMyListMedia(item, myListIdentity))
            .slice(-(MAX_MY_LIST_ITEMS - 1)),
          {
            mediaId: details.id.trim(),
            kind: details.kind,
            title: details.title.trim(),
            providerId: details.providerId,
            externalIds: details.externalIds,
            ...(details.posterUrl ? { posterUrl: details.posterUrl } : {}),
            ...(details.backdropUrl ? { backdropUrl: details.backdropUrl } : {}),
            ...(details.year ? { year: details.year } : {}),
          },
        ];

    myListItemsRef.current = nextItems;
    void setMyListItems(nextItems).catch(() => undefined);
  };

  const prepareDownload = (
    sources: StreamSource[],
    title: string,
    media: OfflineMediaSnapshot,
  ) => {
    const seen = new Set<string>();
    const downloadable = sources.filter((source) => {
      if (!canDownloadSource(source) || seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    }).slice(0, 100);
    if (!downloadable.length) {
      setDownloadError(t('playback.noSources'));
      return false;
    }
    setDownloadSources(downloadable);
    setDownloadTitle(title);
    setDownloadMedia(media);
    setDownloadChooserOpen(true);
    return true;
  };

  const openMovieDownload = async () => {
    if (!canPlayMovie || downloadResolving || !details.id?.trim() || !details.title?.trim()) return;
    setDownloadResolving(true);
    setDownloadError(null);
    try {
      prepareDownload(
        await resolveMovieSources(details),
        details.title,
        {
          mediaId: details.id.trim(),
          kind: 'movie',
          title: details.title.trim(),
          ...(details.posterUrl ? { posterUrl: details.posterUrl } : {}),
          ...(details.year ? { year: details.year } : {}),
          externalIds: details.externalIds,
        },
      );
    } catch {
      setDownloadError(t('playback.failed'));
    } finally {
      setDownloadResolving(false);
    }
  };

  const openEpisodeDownload = async (episode: SeriesEpisode) => {
    if (details.kind !== 'series' || downloadResolvingEpisodeId || !episode.id?.trim() || !episode.title?.trim()) return;
    setDownloadResolvingEpisodeId(episode.id);
    setDownloadError(null);
    try {
      const title = `${details.title} · S${episode.seasonNumber}E${episode.episodeNumber} · ${episode.title}`;
      prepareDownload(
        await resolveEpisodeSources(details, episode),
        title,
        {
          mediaId: episode.id.trim(),
          kind: 'episode',
          title: title.trim(),
          ...((episode.stillUrl ?? details.posterUrl)
            ? { posterUrl: episode.stillUrl ?? details.posterUrl }
            : {}),
          ...(details.year ? { year: details.year } : {}),
          externalIds: details.externalIds,
          seriesId: details.id,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
        },
      );
    } catch {
      setDownloadError(t('playback.failed'));
    } finally {
      setDownloadResolvingEpisodeId(null);
    }
  };

  const downloadSelectedSource = (sourceId: string) => {
    const source = downloadSources.find((candidate) => candidate.id === sourceId);
    if (!source || !source.id?.trim() || !downloadTitle?.trim() || !downloadMedia) return;
    setDownloadChooserOpen(false);
    setDownloadError(null);
    void downloads.startDownload(source, downloadTitle.trim(), downloadMedia).catch(() => {
      setDownloadError(t('playback.failed'));
    });
  };

  return (
    <View style={styles.detailsRoot} {...swipeHandlers}>
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        {
          paddingBottom: safeInsetEdge(110, safeAreaInsets.bottom, 88),
        },
      ]}
    >
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <ImageBackground
          source={details.backdropUrl ? { uri: details.backdropUrl } : undefined}
          resizeMode="cover"
          style={[styles.heroImage, compact && styles.heroImageCompact]}
          imageStyle={styles.heroImageStyle}
        >
          <LinearGradient
            colors={gradients.scrimBottom}
            locations={[0, 0.45, 1]}
            style={styles.heroShade}
          >
            <View
              style={[
                styles.topBar,
                {
                  paddingTop: safeInsetEdge(22, safeAreaInsets.top, 12),
                  paddingLeft: safeAreaInsets.left > 0
                    ? safeInsetEdge(16, safeAreaInsets.left, 12)
                    : '4%',
                  paddingRight: safeAreaInsets.right > 0
                    ? safeInsetEdge(16, safeAreaInsets.right, 12)
                    : '4%',
                },
              ]}
            >
              <IconBackButton label={t('common.back')} onPress={onBack} testID="details-back" />
            </View>

            <View style={[styles.heroBody, compact && styles.heroBodyCompact]}>
              {!compact && details.posterUrl ? (
                <Image source={{ uri: details.posterUrl }} resizeMode="cover" style={styles.poster} />
              ) : null}
              <View style={styles.heroCopy}>
                <Text style={styles.kindLabel}>
                  {t(details.kind === 'movie' ? 'common.movie' : 'common.series')}
                </Text>
                <Text style={[styles.title, compact && styles.titleCompact]}>{details.title}</Text>
                {details.originalTitle && details.originalTitle !== details.title ? (
                  <Text style={styles.originalTitle}>{details.originalTitle}</Text>
                ) : null}
                <View style={styles.metaLine}>
                  {Number.isInteger(details.year) && details.year! >= 1888 && details.year! <= 3000 ? <Text style={styles.meta}>{details.year}</Text> : null}
                  {typeof details.rating === 'number' && Number.isFinite(details.rating) ? <Text style={styles.meta}>★ {Math.max(0, Math.min(10, details.rating)).toFixed(1)}</Text> : null}
                  {Number.isFinite(details.runtimeMinutes) && details.runtimeMinutes! > 0 && details.runtimeMinutes! <= 10000 ? <Text style={styles.meta}>{Math.round(details.runtimeMinutes!)} {t('common.minutes')}</Text> : null}
                  {Number.isInteger(details.seasonCount) && details.seasonCount! > 0 && details.seasonCount! <= 10000 ? <Text style={styles.meta}>{details.seasonCount} {t('common.seasons')}</Text> : null}
                  {typeof details.certification === 'string' && details.certification.trim() && details.certification.length <= 32 ? <Text style={styles.certification}>{details.certification.trim()}</Text> : null}
                </View>
                {details.genres?.some((genre) => genre?.trim()) ? (
                  <Text style={styles.genres}>{details.genres.filter((genre) => genre?.trim()).slice(0, 4).join('  •  ')}</Text>
                ) : null}
                <Text numberOfLines={compact ? 5 : 4} style={styles.overview}>
                  {details.overview ?? t('details.noOverview')}
                </Text>
                <View style={styles.actions}>
                  {canPlayMovie ? (
                    <>
                      <ActionButton
                        testID="play-movie"
                        label={
                          resumable
                            ? `▶  ${t('mediaDetails.resume')} · ${Math.round(resumePercent)}%`
                            : `▶  ${t('playback.play')}`
                        }
                        onPress={() => { void playMovie(details); }}
                        primary
                      />
                      <ActionButton
                        testID="download-movie"
                        label={downloadResolving ? t('common.loading') : `↓  ${t('playback.download')}`}
                        onPress={() => { void openMovieDownload(); }}
                      />
                    </>
                  ) : null}
                  {seriesResume ? (
                    <ActionButton
                      testID="resume-series-episode"
                      label={
                        `▶  ${t('mediaDetails.resume')} · S${seriesResume.seasonNumber}E${seriesResume.episodeNumber}`
                      }
                      onPress={() => { void resumeProgress(seriesResume); }}
                      primary
                    />
                  ) : null}
                  <ActionButton
                    testID="toggle-my-list"
                    label={`${inMyList ? '✓' : '+'}  ${t(inMyList ? 'mediaDetails.removeFromMyList' : 'mediaDetails.addToMyList')}`}
                    onPress={toggleMyList}
                  />
                  {!canPlayMovie && !canBrowseEpisodes ? (
                    <View style={styles.unavailableButton}>
                      <Text style={styles.unavailableButtonText}>{t('details.playUnavailable')}</Text>
                    </View>
                  ) : null}
                </View>
                {downloadError ? (
                  <Text accessibilityRole="alert" style={styles.downloadError}>{downloadError}</Text>
                ) : null}
                {resumable ? (
                  <View testID="movie-resume-progress" style={styles.resumeBlock}>
                    <View style={styles.resumeTrack}>
                      <View
                        style={[
                          styles.resumeFill,
                          { width: `${resumePercent}%` as `${number}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.resumeText}>
                      {t('mediaDetails.resume')} · {Math.round(resumePercent)}%
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </LinearGradient>
        </ImageBackground>
      </View>

      <View style={styles.body}>
        {canBrowseEpisodes ? (
          <SeriesEpisodeBrowser
            series={details}
            onDownloadEpisode={(episode) => { void openEpisodeDownload(episode); }}
            downloadingEpisodeId={downloadResolvingEpisodeId}
          />
        ) : null}

        {details.cast?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('common.cast')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow}>
              {details.cast.filter((name) => name?.trim()).slice(0, 100).map((name, index) => (
                <View key={`${name}:${index}`} style={styles.castPill}>
                  <Text style={styles.castText}>{name}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </ScrollView>
    {downloadChooserOpen ? (
      <SourceChooser
        sources={downloadSources}
        selectedSourceId={downloadSources[0]?.id ?? null}
        onSelect={downloadSelectedSource}
        onClose={() => setDownloadChooserOpen(false)}
      />
    ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  detailsRoot: { flex: 1, backgroundColor: theme.colors.background },
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingBottom: 110 },
  fullState: {
    flex: 1,
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.xl,
  },
  stateTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '900' },
  stateText: { color: theme.colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  hero: { minHeight: 590, backgroundColor: theme.colors.surface, overflow: 'hidden' },
  heroCompact: { minHeight: 520 },
  heroImage: { minHeight: 590 },
  heroImageCompact: { minHeight: 520 },
  heroImageStyle: { opacity: 0.88 },
  heroShade: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    alignItems: 'flex-start',
    paddingHorizontal: '4%',
    paddingTop: 22,
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 28,
    width: '100%',
    maxWidth: 1350,
    alignSelf: 'center',
    paddingHorizontal: '4%',
    paddingBottom: 44,
  },
  heroBodyCompact: { paddingBottom: 32 },
  poster: {
    width: 190,
    aspectRatio: 2 / 3,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceElevated,
  },
  heroCopy: { flex: 1, maxWidth: 760 },
  kindLabel: {
    color: theme.colors.accentSoft,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.onMedia,
    fontFamily: fontFamily.displayBold,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.2,
    marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  titleCompact: { fontSize: 32, lineHeight: 37 },
  originalTitle: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    marginTop: 6,
  },
  metaLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 13,
  },
  meta: {
    color: theme.colors.onMedia,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12.5,
  },
  certification: {
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '900',
  },
  genres: {
    color: theme.colors.muted,
    fontFamily: fontFamily.uiMedium,
    fontSize: 12.5,
    marginTop: 11,
  },
  overview: {
    color: theme.colors.text,
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 14,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  downloadError: { color: theme.colors.danger, fontSize: 12, fontWeight: '800', marginTop: 10 },
  resumeBlock: { maxWidth: 360, marginTop: 13, gap: 6 },
  resumeTrack: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  resumeFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  resumeText: { color: '#d7d7dc', fontSize: 11, fontWeight: '800' },
  actionButton: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(34,34,40,0.82)',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  actionButtonPrimary: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  actionButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  actionButtonTextPrimary: { color: '#0b0b0d' },
  unavailableButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: 'rgba(40,40,46,0.8)',
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  unavailableButtonText: { color: theme.colors.muted, fontSize: 12, fontWeight: '900' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
  body: {
    width: '100%',
    maxWidth: 1400,
    alignSelf: 'center',
    paddingHorizontal: '4%',
    paddingTop: 28,
  },
  section: { marginTop: 28 },
  sectionTitle: {
    ...typography.heading,
    color: theme.colors.text,
    marginBottom: 12,
  },
  castRow: { gap: 9, paddingRight: 24 },
  castPill: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  castText: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
});
