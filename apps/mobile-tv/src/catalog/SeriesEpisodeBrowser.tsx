import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MediaDetails, SeriesEpisode, SeriesSeason } from '@moviestv/catalog';
import {
  findWatchProgressRecord,
  isPlaybackCompleted,
} from '@moviestv/sync';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { usePlayback } from '../playback/usePlayback';
import { WatchProgressContext } from '../watch-progress/useWatchProgress';
import { useCatalog } from './useCatalog';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

interface SeriesEpisodeBrowserProps {
  series: MediaDetails;
  onDownloadEpisode?(episode: SeriesEpisode): void;
  downloadingEpisodeId?: string | null;
}

export function SeriesEpisodeBrowser({
  series,
  onDownloadEpisode,
  downloadingEpisodeId = null,
}: SeriesEpisodeBrowserProps) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { service } = useCatalog();
  const { playEpisode } = usePlayback();
  const watchProgress = React.useContext(WatchProgressContext);
  const { t } = useI18n();
  const seasons = useMemo(
    () => {
      const seen = new Set<number>();
      return (series.seasons ?? []).filter((season) => {
        if (!Number.isInteger(season.seasonNumber) || season.seasonNumber < 0 || season.seasonNumber > 10_000 || seen.has(season.seasonNumber)) return false;
        seen.add(season.seasonNumber);
        return true;
      })
        .sort((left, right) => left.seasonNumber - right.seasonNumber)
        .slice(0, 500);
    },
    [series.seasons],
  );
  const firstSeasonNumber = (
    seasons.find((season) => season.seasonNumber > 0)
    ?? seasons[0]
  )?.seasonNumber ?? null;
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(firstSeasonNumber);
  const [season, setSeason] = useState<SeriesSeason | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSelectedSeasonNumber(firstSeasonNumber);
  }, [firstSeasonNumber, series.id]);

  useEffect(() => {
    if (selectedSeasonNumber === null) {
      setSeason(null);
      setLoading(false);
      setFailed(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setFailed(false);
    setSeason(null);
    const seriesId = series.id.trim();
    if (!seriesId) { setFailed(true); setLoading(false); return () => { active = false; }; }
    void service.getSeason(seriesId, selectedSeasonNumber)
      .then((value) => {
        if (!active) return;
        setSeason(value ? { ...value, episodes: value.episodes.filter((episode) => episode.id?.trim() && episode.title?.trim() && Number.isInteger(episode.episodeNumber) && episode.episodeNumber > 0 && episode.episodeNumber <= 100_000).slice(0, 1000) } : null);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setSeason(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [reloadKey, selectedSeasonNumber, series.id, service]);

  if (seasons.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('details.episodes')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.seasonRow}
      >
        {seasons.map((summary) => {
          const selected = summary.seasonNumber === selectedSeasonNumber;
          return (
            <Pressable
              key={`${summary.seasonNumber}:${summary.id ?? ''}`}
              testID={`season-${summary.seasonNumber}`}
              focusable
              onPress={() => setSelectedSeasonNumber(summary.seasonNumber)}
              style={({ focused, pressed }) => [
                styles.seasonButton,
                selected && styles.seasonButtonSelected,
                focused && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.seasonText, selected && styles.seasonTextSelected]}>
                {summary.name || `${t('details.season')} ${summary.seasonNumber}`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.stateText}>{t('details.loadingEpisodes')}</Text>
        </View>
      ) : null}

      {!loading && failed ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{t('details.loadEpisodesFailed')}</Text>
          <Pressable
            testID="retry-season"
            focusable
            onPress={() => setReloadKey((value) => value + 1)}
            style={({ focused, pressed }) => [styles.retry, focused && styles.focused, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !failed && (!season || season.episodes.length === 0) ? (
        <Text style={styles.stateText}>{t('details.noEpisodes')}</Text>
      ) : null}

      {!loading && !failed && season?.episodes.length ? (
        <View style={styles.episodeList}>
          {season.episodes.map((episode, index) => {
            const progress = watchProgress
              ? findWatchProgressRecord(watchProgress.records, {
                mediaId: episode.id,
                kind: 'episode',
                title: episode.title,
                externalIds: series.externalIds,
                seriesId: series.id,
                seasonNumber: episode.seasonNumber,
                episodeNumber: episode.episodeNumber,
              })
              : undefined;
            const progressPercent = progress && progress.durationSeconds > 0
              ? Math.max(0, Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100))
              : 0;
            const completed = progress ? isPlaybackCompleted(progress) : false;

            return (
            <Pressable
              key={`${episode.id}:${episode.seasonNumber}:${episode.episodeNumber}:${index}`}
              testID={`episode-${episode.seasonNumber}-${episode.episodeNumber}`}
              focusable
              onPress={() => { if (episode.id.trim()) void playEpisode(series, { ...episode, id: episode.id.trim(), title: episode.title.trim() }); }}
              style={({ focused, pressed }) => [styles.episodeRow, focused && styles.focused, pressed && styles.pressed]}
            >
              {episode.stillUrl ? (
                <Image
                  testID={`episode-still-${episode.seasonNumber}-${episode.episodeNumber}`}
                  source={{ uri: episode.stillUrl }}
                  resizeMode="cover"
                  style={styles.episodeStill}
                />
              ) : null}
              <View style={styles.episodeNumberBox}>
                <Text style={styles.episodeNumber}>{episode.episodeNumber}</Text>
              </View>
              <View style={styles.episodeBody}>
                <Text style={styles.episodeTitle}>{episode.title}</Text>
                <View style={styles.episodeMeta}>
                  {Number.isFinite(episode.runtimeMinutes) && episode.runtimeMinutes! > 0 && episode.runtimeMinutes! <= 10000 ? (
                    <Text style={styles.metaText}>{Math.round(episode.runtimeMinutes!)} {t('common.minutes')}</Text>
                  ) : null}
                  {typeof episode.airDate === 'string' && episode.airDate.trim() && episode.airDate.length <= 64 ? <Text style={styles.metaText}>{episode.airDate.trim()}</Text> : null}
                </View>
                {episode.overview ? <Text style={styles.overview} numberOfLines={3}>{episode.overview}</Text> : null}
                {progress && progressPercent > 0 ? (
                  <View testID={`episode-progress-${episode.seasonNumber}-${episode.episodeNumber}`} style={styles.episodeProgress}>
                    <View style={styles.episodeProgressTrack}>
                      <View
                        style={[
                          styles.episodeProgressFill,
                          {
                            width: `${completed ? 100 : progressPercent}%` as `${number}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.episodeProgressText}>
                      {completed ? '✓' : `${Math.round(progressPercent)}%`}
                    </Text>
                  </View>
                ) : null}
              </View>
              {onDownloadEpisode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('playback.download')}
                  testID={`download-episode-${episode.seasonNumber}-${episode.episodeNumber}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    if (episode.id.trim()) onDownloadEpisode({ ...episode, id: episode.id.trim(), title: episode.title.trim() });
                  }}
                  style={({ focused, pressed }) => [
                    styles.episodeDownloadButton,
                    focused && styles.focused,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.episodeDownloadText}>
                    {downloadingEpisodeId === episode.id ? '…' : '↓'}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  section: {
    marginTop: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
    backgroundColor: 'transparent',
  },
  sectionTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '900', marginBottom: theme.spacing.md },
  seasonRow: { gap: theme.spacing.sm, paddingBottom: theme.spacing.md },
  seasonButton: {
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  seasonButtonSelected: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  seasonText: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  seasonTextSelected: { color: theme.colors.background },
  stateBox: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  stateText: { color: theme.colors.muted, fontSize: 14, textAlign: 'center' },
  retry: { borderRadius: theme.radius.pill, borderWidth: 2, borderColor: theme.colors.border, paddingHorizontal: 16, paddingVertical: 9 },
  retryText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  episodeList: { gap: 10 },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: 12,
  },
  episodeStill: {
    // Proportional, not fixed: at 176 px on a phone this plus the download
    // button left about 70 px for the title, so it wrapped one word per line.
    width: '34%',
    maxWidth: 176,
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
  },
  episodeNumberBox: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
  },
  episodeNumber: { color: theme.colors.accentSoft, fontSize: 14, fontWeight: '900' },
  episodeBody: { flex: 1, minWidth: 0 },
  episodeDownloadButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  episodeDownloadText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  episodeTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  episodeMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md, marginTop: 4 },
  metaText: { color: theme.colors.muted, fontSize: 12, fontWeight: '700' },
  overview: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  episodeProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  episodeProgressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: theme.colors.border,
  },
  episodeProgressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  episodeProgressText: {
    minWidth: 32,
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'right',
  },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
});
