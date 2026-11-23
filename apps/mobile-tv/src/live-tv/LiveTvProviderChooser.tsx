import React, { useContext } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useWebTvModalFocusRestore } from '../web/tvRemoteNavigation';
import { useThemeStyles } from '../theme/ThemeProvider';

export interface LiveTvProviderOption {
  id: string;
  name: string;
}

export function LiveTvProviderChooser({
  providers,
  preferredProviderId,
  activeProviderId,
  onSelect,
  onClose,
}: {
  providers: readonly LiveTvProviderOption[];
  preferredProviderId: string | null;
  activeProviderId: string | null;
  onSelect(providerId: string | null): void;
  onClose(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  useWebTvModalFocusRestore(true);

  const option = (
    id: string | null,
    name: string,
    index: number,
  ) => {
    const preferred = id === preferredProviderId;
    const active = id !== null && id === activeProviderId;
    return (
      <Pressable
        key={id ?? 'auto'}
        focusable
        accessibilityRole="button"
        accessibilityState={{ selected: preferred }}
        testID={
          id === null
            ? 'live-tv-provider-auto'
            : `live-tv-provider-option-${index}`
        }
        onPress={() => onSelect(id)}
        style={({ focused, pressed }) => [
          styles.option,
          preferred && styles.optionSelected,
          focused && styles.focused,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {active ? (
            <Text style={styles.active}>
              {t('liveTv.activeProvider')}
            </Text>
          ) : null}
        </View>
        {preferred ? (
          <Text style={styles.selected}>
            ✓ {t('playback.selected')}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View
      aria-modal={true}
      testID="live-tv-provider-chooser"
      style={[
        styles.sheet,
        {
          paddingTop: safeInsetEdge(18, safeAreaInsets.top, 8),
          paddingRight: safeInsetEdge(18, safeAreaInsets.right, 8),
          paddingBottom: safeInsetEdge(18, safeAreaInsets.bottom, 8),
          paddingLeft: safeInsetEdge(18, safeAreaInsets.left, 8),
        },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('common.provider')}</Text>
          <Text style={styles.subtitle}>
            {t('liveTv.providerFallback')}
          </Text>
        </View>
        <Pressable
          focusable
          accessibilityRole="button"
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
        {option(
          null,
          t('liveTv.autoProvider'),
          -1,
        )}
        {providers.map((provider, index) => (
          option(provider.id, provider.name, index)
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: '8%',
    bottom: '8%',
    left: '8%',
    right: '8%',
    zIndex: 1250,
    gap: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    backgroundColor: 'rgba(12,12,15,0.985)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  title: {
    color: theme.colors.text,
    fontSize: 25,
    fontWeight: '900',
  },
  subtitle: {
    maxWidth: 560,
    color: theme.colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  closeButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
  },
  closeText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  list: { gap: 10, paddingBottom: 20 },
  option: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
  },
  optionSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceElevated,
  },
  copy: { flex: 1 },
  name: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  active: {
    color: theme.colors.accentSoft,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  selected: {
    color: theme.colors.accentSoft,
    fontSize: 10,
    fontWeight: '900',
  },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
});
