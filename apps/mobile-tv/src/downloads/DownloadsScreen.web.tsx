import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useDownloadManager } from './useDownloadManager';
import { useThemeStyles } from '../theme/ThemeProvider';

function labels(t: (key: string) => string) {
  return {
    title: t('downloads.title'),
    body: t('downloads.webBody'),
    recent: t('downloads.recent'),
    completed: t('downloads.completed'),
    failed: t('downloads.failed'),
    dismiss: t('downloads.dismiss'),
  };
}

export function DownloadsScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const manager = useDownloadManager();
  const copy = labels(t);

  return (
    <ScrollView
      testID="downloads-screen"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.button}>
          <Text style={styles.buttonText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{copy.title}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.body}>{copy.body}</Text>
      </View>

      {manager.jobs.length ? (
        <View style={styles.recent}>
          <Text style={styles.sectionTitle}>{copy.recent}</Text>
          {manager.jobs.map((job) => (
            <View key={job.id} style={styles.row}>
              <View style={styles.rowCopy}>
                <Text numberOfLines={2} style={styles.jobTitle}>{job.title}</Text>
                <Text style={styles.jobMeta}>
                  {job.status === 'error'
                    ? `${copy.failed}${job.error ? ` · ${job.error}` : ''}`
                    : job.status === 'completed'
                      ? copy.completed
                      : job.progress !== null
                        ? `${Math.round(job.progress * 100)}%`
                        : t('common.loading')}
                </Text>
              </View>
              <Pressable
                onPress={() => manager.dismiss(job.id)}
                style={styles.dismissButton}
              >
                <Text style={styles.dismissText}>{copy.dismiss}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.lg },
  title: { flex: 1, color: theme.colors.text, fontSize: 30, fontWeight: '900' },
  button: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  card: { padding: theme.spacing.lg, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  body: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 },
  recent: { gap: 10, marginTop: 24 },
  sectionTitle: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  rowCopy: { flex: 1 },
  jobTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '900' },
  jobMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 4 },
  dismissButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.colors.surfaceElevated },
  dismissText: { color: theme.colors.text, fontSize: 10, fontWeight: '900' },
});
