import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useThemeStyles } from '../theme/ThemeProvider';
import { useAddons } from './useAddons';
import { quickstartFor, type QuickstartAddon } from './quickstartAddons';
import type { ProviderKind } from './AddProviderScreen';

type ItemState = 'idle' | 'working' | 'installed' | 'failed';

/**
 * One-tap installs for the two add-ons that make a fresh install usable.
 *
 * It goes through the normal inspect → install path, so the manifest is still
 * validated exactly as if the URL had been pasted by hand; the only thing this
 * saves is typing and getting the URL right.
 */
export function QuickstartAddons({ kind }: { kind: ProviderKind }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { t } = useI18n();
  const addons = useAddons();
  const [states, setStates] = useState<Record<string, ItemState>>({});

  const presets = quickstartFor(kind);
  const installedIds = new Set(addons.installed.map((record) => record.installed.addonId));

  const install = useCallback(async (preset: QuickstartAddon) => {
    setStates((current) => ({ ...current, [preset.id]: 'working' }));
    try {
      const inspected = await addons.inspectManifest(preset.url);
      await addons.install(inspected, {});
      setStates((current) => ({ ...current, [preset.id]: 'installed' }));
    } catch {
      setStates((current) => ({ ...current, [preset.id]: 'failed' }));
    }
  }, [addons]);

  if (presets.length === 0) return null;

  return (
    <View testID="quickstart-addons" style={styles.card}>
      <Text style={styles.title}>{t('quickstart.title')}</Text>
      <Text style={styles.detail}>{t('quickstart.detail')}</Text>

      {presets.map((preset) => {
        const state = states[preset.id] ?? (installedIds.has(preset.id) ? 'installed' : 'idle');
        const busy = state === 'working';
        return (
          <View key={preset.id} testID={`quickstart-${preset.id}`} style={styles.row}>
            <Ionicons name={preset.icon} size={18} color={theme.colors.muted} />
            <View style={styles.copy}>
              <Text style={styles.name}>{t(preset.titleKey)}</Text>
              <Text style={styles.rowDetail}>{t(preset.detailKey)}</Text>
            </View>

            {state === 'installed' ? (
              <View style={styles.badge} testID={`quickstart-${preset.id}-installed`}>
                <Ionicons name="checkmark" size={13} color={theme.colors.text} />
                <Text style={styles.badgeText}>{t('quickstart.installed')}</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                testID={`quickstart-${preset.id}-install`}
                onPress={() => { void install(preset); }}
                style={({ pressed }) => [
                  styles.button,
                  busy && styles.disabled,
                  pressed && !busy && styles.pressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={theme.colors.onAccent} />
                ) : (
                  <Text style={styles.buttonText}>
                    {state === 'failed' ? t('quickstart.retry') : t('quickstart.install')}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  title: { color: theme.colors.text, fontFamily: fontFamily.displayBold, fontSize: 18 },
  detail: { color: theme.colors.muted, fontFamily: fontFamily.ui, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, gap: 1 },
  name: { color: theme.colors.text, fontFamily: fontFamily.uiSemiBold, fontSize: 14 },
  rowDetail: { color: theme.colors.muted, fontFamily: fontFamily.ui, fontSize: 11 },
  button: {
    minWidth: 84,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
  },
  buttonText: { color: theme.colors.onAccent, fontFamily: fontFamily.uiSemiBold, fontSize: 13 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceElevated,
  },
  badgeText: { color: theme.colors.text, fontFamily: fontFamily.uiMedium, fontSize: 11 },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.75 },
});
