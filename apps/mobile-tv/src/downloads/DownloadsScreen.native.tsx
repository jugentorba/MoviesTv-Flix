import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { StreamSource } from '@moviestv/core';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useAccount } from '../auth/useAccount';
import { useI18n } from '../i18n/useI18n';
import { VideoSurface } from '../playback/VideoSurface';
import { usePreferences } from '../preferences/usePreferences';
import { beginImmersiveSurface } from '../playback/immersiveSurface';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useDownloadManager, type DownloadJob } from './useDownloadManager';
import { formatTransferSummary } from './downloadTransfer';
import {
  OFFLINE_METADATA_SUFFIX,
  OFFLINE_PARTIAL_SUFFIX,
  canReadOfflineMetadataFile,
  offlineEpisodeCode,
  offlineMetadataFileName,
  offlineMetadataMatchesFile,
  parseOfflineDownloadMetadata,
  type OfflineDownloadMetadata,
} from './offlineDownloadMetadata';
import {
  offlineDownloadScope,
  offlineDownloadScopePath,
  type OfflineDownloadScope,
} from './offlineDownloadScope';
import { useThemeStyles } from '../theme/ThemeProvider';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';

interface OfflineDownloadItem {
  file: File;
  metadata: OfflineDownloadMetadata | null;
}

export function isActiveNativeDownloadFile(
  fileName: string,
  jobs: readonly DownloadJob[],
): boolean {
  const normalized = fileName.trim();
  if (!normalized) return false;
  return jobs.some((job) => (
    (job.status === 'downloading' || job.status === 'paused')
    && job.localFileName === normalized
  ));
}

export function isOfflineLibraryFileName(fileName: string): boolean {
  return Boolean(
    fileName
    && !fileName.endsWith(OFFLINE_METADATA_SUFFIX)
    && !fileName.endsWith(OFFLINE_PARTIAL_SUFFIX)
  );
}

const MAX_OFFLINE_DOWNLOAD_ITEMS = 2_000;

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function displayName(name: string): string {
  return name
    .replace(/^\d{13}-/, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '');
}

function labels(t: (key: string) => string) {
  return {
    title: t('downloads.title'),
    empty: t('downloads.empty'),
    delete: t('downloads.delete'),
    close: t('downloads.close'),
    movie: t('downloads.movie'),
    episode: t('downloads.episode'),
    active: t('downloads.active'),
    failed: t('downloads.failed'),
    dismiss: t('downloads.dismiss'),
    pause: t('downloads.pause'),
    resume: t('downloads.resume'),
    cancel: t('downloads.cancel'),
    paused: t('downloads.paused'),
  };
}

