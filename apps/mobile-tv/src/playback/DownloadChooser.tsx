import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { StreamSource } from '@moviestv/core';
import { fontFamily, type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { canDownloadSource } from './downloadSource';
import { useThemeStyles } from '../theme/ThemeProvider';

interface DownloadChooserProps {
  sources: readonly StreamSource[];
  selectedSourceId: string | null;
  onSelect(source: StreamSource): void;
  onClose(): void;
}

function formatBytes(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

/**
 * Asks which quality to download before starting, showing the size where it can
 * be known.
 *
 * A provider rarely declares a size, so the size is probed with a `HEAD` request
 * when it is missing. That is honest: if the header is absent the row says the
 * size is unknown rather than inventing a number, and the download still works.
 */
export function DownloadChooser({
  sources,
  selectedSourceId,
  onSelect,
  onClose,
}: DownloadChooserProps) {
  const { t } = useI18n();
  const styles = useThemeStyles(createStyles);
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0, right: 0, bottom: 0, left: 0,
  };
  const [probed, setProbed] = useState<Record<string, number | null>>({});

  const downloadable = sources.filter((source) => canDownloadSource(source));

  const probe = useCallback(async (source: StreamSource) => {
    if (source.sizeBytes && source.sizeBytes > 0) return;
    setProbed((current) => (source.id in current ? current : { ...current, [source.id]: null }));
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
      const response = await fetch(source.url, {
        method: 'HEAD',
        headers: source.headers ?? {},
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timer) clearTimeout(timer);
      const length = Number(response.headers.get('content-length'));
      setProbed((current) => ({
        ...current,
        [source.id]: Number.isFinite(length) && length > 0 ? length : null,
      }));
    } catch {
      setProbed((current) => ({ ...current, [source.id]: null }));
    }
  }, []);

  useEffect(() => {
    for (const source of downloadable) void probe(source);
    // Probe once per source list; sizes do not change while the sheet is open.
  }, [sources]);

  return (
    <View
      style={[
        styles.sheet,
        {
          paddingTop: safeInsetEdge(16, safeAreaInsets.top, 8),
          paddingRight: safeInsetEdge(18, safeAreaInsets.right, 8),
          paddingBottom: safeInsetEdge(18, safeAreaInsets.bottom, 8),
          paddingLeft: safeInsetEdge(18, safeAreaInsets.left, 8),
        },
      ]}
      testID="download-chooser"
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{t('downloads.chooseQuality')}</Text>
          <Text style={styles.subtitle}>{t('downloads.chooseQualityHint')}</Text>
        </View>
        <Pressable
          focusable
          onPress={onClose}
          style={({ focused, pressed }) => [
            styles.closeButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.closeText}>{t('playback.close')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {downloadable.length === 0 ? (
          <Text style={styles.empty}>{t('downloads.nothingDownloadable')}</Text>
        ) : null}
        {downloadable.map((source, index) => {
          const size = formatBytes(source.sizeBytes) ?? formatBytes(probed[source.id] ?? undefined);
          const selected = source.id === selectedSourceId;
          return (
            <Pressable
              key={source.id}
              testID={`download-source-${source.id}`}
              focusable
              onPress={() => onSelect(source)}
              style={({ focused, pressed }) => [
                styles.row,
                selected && styles.rowSelected,
                focused && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {source.quality ?? source.name ?? `${t('playback.source')} ${index + 1}`}
                </Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {[source.providerId, size ?? t('downloads.sizeUnknown')].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={styles.rowCta}>{t('downloads.start')}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1200,
    maxHeight: '74%',
    backgroundColor: 'rgba(12,12,15,0.985)',
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: {
    color: theme.colors.text,
    fontFamily: fontFamily.displayBold,
    fontSize: 22,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    marginTop: 4,
  },
  closeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  closeText: { color: theme.colors.text, fontFamily: fontFamily.uiMedium, fontSize: 13 },
  list: { gap: 8 },
  empty: { color: theme.colors.muted, fontFamily: fontFamily.ui, fontSize: 13, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  rowSelected: { borderColor: theme.colors.accent },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: theme.colors.text, fontFamily: fontFamily.uiSemiBold, fontSize: 15 },
  rowMeta: { color: theme.colors.subtle, fontFamily: fontFamily.ui, fontSize: 12, marginTop: 2 },
  rowCta: { color: theme.colors.accentSoft, fontFamily: fontFamily.uiSemiBold, fontSize: 13 },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.8 },
});
