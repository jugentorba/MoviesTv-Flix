import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { WatchProgressRecord } from '@moviestv/sync';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { usePlayback } from '../playback/usePlayback';
import { useWatchProgress } from './useWatchProgress';
import {
  watchEpisodeCode,
  watchHistoryRecords,
  watchPositionMinutes,
  watchProgressFraction,
} from './watch-history-model';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

function RowButton({
  label,
  onPress,
  disabled = false,
  danger = false,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      focusable={!disabled}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        danger && styles.dangerButton,
        disabled && styles.disabled,
        focused && !disabled && styles.focused,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, danger && styles.dangerText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function WatchHistoryScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { t, direction } = useI18n();
  const watchProgress = useWatchProgress();
  const playback = usePlayback();
  const [busy, setBusy] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => watchHistoryRecords(watchProgress.records),
    [watchProgress.records],
  );

  const forget = async (record: WatchProgressRecord) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await watchProgress.forget(record);
      setMessage(t('watchHistory.removeDone'));
    } catch {
      setError(t('watchHistory.error'));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await watchProgress.forgetAll();
      setMessage(t('watchHistory.clearDone'));
      setConfirmingClear(false);
    } catch {
      setError(t('watchHistory.error'));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (record: WatchProgressRecord) => {
    if (busy) return;
    setError(null);
    setMessage(null);
    try {
      if (await playback.resumeProgress(record)) return;
      playback.closePlayback();
      setError(t('watchHistory.resumeFailed'));
    } catch {
      playback.closePlayback();
      setError(t('watchHistory.resumeFailed'));
    }
  };

  const status = watchProgress.status === 'syncing'
    ? t('watchHistory.syncing')
    : watchProgress.status === 'offline'
      ? t('watchHistory.offline')
      : null;

  return (
    <ScrollView
      testID="watch-history-screen"
      style={[styles.page, { direction }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <RowButton
          label={`‹ ${t('watchHistory.back')}`}
          onPress={onBack}
          testID="watch-history-back"
        />
        {rows.length ? (
          confirmingClear ? (
            <View style={styles.headerActions}>
              <RowButton
                label={t('watchHistory.cancelClear')}
                onPress={() => setConfirmingClear(false)}
                disabled={busy}
                testID="watch-history-clear-cancel"
              />
              <RowButton
                label={t('watchHistory.confirmClear')}
                onPress={() => { void clearAll(); }}
                disabled={busy}
                danger
                testID="watch-history-clear-confirm"
              />
            </View>
          ) : (
            <RowButton
              label={t('watchHistory.clearAll')}
              onPress={() => {
                setMessage(null);
                setError(null);
                setConfirmingClear(true);
              }}
              disabled={busy}
              danger
              testID="watch-history-clear"
            />
          )
        ) : null}
      </View>

      <Text style={styles.eyebrow}>{t('watchHistory.eyebrow')}</Text>
      <Text style={[styles.title, { writingDirection: direction }]}>
        {t('watchHistory.title')}
      </Text>
      <Text style={[styles.body, { writingDirection: direction }]}>
        {t('watchHistory.subtitle')}
      </Text>

      {message ? (
        <Text style={styles.success} testID="watch-history-message">
          {message}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {busy ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
      ) : null}

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>◷</Text>
          <Text style={styles.emptyText}>{t('watchHistory.empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((record) => {
            const fraction = watchProgressFraction(record);
            const minutes = watchPositionMinutes(record);
            const episodeCode = watchEpisodeCode(record);
            return (
              <View
                key={record.mediaId}
                testID={`watch-history-row-${record.mediaId}`}
                style={styles.row}
              >
                {record.posterUrl ? (
                  <Image
                    source={{ uri: record.posterUrl }}
                    style={styles.poster}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.poster, styles.posterFallback]}>
                    <Text style={styles.posterFallbackText}>
                      {record.kind === 'episode' ? 'TV' : '▶'}
                    </Text>
                  </View>
                )}

                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {record.title}
                  </Text>
                  <Text style={styles.rowDetail}>
                    {[
                      episodeCode,
                      record.completed
                        ? t('watchHistory.completed')
                        : minutes === undefined
                          ? undefined
                          : t('watchHistory.watched', { minutes }),
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.progressTrack}>
                    <View
                      testID={`watch-history-progress-${record.mediaId}`}
                      style={[
                        styles.progressFill,
                        { width: `${Math.round(fraction * 100)}%` },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.rowActions}>
                  <RowButton
                    label={t('watchHistory.remove')}
                    accessibilityLabel={t('watchHistory.removeLabel', { title: record.title })}
                    onPress={() => { void forget(record); }}
                    disabled={busy}
                    danger
                    testID={`watch-history-remove-${record.mediaId}`}
                  />
                  <RowButton
                    label={'▶'}
                    accessibilityLabel={record.title}
                    onPress={() => { void resume(record); }}
                    disabled={busy}
                    testID={`watch-history-resume-${record.mediaId}`}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 1000,
    alignSelf: 'center',
    paddingHorizontal: '6%',
    paddingTop: 26,
    paddingBottom: 110,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  eyebrow: {
    color: theme.colors.accentSoft,
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '900',
    marginTop: theme.spacing.xl,
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    marginTop: theme.spacing.sm,
  },
  body: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  list: { gap: theme.spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  poster: {
    width: 46,
    height: 68,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceElevated,
  },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  posterFallbackText: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
  rowDetail: { color: theme.colors.muted, fontSize: 13 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surfaceElevated,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  button: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
  },
  dangerButton: { borderColor: '#61252a' },
  buttonText: { color: theme.colors.text, fontWeight: '800' },
  dangerText: { color: theme.colors.danger },
  focused: { borderColor: theme.colors.accent, borderWidth: 2 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  success: {
    color: theme.colors.accentSoft,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    fontWeight: '700',
    marginBottom: theme.spacing.sm,
  },
  status: { color: theme.colors.muted, fontSize: 13, marginBottom: theme.spacing.sm },
  spinner: { marginBottom: theme.spacing.sm },
  empty: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xl * 2,
  },
  emptyIcon: { color: theme.colors.muted, fontSize: 34 },
  emptyText: { color: theme.colors.muted, fontSize: 15 },
});
