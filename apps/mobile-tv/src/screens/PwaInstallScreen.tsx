import React, { useEffect, useState } from 'react';
import {
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
  getPwaInstallSnapshot,
  requestPwaInstall,
  subscribePwaInstall,
  type PwaInstallOutcome,
} from '../web/pwaInstall';
import { useThemeStyles } from '../theme/ThemeProvider';

function copyFor(t: (key: string) => string) {
  return {
    title: t('pwaInstall.title'),
    installed: t('pwaInstall.installed'),
    ready: t('pwaInstall.ready'),
    ios: t('pwaInstall.ios'),
    unavailable: t('pwaInstall.unavailable'),
    install: t('pwaInstall.install'),
    dismissed: t('pwaInstall.dismissed'),
    accepted: t('pwaInstall.accepted'),
  };
}

export function PwaInstallScreen({
  onBack,
}: {
  onBack(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t, direction } = useI18n();
  const swipeHandlers = useSwipeBack(onBack);
  const copy = copyFor(t);
  const [snapshot, setSnapshot] = useState(
    () => getPwaInstallSnapshot(),
  );
  const [outcome, setOutcome] = useState<PwaInstallOutcome | null>(null);

  useEffect(() => subscribePwaInstall(setSnapshot), []);

  const message = snapshot.installed
    ? copy.installed
    : snapshot.promptAvailable
      ? copy.ready
      : snapshot.ios
        ? copy.ios
        : copy.unavailable;

  return (
    <ScrollView
      testID="pwa-install-screen"
      {...swipeHandlers}
      style={styles.screen}
      contentContainerStyle={[styles.content, { direction }]}
    >
      <View style={[styles.header, { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' }]}>
        <IconBackButton
          label={t('common.back')}
          onPress={onBack}
          testID="pwa-install-back"
        />
        <Text style={[styles.title, { writingDirection: direction }]}>
          {copy.title}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={[styles.body, { writingDirection: direction }]}>
          {message}
        </Text>

        {!snapshot.installed && snapshot.promptAvailable ? (
          <Pressable
            accessibilityRole="button"
            testID="pwa-install-action"
            onPress={() => {
              setOutcome(null);
              void requestPwaInstall().then(setOutcome);
            }}
            style={({ focused, pressed }) => [
              styles.installButton,
              focused && styles.focused,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.installButtonText}>{copy.install}</Text>
          </Pressable>
        ) : null}

        {outcome === 'accepted' ? (
          <Text style={styles.status}>{copy.accepted}</Text>
        ) : outcome === 'dismissed' ? (
          <Text style={styles.status}>{copy.dismissed}</Text>
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
    gap: 26,
  },
  header: { alignItems: 'center', gap: 16 },
  title: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '900',
  },
  card: {
    gap: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  body: {
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  status: {
    color: theme.colors.accentSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
  },
  buttonText: { color: theme.colors.text, fontSize: 13, fontWeight: '900' },
  installButton: {
    minHeight: 48,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  installButtonText: { color: '#09090b', fontSize: 14, fontWeight: '900' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
});
