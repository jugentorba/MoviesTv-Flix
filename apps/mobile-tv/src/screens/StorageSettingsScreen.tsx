import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fontFamily, type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import {
  clearCatalogCache,
  formatBytes,
  readDeviceStorage,
  type DeviceStorageBreakdown,
} from '../storage/deviceStorage';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

/**
 * Storage view.
 *
 * Only the catalog cache is clearable: preferences, add-ons, watch progress,
 * profiles and downloads are user data and must not be one tap from deletion.
 */
export function StorageSettingsScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { t } = useI18n();
  const insets = useContext(SafeAreaInsetsContext) ?? {
    top: 0, right: 0, bottom: 0, left: 0,
  };
  const [summary, setSummary] = useState<DeviceStorageBreakdown | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [freedBytes, setFreedBytes] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const next = await readDeviceStorage(AsyncStorage);
    setSummary(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh().catch(() => setSummary(null));
  }, [refresh]);

  const onClear = useCallback(async () => {
    setBusy(true);
    setConfirming(false);
    try {
      const freed = await clearCatalogCache(AsyncStorage);
      setFreedBytes(freed);
      await refresh();
    } catch {
      setFreedBytes(0);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const cacheBytes = summary?.catalogCacheBytes ?? 0;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: safeInsetEdge(24, insets.top, 10),
          paddingBottom: safeInsetEdge(110, insets.bottom, 88),
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          testID="storage-back"
          onPress={onBack}
          style={({ focused, pressed }) => [
            styles.backButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('storage.title')}</Text>
      </View>

      <Text style={styles.subtitle}>{t('storage.subtitle')}</Text>

      {summary === null ? (
        <ActivityIndicator style={styles.loading} color={theme.colors.accent} />
      ) : (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('storage.total')}</Text>
            <Text style={styles.rowValue}>{formatBytes(summary.totalBytes)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('storage.cache')}</Text>
            <Text style={styles.rowValue}>{formatBytes(summary.catalogCacheBytes)}</Text>
          </View>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.rowLabel}>{t('storage.userData')}</Text>
            <Text style={styles.rowValue}>{formatBytes(summary.userDataBytes)}</Text>
          </View>
        </View>
      )}

      <Text style={styles.note}>{t('storage.userDataNote')}</Text>

      {confirming ? (
        <View style={styles.confirmRow}>
          <Pressable
            accessibilityRole="button"
            testID="storage-clear-cancel"
            onPress={() => setConfirming(false)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryLabel}>{t('storage.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="storage-clear-confirm"
            onPress={() => { void onClear(); }}
            style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
          >
            <Text style={styles.dangerLabel}>{t('storage.confirm')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || cacheBytes === 0 }}
          testID="storage-clear-cache"
          disabled={busy || cacheBytes === 0}
          onPress={() => setConfirming(true)}
          style={({ focused, pressed }) => [
            styles.primaryButton,
            (busy || cacheBytes === 0) && styles.disabledButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.primaryLabel}>{t('storage.clearCache')}</Text>
          )}
        </Pressable>
      )}

      {freedBytes !== null ? (
        <Text testID="storage-result" style={styles.result}>
          {freedBytes > 0
            ? t('storage.cleared', { size: formatBytes(freedBytes) })
            : t('storage.nothingToClear')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingHorizontal: '5%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  title: {
    color: theme.colors.text,
    fontFamily: fontFamily.displayBold,
    fontSize: 28,
    letterSpacing: -0.6,
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  loading: { marginVertical: 30 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 14,
  },
  rowValue: {
    color: theme.colors.text,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 14,
  },
  note: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginBottom: 18,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
  },
  disabledButton: { opacity: 0.45 },
  primaryLabel: {
    color: theme.colors.onAccent,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
  },
  confirmRow: { flexDirection: 'row', gap: 10 },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryLabel: {
    color: theme.colors.text,
    fontFamily: fontFamily.uiMedium,
    fontSize: 15,
  },
  dangerButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger,
  },
  dangerLabel: {
    color: theme.colors.onAccent,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
  },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.8 },
  result: {
    color: theme.colors.success,
    fontFamily: fontFamily.uiMedium,
    fontSize: 13,
    marginTop: 12,
  },
});
