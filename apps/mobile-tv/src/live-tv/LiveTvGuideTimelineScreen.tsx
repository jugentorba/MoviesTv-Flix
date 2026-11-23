import React, { useContext, useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { LiveTvChannel } from '@moviestv/live-tv';
import { type Theme } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import type {
  LiveTvGuideController,
  LiveTvGuideState,
} from './LiveTvGuideController';
import {
  guideProgrammeLabel,
  guideTimelineRows,
} from './live-tv-guide-view-model';
import { useThemeStyles } from '../theme/ThemeProvider';

function timelineCopy(t: (key: string) => string) {
  return {
    back: t('liveTvTimeline.back'),
    playLive: t('liveTvTimeline.playLive'),
    eyebrow: t('liveTvTimeline.eyebrow'),
    now: t('liveTvTimeline.now'),
    emptyTitle: t('liveTvTimeline.emptyTitle'),
    emptyBody: t('liveTvTimeline.emptyBody'),
  };
}

function Button({
  label,
  onPress,
  primary = false,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function LiveTvGuideTimelineScreen({
  channel,
  guideState,
  controller,
  nowMs,
  onBack,
  onPlay,
}: {
  channel: LiveTvChannel;
  guideState: LiveTvGuideState;
  controller: LiveTvGuideController;
  nowMs: number;
  onBack(): void;
  onPlay(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t, locale, direction } = useI18n();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const copy = useMemo(() => timelineCopy(t), [t]);
  const rows = useMemo(
    () => guideTimelineRows(
      controller.timeline(guideState, channel.id, nowMs),
      nowMs,
    ),
    [channel.id, controller, guideState, nowMs],
  );

  return (
    <ScrollView
      testID="live-tv-guide-timeline"
      style={[styles.page, { direction }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: safeAreaInsets.top > 0
            ? safeInsetEdge(20, safeAreaInsets.top, 12)
            : '5%',
          paddingRight: safeAreaInsets.right > 0
            ? safeInsetEdge(24, safeAreaInsets.right, 12)
            : '6%',
          paddingBottom: safeInsetEdge(100, safeAreaInsets.bottom, 32),
          paddingLeft: safeAreaInsets.left > 0
            ? safeInsetEdge(24, safeAreaInsets.left, 12)
            : '6%',
        },
      ]}
    >
      <View
        style={[
          styles.topRow,
          { flexDirection: direction === 'rtl' ? 'row-reverse' : 'row' },
        ]}
      >
        <Button label={`‹ ${copy.back}`} onPress={onBack} />
        <Button label={`▶ ${copy.playLive}`} onPress={onPlay} primary />
      </View>

      <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
      <Text style={[styles.title, { writingDirection: direction }]}>
        {channel.title}
      </Text>
      {channel.countryCode ? (
        <Text style={styles.country}>{channel.countryCode}</Text>
      ) : null}

      {rows.length ? (
        <View style={styles.timeline}>
          {rows.map(({ programme, isCurrent }) => {
            const label = guideProgrammeLabel(programme, locale);
            return (
              <View
                key={[
                  programme.channelId,
                  programme.startAtMs,
                  programme.endAtMs,
                  programme.title,
                ].join(':')}
                style={[
                  styles.programmeCard,
                  isCurrent && styles.currentCard,
                ]}
              >
                <View style={styles.timeColumn}>
                  <Text
                    style={[
                      styles.time,
                      isCurrent && styles.currentText,
                    ]}
                  >
                    {label.time}
                  </Text>
                  {isCurrent ? (
                    <Text style={styles.liveBadge}>{copy.now}</Text>
                  ) : null}
                </View>
                <View style={styles.programmeCopy}>
                  <Text style={styles.programmeTitle}>
                    {label.title}
                  </Text>
                  {programme.subtitle ? (
                    <Text style={styles.subtitle}>
                      {programme.subtitle}
                    </Text>
                  ) : null}
                  {programme.description ? (
                    <Text style={styles.description}>
                      {programme.description}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
          <Text style={styles.description}>
            {copy.emptyBody}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    paddingHorizontal: '6%',
    paddingTop: '5%',
    paddingBottom: 100,
  },
  topRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  eyebrow: {
    color: theme.colors.accentSoft,
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '900',
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '900',
  },
  country: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 5,
  },
  timeline: { gap: theme.spacing.sm, marginTop: theme.spacing.xl },
  programmeCard: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
  },
  currentCard: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceElevated,
  },
  timeColumn: { width: 150 },
  time: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  currentText: { color: theme.colors.accentSoft },
  liveBadge: {
    alignSelf: 'flex-start',
    color: theme.colors.accentSoft,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginTop: theme.spacing.sm,
  },
  programmeCopy: { flex: 1, minWidth: 0 },
  programmeTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  description: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: theme.spacing.sm,
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    marginTop: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  button: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  buttonPrimary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  buttonText: {
    color: theme.colors.text,
    fontWeight: '900',
    fontSize: 12,
  },
  focused: {
    borderColor: theme.colors.focus,
    transform: [{ scale: 1.04 }],
  },
  pressed: { opacity: 0.72 },
});
