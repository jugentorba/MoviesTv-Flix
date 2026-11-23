import React, { useContext } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { AudioTrack } from '@moviestv/core';
import { type Theme, fontFamily } from '@moviestv/ui';
import { useI18n } from '../i18n/useI18n';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { useWebTvModalFocusRestore } from '../web/tvRemoteNavigation';
import { useThemeStyles } from '../theme/ThemeProvider';

export function AudioChooser({
  tracks,
  selectedTrackId,
  onSelect,
  onClose,
  onFindSources,
}: {
  tracks: readonly AudioTrack[];
  selectedTrackId: string | null;
  onSelect(trackId: string): void;
  onClose(): void;
  onFindSources?(): void;
}) {
  const styles = useThemeStyles(createStyles);
  const { t, languageName } = useI18n();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  useWebTvModalFocusRestore(true);

  return (
    <View
      aria-modal={true}
      testID="audio-chooser"
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
          <Text style={styles.title}>{t('playback.audio')}</Text>
          <Text style={styles.subtitle}>{tracks.length} {t('playback.audio').toLowerCase()}</Text>
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
        {tracks.length === 0 ? (
          <View>
            <Text style={styles.empty}>{t('playback.noAudioTracks')}</Text>
            {onFindSources ? (
              <Pressable
                testID="audio-find-sources"
                focusable
                onPress={onFindSources}
                style={({ pressed }) => [styles.findSources, pressed && styles.pressed]}
              >
                <Text style={styles.findSourcesText}>{t('playback.findOtherSources')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {tracks.map((track) => {
          const selected = track.id === selectedTrackId;
          const language = languageName(track.language);
          const detail = track.label && track.label !== track.language
            ? track.label
            : track.language.toUpperCase();

          return (
            <Pressable
              key={track.id}
              testID={`audio-${track.id}`}
              focusable
              onPress={() => onSelect(track.id)}
              style={({ focused, pressed }) => [
                styles.track,
                selected && styles.trackSelected,
                focused && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.trackCopy}>
                <Text numberOfLines={1} style={styles.trackTitle}>{language}</Text>
                <Text numberOfLines={1} style={styles.trackDetail}>{detail}</Text>
              </View>
              {selected ? (
                <View style={styles.selectedBadge}>
                  <Text style={styles.selectedText}>✓ {t('playback.selected')}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  sheet: {
    // A bottom drawer instead of a centred modal: audio, subtitles and sources
    // are picked mid-playback, so the video stays visible above the sheet.
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
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 26,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  findSources: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  findSourcesText: {
    color: theme.colors.text,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 13,
  },
  empty: {
    color: theme.colors.muted,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 14,
  },
  title: {
    color: theme.colors.text,
    fontFamily: fontFamily.displayBold,
    fontSize: 25,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: theme.colors.subtle,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    marginTop: 4,
  },
  closeButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
  },
  closeText: { color: theme.colors.text, fontWeight: '900' },
  list: { gap: 10, paddingTop: 18, paddingBottom: 24 },
  track: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  trackSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceElevated,
  },
  trackCopy: { flex: 1 },
  trackTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '900' },
  trackDetail: { color: theme.colors.muted, fontSize: 10, fontWeight: '700', marginTop: 4 },
  selectedBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(229,9,20,0.16)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  selectedText: { color: theme.colors.accentSoft, fontSize: 9, fontWeight: '900' },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
});
