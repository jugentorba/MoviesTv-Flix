import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fontFamily } from '@moviestv/ui';
import { percentLabel } from './playerGestureMath';
import type { SliderIndicator } from './usePlayerSliders';

/**
 * The floating readout while a brightness or volume drag is in progress.
 * Same idea as a handset player: one icon, one bar, one number.
 */
export function PlayerSliderIndicator({
  indicator,
  insetsTop = 16,
}: {
  indicator: SliderIndicator | null;
  insetsTop?: number;
}) {
  if (!indicator) return null;
  const ratio = Math.max(0, Math.min(1, indicator.value));

  return (
    <View
      pointerEvents="none"
      testID={`player-slider-${indicator.axis}`}
      style={[styles.badge, { top: Math.max(16, insetsTop) }]}
    >
      <Ionicons
        name={indicator.axis === 'brightness' ? 'sunny' : 'volume-high'}
        size={16}
        color="#ffffff"
      />
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%` as `${number}%` }]} />
      </View>
      <Text style={styles.value}>{percentLabel(ratio)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,14,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 40,
  },
  track: {
    width: 92,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.24)',
    overflow: 'hidden',
  },
  fill: { height: 4, backgroundColor: '#ffffff' },
  value: {
    minWidth: 34,
    color: '#ffffff',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
  },
});
