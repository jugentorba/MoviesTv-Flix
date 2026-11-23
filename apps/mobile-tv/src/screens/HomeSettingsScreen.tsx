import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCatalog } from '../catalog/useCatalog';
import { useAccount } from '../auth/useAccount';
import { useProfiles } from '../profiles/useProfiles';
import { useI18n } from '../i18n/useI18n';
import { type Theme, fontFamily } from '@moviestv/ui';
import { SettingsCard, SettingsPage } from '../components/SettingsPage';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';
import {
  EMPTY_HOME_LAYOUT,
  moveRow,
  readHomeLayout,
  toggleRow,
  writeHomeLayout,
  type HomeLayout,
} from '../catalog/homeLayout';

interface RowSummary {
  id: string;
  title: string;
}

/**
 * Reorder and hide the rows the home screen shows.
 *
 * The list comes from the catalog service's sections (already cached from the
 * last home render), so opening this page costs no network.
 */
export function HomeSettingsScreen({ onBack }: { onBack(): void }) {
  const { t } = useI18n();
  const { service } = useCatalog();
  const account = useAccount();
  const { activeProfile } = useProfiles();
  const theme = useTheme();
  const styles = useThemeStyles(createStyles);

  const scope = `${account.userId ?? 'guest'}:${activeProfile?.id ?? 'main'}`;
  const [layout, setLayout] = useState<HomeLayout>(EMPTY_HOME_LAYOUT);
  const [rows, setRows] = useState<RowSummary[]>([]);

  useEffect(() => {
    let active = true;
    void readHomeLayout(scope).then((stored) => { if (active) setLayout(stored); });
    return () => { active = false; };
  }, [scope]);

  useEffect(() => {
    let active = true;
    void service.getSections()
      .then((sections) => {
        if (!active) return;
        setRows([
          // The synthetic row the app builds itself; it is a home row like any
          // other, so it can be moved or hidden from here too.
          { id: 'continue-watching', title: t('continueWatching.title') },
          ...sections
            .filter((section) => section.title?.trim())
            .map((section) => ({ id: section.id, title: section.title.trim() })),
        ]);
      })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [service, t]);

  const orderedRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const known = layout.order.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    const rest = rows.filter((row) => !layout.order.includes(row.id));
    return [...known, ...rest];
  }, [layout.order, rows]);

  const persist = useCallback((next: HomeLayout) => {
    setLayout(next);
    void writeHomeLayout(scope, next);
  }, [scope]);

  return (
    <SettingsPage
      testID="home-layout-screen"
      eyebrow={t('homeLayout.eyebrow')}
      title={t('homeLayout.title')}
      intro={t('homeLayout.intro')}
      backLabel={t('nav.settings')}
      onBack={onBack}
      closeLabel={t('playback.close')}
      onClose={onBack}
    >
      <SettingsCard>
        {orderedRows.length === 0 ? (
          <Text style={styles.empty}>{t('homeLayout.empty')}</Text>
        ) : null}
        {orderedRows.map((row, index) => {
          const hidden = layout.hidden.includes(row.id);
          const first = index === 0;
          const last = index === orderedRows.length - 1;
          return (
            <View key={row.id} testID={`home-row-${row.id}`} style={styles.row}>
              <Text numberOfLines={1} style={styles.rowTitle}>{row.title}</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('homeLayout.moveUp')}
                accessibilityState={{ disabled: first }}
                disabled={first}
                testID={`home-row-up-${row.id}`}
                onPress={() => persist(moveRow(layout, orderedRows.map((entry) => entry.id), row.id, 'up'))}
                style={({ pressed }) => [styles.iconButton, first && styles.disabled, pressed && styles.pressed]}
              >
                <Ionicons name="chevron-up" size={18} color={theme.colors.text} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('homeLayout.moveDown')}
                accessibilityState={{ disabled: last }}
                disabled={last}
                testID={`home-row-down-${row.id}`}
                onPress={() => persist(moveRow(layout, orderedRows.map((entry) => entry.id), row.id, 'down'))}
                style={({ pressed }) => [styles.iconButton, last && styles.disabled, pressed && styles.pressed]}
              >
                <Ionicons name="chevron-down" size={18} color={theme.colors.text} />
              </Pressable>

              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: !hidden }}
                accessibilityLabel={hidden ? t('homeLayout.show') : t('homeLayout.hide')}
                testID={`home-row-toggle-${row.id}`}
                onPress={() => persist(toggleRow(layout, row.id))}
                style={({ pressed }) => [
                  styles.visibility,
                  hidden && styles.visibilityOff,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={hidden ? 'eye-off-outline' : 'eye-outline'}
                  size={16}
                  color={hidden ? theme.colors.muted : theme.colors.text}
                />
              </Pressable>
            </View>
          );
        })}
      </SettingsCard>

      <Pressable
        accessibilityRole="button"
        testID="home-layout-reset"
        onPress={() => persist(EMPTY_HOME_LAYOUT)}
        style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
      >
        <Text style={styles.resetText}>{t('homeLayout.reset')}</Text>
      </Pressable>
    </SettingsPage>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: {
    flex: 1,
    color: theme.colors.text,
    fontFamily: fontFamily.uiMedium,
    fontSize: 14,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
  },
  visibility: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  visibilityOff: { borderColor: theme.colors.borderStrong },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.65 },
  empty: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 13,
  },
  reset: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  resetText: { color: theme.colors.text, fontFamily: fontFamily.uiSemiBold, fontSize: 13 },
});
