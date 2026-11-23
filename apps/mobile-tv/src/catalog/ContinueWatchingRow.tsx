import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WatchProgressRecord } from '@moviestv/sync';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useThemeStyles } from '../theme/ThemeProvider';

function percent(record: WatchProgressRecord): number {
  if (!Number.isFinite(record.durationSeconds) || record.durationSeconds <= 0 || !Number.isFinite(record.positionSeconds)) return 0;
  return Math.max(0, Math.min(100, (Math.max(0, record.positionSeconds) / record.durationSeconds) * 100));
}

function timeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
}

export function ContinueWatchingRow({
  records,
  onResume,
}: {
  records: readonly WatchProgressRecord[];
  onResume(record: WatchProgressRecord): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const visibleRecords = records.filter((record) => record.mediaId?.trim() && record.title?.trim()).slice(0, 50);
  if (!visibleRecords.length) return null;

  return (
    <View testID="continue-watching-row" style={styles.row}>
      <Text style={styles.heading}>{t('continueWatching.title')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {visibleRecords.map((record, index) => {
          const progress = percent(record);
          return (
            <Pressable
              key={`${record.kind}:${record.mediaId}:${record.seasonNumber ?? ''}:${record.episodeNumber ?? ''}:${index}`}
              accessibilityRole="button"
              focusable
              testID={`continue-watching-${record.mediaId}`}
              onPress={() => onResume(record)}
              style={({ focused, pressed }) => [
                styles.card,
                focused && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              {record.posterUrl ? (
                <Image source={{ uri: record.posterUrl }} resizeMode="cover" style={styles.poster} />
              ) : (
                <View style={styles.fallback}>
                  <Text style={styles.fallbackLetter}>{record.title.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.resumeBadge}>
                <Ionicons name="play" size={12} color="#ffffff" />
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress}%` as `${number}%` },
                  ]}
                />
              </View>
              <Text numberOfLines={1} style={styles.title}>{record.title}</Text>
              <Text style={styles.meta}>
                {Math.round(progress)}%{Number.isFinite(record.positionSeconds) && record.positionSeconds > 0 ? ` · ${timeLabel(record.positionSeconds)}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  row: { marginBottom: 40 },
  heading: {
    color: theme.colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.35,
    paddingHorizontal: '4%',
    marginBottom: 12,
  },
  cards: { gap: 14, paddingLeft: '4%', paddingRight: 32 },
  card: {
    width: 252,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    paddingBottom: 5,
  },
  poster: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 12,
  },
  fallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 12,
  },
  fallbackLetter: { color: theme.colors.accent, fontSize: 40, fontWeight: '900' },
  resumeBadge: {
    position: 'absolute',
    zIndex: 5,
    right: 10,
    top: 10,
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,8,10,0.72)',
  },
  resumeIcon: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  progressTrack: {
    height: 4,
    marginTop: -4,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  progressFill: { height: 4, backgroundColor: theme.colors.accent },
  title: { color: theme.colors.text, fontSize: 14, fontWeight: '900', marginTop: 9, paddingHorizontal: 2 },
  meta: { color: theme.colors.muted, fontSize: 10, fontWeight: '700', marginTop: 3, paddingHorizontal: 2 },
  focused: { borderColor: theme.colors.focus, transform: [{ scale: 1.03 }] },
  pressed: { opacity: 0.72 },
});
