import React, { useContext } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fontFamily, type Theme } from '@moviestv/ui';
import { useAccount } from '../auth/useAccount';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

/**
 * Version, build, platform and — the part that matters for support — whether a
 * sync backend is actually configured and who is signed in.
 *
 * Everything here is read from the running app: no value is hardcoded, so the
 * page cannot claim a connection the app does not have.
 */
function backendHost(): string | null {
  const raw = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function platformLabel(): string {
  const version = String(Platform.Version ?? '');
  if (Platform.OS === 'ios') return `iOS ${version}`;
  if (Platform.OS === 'android') return `Android ${version}`;
  // On web `Platform.Version` reports the browser build number, which reads as
  // "0.0.0" in Chrome; the browser name is the useful fact instead.
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined') return 'Web';
    const agent = navigator.userAgent;
    const browser = /Edg\//.test(agent)
      ? 'Edge'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : '';
    return browser ? `Web · ${browser}` : 'Web';
  }
  return Platform.OS;
}

function buildNumber(): string {
  const config = Constants.expoConfig;
  const candidate = Platform.OS === 'ios'
    ? config?.ios?.buildNumber
    : config?.android?.versionCode;
  return candidate === undefined || candidate === null ? '—' : String(candidate);
}

function Row({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={17} color={theme.colors.accentSoft} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        numberOfLines={2}
        style={[
          styles.rowValue,
          tone === 'ok' && styles.rowValueOk,
          tone === 'warn' && styles.rowValueWarn,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function AboutScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const { t } = useI18n();
  const account = useAccount();
  const insets = useContext(SafeAreaInsetsContext) ?? {
    top: 0, right: 0, bottom: 0, left: 0,
  };
  const host = backendHost();
  const signedIn = Boolean(account.userId);

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
          testID="about-back"
          onPress={onBack}
          style={({ focused, pressed }) => [
            styles.backButton,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('about.title')}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t('about.buildSection')}</Text>
      <View style={styles.card}>
        <Row icon="pricetag-outline" label={t('about.version')} value={Constants.expoConfig?.version ?? '—'} />
        <Row icon="construct-outline" label={t('about.build')} value={buildNumber()} />
        <Row icon="phone-portrait-outline" label={t('about.platform')} value={platformLabel()} />
      </View>

      <Text style={styles.sectionTitle}>{t('about.syncSection')}</Text>
      <View style={styles.card}>
        <Row
          icon="cloud-outline"
          label={t('about.backend')}
          value={host ?? t('about.notConfigured')}
          tone={host ? 'ok' : 'warn'}
        />
        <Row
          icon="person-outline"
          label={t('about.account')}
          value={signedIn ? t('about.signedIn') : t('about.guest')}
          tone={signedIn ? 'ok' : 'warn'}
        />
      </View>

      <Text style={styles.note}>
        {!host
          ? t('about.syncNoteOffline')
          : signedIn
            ? t('about.syncNote')
            : t('about.syncNoteSignIn')}
      </Text>

      <Text style={styles.sectionTitle}>{t('about.privacySection')}</Text>
      <Text style={styles.note}>{t('about.privacyNote')}</Text>
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
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
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
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.75 },
  sectionTitle: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 3,
  },
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
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceElevated,
  },
  rowLabel: {
    flex: 1,
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 14,
  },
  rowValue: {
    flexShrink: 1,
    maxWidth: '58%',
    color: theme.colors.text,
    fontFamily: fontFamily.uiMedium,
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'right',
  },
  rowValueOk: { color: theme.colors.success },
  rowValueWarn: { color: theme.colors.warning },
  note: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
});