function downloadDirectory(scope: OfflineDownloadScope): Directory {
  const directory = new Directory(
    Paths.document,
    ...offlineDownloadScopePath(scope),
  );
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

function readItem(directory: Directory, file: File): OfflineDownloadItem {
  try {
    const metadataFile = new File(
      directory,
      offlineMetadataFileName(file.name),
    );
    const parsed = (
      metadataFile.exists
      && canReadOfflineMetadataFile(metadataFile.size)
    )
      ? parseOfflineDownloadMetadata(metadataFile.textSync())
      : null;
    const metadata = offlineMetadataMatchesFile(parsed, file.name)
      ? parsed
      : null;
    return { file, metadata };
  } catch {
    // Keep legacy/user-created files visible even if their names cannot have
    // a valid MoviesTv-Flix sidecar on this filesystem.
    return { file, metadata: null };
  }
}

function itemTitle(item: OfflineDownloadItem): string {
  return item.metadata?.title ?? displayName(item.file.name);
}

function itemDetails(
  item: OfflineDownloadItem,
  copy: ReturnType<typeof labels>,
): string {
  const { metadata, file } = item;
  if (!metadata) return formatBytes(file.size);

  const kind = metadata.kind === 'episode'
    ? [
        copy.episode,
        offlineEpisodeCode(metadata) ?? null,
      ].filter(Boolean).join(' ')
    : metadata.kind === 'movie'
      ? copy.movie
      : null;

  return [
    kind,
    metadata.year,
    metadata.quality,
    metadata.audioLanguage?.toUpperCase(),
    metadata.providerId,
    formatBytes(file.size || metadata.sourceSizeBytes),
  ].filter(Boolean).join(' · ');
}


/** "1.2 GB", "840 MB" — used for size and for the rate. */

export function DownloadsScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const { userId } = useAccount();
  const { preferences } = usePreferences();
  const downloadManager = useDownloadManager();
  const downloadScope = useMemo(
    () => offlineDownloadScope(userId),
    [userId],
  );
  const copy = labels(t);
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [items, setItems] = useState<OfflineDownloadItem[]>([]);
  const [selected, setSelected] = useState<OfflineDownloadItem | null>(null);
  // One gesture, two meanings: close the film, or leave the screen.
  const selectedRef = useRef<OfflineDownloadItem | null>(null);
  selectedRef.current = selected;
  const swipeHandlers = useSwipeBack(() => {
    if (selectedRef.current) setSelected(null);
    else onBack();
  });

  /**
   * The offline player takes over the screen the way the main player does:
   * status bar hidden and the tab bar collapsed. Without this the player was a
   * strip inside the Downloads list, above a permanent header and under the
   * tab bar, which is what made a downloaded film look like it did not fit.
   */
  useEffect(() => {
    if (!selected) return undefined;
    StatusBar.setHidden(true, 'fade');
    const release = beginImmersiveSurface();
    return () => {
      release();
      StatusBar.setHidden(false, 'fade');
    };
  }, [selected]);

  const reload = useCallback(() => {
    try {
      const directory = downloadDirectory(downloadScope);
      const downloads = directory
        .list()
        .filter((entry): entry is File => (
          entry instanceof File
          && isOfflineLibraryFileName(entry.name)
        ))
        .sort((left, right) => (
          (right.lastModified ?? 0) - (left.lastModified ?? 0)
        ))
        .slice(0, MAX_OFFLINE_DOWNLOAD_ITEMS)
        .map((file) => readItem(directory, file));
      setItems(downloads);
    } catch {
      // Filesystem access can fail temporarily (permissions, storage mount,
      // damaged directory). Keep the screen usable instead of crashing.
      setItems([]);
      setSelected(null);
    }
  }, [downloadScope]);

  useEffect(() => {
    // The download directory is account-scoped. Close any file selected from
    // the previous identity before loading the next account's directory.
    setSelected(null);
    reload();
  }, [reload]);

  useEffect(() => {
    const completed = downloadManager.jobs.filter((job) => job.status === 'completed');
    if (!completed.length) return;
    reload();
    completed.forEach((job) => downloadManager.dismiss(job.id));
  }, [downloadManager, reload]);

  const activeJobs = downloadManager.jobs.filter((job) => job.status !== 'completed');
  const completedItems = useMemo(
    () => items.filter((item) => !isActiveNativeDownloadFile(
      item.file.name,
      downloadManager.jobs,
    )),
    [downloadManager.jobs, items],
  );

  if (selected) {
    const source: StreamSource = {
      id: selected.file.uri,
      url: selected.file.uri,
      name: selected.file.name,
      ...(selected.metadata?.quality ? { quality: selected.metadata.quality } : {}),
      ...(selected.metadata?.providerId ? { providerId: selected.metadata.providerId } : {}),
      ...(selected.metadata?.audioLanguage
        ? { language: selected.metadata.audioLanguage }
        : {}),
    };
    return (
      <View testID="offline-download-player" style={styles.playerScreen} {...swipeHandlers}>
        <View style={styles.player}>
          <VideoSurface
            source={source}
            testID="offline-video"
            preferredAudioLanguages={preferences.preferredAudioLanguages}
            preferredSubtitleLanguages={preferences.preferredSubtitleLanguages}
            embeddedSubtitlesEnabled={preferences.subtitlesEnabled}
          />
        </View>
        <View
          style={[
            styles.playerHeader,
            {
              // Floats over the film, so it must clear the Dynamic Island.
              paddingTop: Math.max(12, safeInsetEdge(12, safeAreaInsets.top, 8)),
              paddingLeft: safeInsetEdge(14, safeAreaInsets.left, 10),
              paddingRight: safeInsetEdge(14, safeAreaInsets.right, 10),
            },
          ]}
        >
          <Pressable onPress={() => setSelected(null)} style={styles.button}>
            <Text style={styles.buttonText}>{copy.close}</Text>
          </Pressable>
          <View style={styles.playerHeading}>
            <Text numberOfLines={1} style={styles.playerTitle}>{itemTitle(selected)}</Text>
            <Text numberOfLines={1} style={styles.playerMeta}>{itemDetails(selected, copy)}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View testID="downloads-screen" style={styles.screen} {...swipeHandlers}>
      <View style={styles.header}>
        <IconBackButton
          label={t('common.back')}
          onPress={onBack}
          testID="downloads-back"
        />
        <Text style={styles.title}>{copy.title}</Text>
      </View>

      {completedItems.length === 0 && activeJobs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{copy.empty}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {activeJobs.length ? (
            <View style={styles.activeSection}>
              <Text style={styles.sectionTitle}>{copy.active}</Text>
              {activeJobs.map((job) => (
                <View key={job.id} testID={`download-job-${job.id}`} style={styles.activeRow}>
                  <View style={styles.playBadge}>
                    <Text style={styles.playBadgeText}>
                      {job.status === 'error' ? '!' : '↓'}
                    </Text>
                  </View>
                  <View style={styles.fileCopy}>
                    <Text numberOfLines={2} style={styles.fileName}>{job.title}</Text>
                    <Text numberOfLines={2} style={styles.fileMeta}>
                      {job.status === 'error'
                        ? `${copy.failed}${job.error ? ` · ${job.error}` : ''}`
                        : [
                          job.quality,
                          job.providerId,
                          job.status === 'paused'
                            ? copy.paused
                            : job.progress !== null
                              ? `${Math.round(job.progress * 100)}%`
                              : copy.active,
                        ].filter(Boolean).join(' · ')}
                    </Text>
                    {job.status === 'downloading' && formatTransferSummary(job) ? (
                      <Text testID={`download-detail-${job.id}`} numberOfLines={1} style={styles.fileTransfer}>
                        {formatTransferSummary(job)}
                      </Text>
                    ) : null}
                    {job.status === 'downloading' || job.status === 'paused' ? (
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${Math.round((job.progress ?? 0) * 100)}%` },
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                  {job.status === 'error' ? (
                    <Pressable
                      testID={`download-dismiss-${job.id}`}
                      onPress={() => downloadManager.dismiss(job.id)}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteText}>{copy.dismiss}</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.jobActions}>
                      <Pressable
                        testID={job.status === 'paused'
                          ? `download-resume-${job.id}`
                          : `download-pause-${job.id}`}
                        onPress={() => {
                          if (job.status === 'paused') {
                            void downloadManager.resume(job.id);
                          } else {
                            void downloadManager.pause(job.id);
                          }
                        }}
                        style={styles.controlButton}
                      >
                        <Text style={styles.controlText}>
                          {job.status === 'paused' ? copy.resume : copy.pause}
                        </Text>
                      </Pressable>
                      <Pressable
                        testID={`download-cancel-${job.id}`}
                        onPress={() => downloadManager.cancel(job.id)}
                        style={styles.deleteButton}
                      >
                        <Text style={styles.deleteText}>{copy.cancel}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {completedItems.map((item) => (
            <Pressable
              key={item.file.uri}
              focusable
              onPress={() => setSelected(item)}
              style={({ focused, pressed }) => [
                styles.row,
                focused && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.playBadge}>
                <Text style={styles.playBadgeText}>▶</Text>
              </View>
              <View style={styles.fileCopy}>
                <Text numberOfLines={2} style={styles.fileName}>{itemTitle(item)}</Text>
                <Text numberOfLines={2} style={styles.fileMeta}>{itemDetails(item, copy)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={(event) => {
                  event.stopPropagation();
                  try {
                    const directory = downloadDirectory(downloadScope);
                    try {
                      const metadataFile = new File(
                        directory,
                        offlineMetadataFileName(item.file.name),
                      );
                      if (metadataFile.exists) metadataFile.delete();
                    } catch {
                      // The video itself can still be removed when an old file
                      // name is too long/invalid for a sidecar filename.
                    }
                    if (item.file.exists) item.file.delete();
                  } catch {
                    // Keep an undeletable item visible so the user can retry
                    // instead of crashing the Downloads screen.
                  } finally {
                    reload();
                  }
                }}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteText}>{copy.delete}</Text>
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.lg },
  title: { flex: 1, color: theme.colors.text, fontSize: 30, fontWeight: '900' },
  button: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  list: { gap: theme.spacing.sm, paddingBottom: 90 },
  activeSection: { gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  sectionTitle: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  activeRow: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  row: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: theme.colors.surface,
  },
  playBadge: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: theme.colors.surfaceElevated,
  },
  playBadgeText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  fileCopy: { flex: 1 },
  fileName: { color: theme.colors.text, fontSize: 15, fontWeight: '900' },
  fileMeta: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  fileTransfer: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 11,
    marginTop: 3,
  },
  progressTrack: {
    height: 4,
    marginTop: 9,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceElevated,
  },
  progressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  jobActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  controlButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceElevated,
  },
  controlText: { color: theme.colors.text, fontSize: 12, fontWeight: '900' },
  deleteButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.colors.surfaceElevated },
  deleteText: { color: theme.colors.danger, fontSize: 12, fontWeight: '900' },
  empty: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: theme.colors.muted, fontSize: 16, fontWeight: '700' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
  playerScreen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#000000',
  },
  playerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingBottom: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(5,5,10,0.78)',
  },
  playerHeading: { flex: 1, minWidth: 0 },
  playerTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '900' },
  playerMeta: { color: theme.colors.muted, fontSize: 10, marginTop: 3 },
  player: { flex: 1, backgroundColor: '#000000' },
});
