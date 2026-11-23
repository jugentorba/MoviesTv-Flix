import React, { useContext } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useSwipeBack } from './useSwipeBack';

/**
 * The shape every settings sub-page shares: a back pill and a close circle,
 * a small eyebrow, an oversized title, an intro sentence, then cards.
 *
 * It replaces four different header patterns (text button, icon circle, title on
 * the left, title centred) with one that reads the same on every page and gives
 * the eye a single column.
 */
export function SettingsPage({
  eyebrow,
  title,
  intro,
  backLabel,
  onBack,
  closeLabel,
  onClose,
  testID,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  backLabel: string;
  onBack(): void;
  closeLabel?: string;
  onClose?(): void;
  testID?: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useContext(SafeAreaInsetsContext) ?? {
    top: 0, right: 0, bottom: 0, left: 0,
  };
  const swipeHandlers = useSwipeBack(onBack);

  return (
    <ScrollView
      testID={testID}
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: safeInsetEdge(14, insets.top, 8),
          paddingBottom: safeInsetEdge(120, insets.bottom, 96),
        },
      ]}
      keyboardShouldPersistTaps="handled"
      {...swipeHandlers}
    >
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          testID={testID ? `${testID}-back` : 'settings-page-back'}
          hitSlop={8}
          onPress={onBack}
          style={({ focused, pressed }) => [
            styles.backPill,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
          <Text numberOfLines={1} style={styles.backText}>{backLabel}</Text>
        </Pressable>

        <View style={styles.flex} />

        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel ?? backLabel}
            testID={testID ? `${testID}-close` : 'settings-page-close'}
            hitSlop={8}
            onPress={onClose}
            style={({ focused, pressed }) => [
              styles.closeButton,
              focused && styles.focused,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="close" size={18} color={theme.colors.text} />
          </Pressable>
        ) : null}
      </View>

      {eyebrow ? (
        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowDash} />
          <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
        </View>
      ) : null}

      <Text style={styles.title}>{title}</Text>
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
      <View style={styles.divider} />

      <View style={styles.body}>{children}</View>
    </ScrollView>
  );
}

/** A card: the only container these pages use. */
export function SettingsCard({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const styles = useStyles();
  return <View testID={testID} style={styles.card}>{children}</View>;
}

/** A small caps label above a group inside a card. */
export function SettingsLabel({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.cardLabel}>{children}</Text>;
}

export function SettingsDivider() {
  const styles = useStyles();
  return <View style={styles.cardDivider} />;
}

function useStyles() {
  return useThemeStyles(createStyles);
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    paddingHorizontal: '5%',
    gap: 14,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  backPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    maxWidth: '70%',
  },
  backText: {
    color: theme.colors.text,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 10,
  },
  eyebrowDash: {
    width: 26,
    height: 1,
    backgroundColor: theme.colors.subtle,
  },
  eyebrow: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.6,
  },
  title: {
    color: theme.colors.text,
    fontFamily: fontFamily.displayBold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.2,
  },
  intro: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 15,
    lineHeight: 22,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.borderStrong,
    marginTop: 4,
  },
  body: { gap: 16 },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 18,
    gap: 12,
  },
  cardLabel: {
    color: theme.colors.text,
    fontFamily: fontFamily.displayBold,
    fontSize: 19,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginVertical: 2,
  },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.7 },
});
