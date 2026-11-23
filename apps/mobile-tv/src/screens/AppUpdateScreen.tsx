import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { IconBackButton } from '../components/IconBackButton';
import { useSwipeBack } from '../components/useSwipeBack';
import {
  CURRENT_APP_VERSION,
  CURRENT_BUILD_NUMBER,
  applyAvailableUpdate,
  checkForAppUpdate,
  type AppUpdateResult,
} from '../updates/appUpdate';
import { useThemeStyles } from '../theme/ThemeProvider';
import { isDesktopHost } from '../updates/desktopUpdate';

function copyFor(t: (key: string) => string) {
  return {
    title: t('appUpdate.title'),
    current: t('appUpdate.current'),
    check: t('appUpdate.check'),
    checking: t('appUpdate.checking'),
    downloading: t('appUpdate.downloading'),
    latest: t('appUpdate.latest'),
    available: t('appUpdate.available'),
    unavailable: t('appUpdate.unavailable'),
    downloadAndroid: t('appUpdate.downloadAndroid'),
    downloadIos: t('appUpdate.downloadIos'),
    applyPwa: t('appUpdate.applyPwa'),
    openReleasePage: t('appUpdate.openReleasePage'),
    noPackage: t('appUpdate.noPackage'),
    androidInfo: t('appUpdate.androidInfo'),
    iosInfo: t('appUpdate.iosInfo'),
    pwaInfo: t('appUpdate.pwaInfo'),
    savedIos: t('appUpdate.savedIos'),
    failedOpen: t('appUpdate.failedOpen'),
    installPermission: t('appUpdate.installPermission'),
    desktopInfo: t('appUpdate.desktopInfo'),
    desktopRestart: t('appUpdate.desktopRestart'),
  };
}

function Button({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.disabled,
        focused && !disabled && styles.focused,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AppUpdateScreen({ onBack }: { onBack(): void }) {
  const styles = useThemeStyles(createStyles);
  const { t, direction } = useI18n();
  const swipeHandlers = useSwipeBack(onBack);
  const copy = copyFor(t);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [actionProgress, setActionProgress] = useState<number | null>(null);
  const [result, setResult] = useState<AppUpdateResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const check = async () => {
    if (applying) return;
    setChecking(true);
    setActionError(null);
    setActionMessage(null);
    setActionProgress(null);
    try {
      setResult(await checkForAppUpdate());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  const desktop = Platform.OS === 'web' && isDesktopHost();
  const platformInfo = desktop
    ? copy.desktopInfo
    : Platform.OS === 'web'
      ? copy.pwaInfo
    : Platform.OS === 'android'
      ? copy.androidInfo
      : copy.iosInfo;

  const currentText = desktop
    ? result && result.kind !== 'unavailable'
      ? String(result.currentVersion)
      : CURRENT_APP_VERSION
    : Platform.OS === 'web'
      ? result && result.kind !== 'unavailable'
        ? String(result.currentBuild)
        : 'PWA'
      : `${CURRENT_APP_VERSION} (${CURRENT_BUILD_NUMBER})`;

  const apply = async () => {
    if (!result || result.kind !== 'available' || applying) return;
    setApplying(true);
    setActionProgress(null);
    setActionError(null);
    setActionMessage(null);
    try {
      const outcome = await applyAvailableUpdate(
        result,
        (progress) => setActionProgress(progress),
      );
      if (!outcome) {
        setActionError(copy.failedOpen);
      } else if (outcome === 'permission-required') {
        setActionMessage(copy.installPermission);
      } else if (result.platform === 'desktop') {
        setActionMessage(copy.desktopRestart);
      } else if (result.platform === 'ios' && result.downloadUrl) {
        setActionMessage(copy.savedIos);
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <ScrollView
      testID="app-update-screen"
      {...swipeHandlers}
      style={styles.screen}
      contentContainerStyle={[styles.content, { direction }]}
    >
      <View style={[
        styles.header,
        { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' },
      ]}>
        <IconBackButton label={t('common.back')} onPress={onBack} testID="app-update-back" />
        <Text style={[styles.title, { writingDirection: direction }]}>
          {copy.title}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{copy.current}</Text>
        <Text style={styles.version}>{currentText}</Text>
        <Text style={[styles.info, { writingDirection: direction }]}>
          {platformInfo}
        </Text>

        <Button
          label={checking ? copy.checking : copy.check}
          disabled={checking || applying}
          primary
          onPress={() => { void check(); }}
        />

        {result?.kind === 'up-to-date' ? (
          <Text style={styles.good}>{copy.latest}</Text>
        ) : result?.kind === 'available' ? (
          <View style={styles.resultBox}>
            <Text style={styles.good}>{copy.available}</Text>
            <Text style={styles.version}>
              {String(result.latestVersion)} · {String(result.latestBuild)}
            </Text>
            {result.releaseNotes ? (
              <Text style={styles.info}>{result.releaseNotes}</Text>
            ) : null}
            {result.platform === 'web' || result.downloadUrl || result.releasePageUrl ? (
              <>
                <Button
                  label={
                    applying
                      ? actionProgress === null
                        ? copy.downloading
                        : `${copy.downloading} ${Math.round(actionProgress * 100)}%`
                      : result.platform === 'web' || result.platform === 'desktop'
                        ? copy.applyPwa
                        : result.downloadUrl
                          ? (result.platform === 'android' || result.platform === 'android-tv')
                            ? copy.downloadAndroid
                            : copy.downloadIos
                          : copy.openReleasePage
                  }
                  disabled={applying}
                  primary
                  onPress={() => { void apply(); }}
                />
                {applying && actionProgress !== null ? (
                  <View
                    accessibilityRole="progressbar"
                    accessibilityValue={{
                      min: 0,
                      max: 100,
                      now: Math.round(actionProgress * 100),
                    }}
                    style={styles.progressTrack}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.round(actionProgress * 100)}%` as `${number}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.warning}>{copy.noPackage}</Text>
            )}
          </View>
        ) : result?.kind === 'unavailable' ? (
          <Text style={styles.warning}>
            {result.message || copy.unavailable}
          </Text>
        ) : null}

        {actionMessage ? (
          <Text style={styles.good}>{actionMessage}</Text>
        ) : null}

        {actionError ? (
          <Text style={styles.warning}>{actionError}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: '5%',
    paddingVertical: 30,
    gap: 24,
  },
  header: { alignItems: 'center', gap: 16 },
  title: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '900',
  },
  card: {
    gap: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  label: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  version: { color: theme.colors.text, fontSize: 18, fontWeight: '900' },
  info: { color: theme.colors.muted, fontSize: 13, lineHeight: 20 },
  resultBox: { gap: 12 },
  good: { color: theme.colors.accentSoft, fontSize: 14, fontWeight: '800' },
  warning: { color: theme.colors.text, fontSize: 13, lineHeight: 19 },
  progressTrack: {
    width: '100%',
    height: 6,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceElevated,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  button: {
    minHeight: 46,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceElevated,
  },
  buttonPrimary: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  buttonTextPrimary: { color: '#09090b' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
