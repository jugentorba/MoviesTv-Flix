import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fontFamily } from '@moviestv/ui';

export interface PlayerAction {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Accessible name; no longer drawn on screen. */
  label: string;
  /** State shown as a tiny marker under the icon, e.g. `1×`, `Fill`. */
  value?: string;
  active?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  onPress?(): void;
  onPressIn?(): void;
  onPressOut?(): void;
  onLongPress?(): void;
}

export interface PlayerChromeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface PlayerChromeProps {
  title: string;
  meta?: string;
  submeta?: string;
  position: number;
  duration: number;
  actions: readonly PlayerAction[];
  insets: PlayerChromeInsets;
  locked?: boolean;
  onToggleLock?(): void;
  onSeekRatio(ratio: number): void;
  /** "Skip intro" and friends, offered only while inside the segment. */
  skipLabel?: string;
  onSkip?(): void;
  testID?: string;
  unlockLabel?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * The player's bottom chrome, shared by both playback engines.
 *
 * The layout follows the shape people already know from premium players: the
 * title sits bottom-left over the picture, the scrubber runs under it, and a
 * single row of icons sits beside the time. Everything is drawn on a gradient
 * rather than a card, so the film stays the subject.
 */
export function PlayerChrome({
  title,
  meta,
  submeta,
  position,
  duration,
  actions,
  insets,
  locked = false,
  onToggleLock,
  onSeekRatio,
  skipLabel,
  onSkip,
  testID = 'player-chrome',
  unlockLabel = 'Unlock controls',
}: PlayerChromeProps) {
  const [trackWidth, setTrackWidth] = useState(1);
  const ratio = duration > 0
    ? Math.max(0, Math.min(1, position / duration))
    : 0;

  if (locked) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unlockLabel}
        testID={`${testID}-unlock`}
        hitSlop={12}
        onPress={onToggleLock}
        style={[
          styles.lockButton,
          {
            top: Math.max(12, insets.top + 8),
            right: Math.max(12, insets.right + 8),
          },
        ]}
      >
        <Ionicons name="lock-closed" size={18} color="#ffffff" />
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.45, 1]}
        style={styles.scrim}
      />

      <View
        style={[
          styles.bottom,
          {
            paddingLeft: Math.max(16, insets.left + 12),
            paddingRight: Math.max(16, insets.right + 12),
            paddingBottom: Math.max(12, insets.bottom + 6),
          },
        ]}
      >
        {skipLabel && onSkip ? (
          <Pressable
            accessibilityRole="button"
            testID="player-skip-segment"
            onPress={onSkip}
            style={({ pressed }) => [styles.skipPill, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>{skipLabel}</Text>
            <Ionicons name="play-skip-forward" size={13} color="#0b0b0f" />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Player controls"
          onPress={onToggleLock}
          style={styles.copy}
        >
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          {meta ? <Text numberOfLines={1} style={styles.meta}>{meta}</Text> : null}
          {submeta ? <Text numberOfLines={1} style={styles.submeta}>{submeta}</Text> : null}
        </Pressable>

        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          testID={`${testID}-progress`}
          onLayout={(event) => {
            setTrackWidth(Math.max(1, event.nativeEvent.layout.width));
          }}
          onPress={(event) => {
            const x = event.nativeEvent.locationX;
            if (typeof x !== 'number' || trackWidth <= 0) return;
            onSeekRatio(Math.max(0, Math.min(1, x / trackWidth)));
          }}
          style={styles.track}
        >
          <View style={styles.rail} />
          <View style={[styles.fill, { width: `${ratio * 100}%` as `${number}%` }]} />
          <View style={[styles.thumb, { left: `${ratio * 100}%` as `${number}%` }]} />
        </Pressable>

        <View style={styles.row}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actions}
            style={styles.actionsScroll}
          >
            {actions.map((action) => (
              <Pressable
                key={action.key}
                focusable
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel ?? action.label}
                accessibilityState={action.active ? { selected: true } : undefined}
                testID={action.testID}
                hitSlop={6}
                onPress={action.onPress}
                onPressIn={action.onPressIn}
                onPressOut={action.onPressOut}
                onLongPress={action.onLongPress}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <View style={[styles.iconShell, action.active && styles.iconShellActive]}>
                  <Ionicons name={action.icon} size={18} color="#ffffff" />
                </View>
                {/* The slot is always reserved so icons stay on one baseline. */}
                <Text
                  style={[styles.value, action.active && styles.valueActive]}
                  numberOfLines={1}
                >
                  {action.value ?? ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text testID={`${testID}-time`} style={styles.time}>
            {formatTime(position)} / {formatTime(duration)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
  },
  copy: { gap: 2 },
  skipPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  skipText: {
    color: '#0b0b0f',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 13,
  },
  title: {
    color: '#ffffff',
    fontFamily: fontFamily.displayBold,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  meta: {
    color: 'rgba(255,255,255,0.9)',
    fontFamily: fontFamily.uiMedium,
    fontSize: 13,
  },
  submeta: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: fontFamily.ui,
    fontSize: 11,
  },
  track: {
    height: 18,
    justifyContent: 'center',
  },
  rail: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#6C4BEF',
  },
  thumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsScroll: { flex: 1 },
  actions: { alignItems: 'center', gap: 6, paddingRight: 8 },
  action: { width: 40, alignItems: 'center', gap: 2 },
  iconShell: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  iconShellActive: { backgroundColor: 'rgba(108,75,239,0.95)' },
  value: {
    minHeight: 11,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  valueActive: { color: '#ffffff' },
  time: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12,
  },
  pressed: { opacity: 0.55 },
  lockButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
});
