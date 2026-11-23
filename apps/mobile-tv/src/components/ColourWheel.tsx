import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { accentFromHue, hslToHex, type Theme } from '@moviestv/ui';
import { fontFamily } from '@moviestv/ui';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

const SEGMENTS = 48;
const STEP = 360 / SEGMENTS;

/**
 * A hue wheel you can drag.
 *
 * Drawn as rotated bars rather than a gradient because React Native has no conic
 * gradient. The bar count is chosen so neighbours overlap slightly and the ring
 * reads as continuous; the thumb is placed with the same angle maths the drag
 * uses, so the two can never disagree.
 */
export function ColourWheel({
  hue,
  onChange,
  size = 216,
  thickness = 22,
}: {
  hue: number;
  onChange(hue: number): void;
  size?: number;
  thickness?: number;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const [dragging, setDragging] = useState(false);
  const radius = size / 2;
  const ringRadius = radius - thickness / 2;

  const geometryRef = useRef({ size, thickness });
  geometryRef.current = { size, thickness };

  const hueFromTouch = (x: number, y: number): number => {
    const { size: currentSize } = geometryRef.current;
    const cx = currentSize / 2;
    const cy = currentSize / 2;
    const degrees = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
    return ((Math.round(degrees) % 360) + 360) % 360;
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      setDragging(true);
      onChange(hueFromTouch(event.nativeEvent.locationX, event.nativeEvent.locationY));
    },
    onPanResponderMove: (event) => {
      onChange(hueFromTouch(event.nativeEvent.locationX, event.nativeEvent.locationY));
    },
    onPanResponderRelease: () => setDragging(false),
    onPanResponderTerminate: () => setDragging(false),
    onPanResponderTerminationRequest: () => false,
  }), [onChange]);

  const accent = accentFromHue(hue);
  const angleRad = (hue * Math.PI) / 180;
  const thumbLeft = radius + Math.sin(angleRad) * ringRadius;
  const thumbTop = radius - Math.cos(angleRad) * ringRadius;

  return (
    <View style={styles.wrap}>
      <View
        testID="colour-wheel"
        accessibilityRole="adjustable"
        accessibilityLabel="Accent hue"
        accessibilityValue={{ min: 0, max: 359, now: Math.round(hue) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') onChange((hue + 10) % 360);
          if (event.nativeEvent.actionName === 'decrement') onChange((hue + 350) % 360);
        }}
        style={{ width: size, height: size }}
        {...pan.panHandlers}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <View
            key={index}
            pointerEvents="none"
            style={[
              styles.segmentWrap,
              { width: size, height: size, transform: [{ rotate: `${index * STEP}deg` }] },
            ]}
          >
            <View
              style={[
                styles.segment,
                {
                  width: Math.ceil((2 * Math.PI * ringRadius) / SEGMENTS) + 4,
                  height: thickness,
                  backgroundColor: hslToHex(index * STEP, 72, 55),
                },
              ]}
            />
          </View>
        ))}

        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: thumbLeft - 11,
              top: thumbTop - 11,
              borderColor: dragging ? '#ffffff' : 'rgba(255,255,255,0.85)',
            },
          ]}
        />

        <View
          pointerEvents="none"
          style={[
            styles.hub,
            {
              width: size - thickness * 2 - 16,
              height: size - thickness * 2 - 16,
              borderRadius: (size - thickness * 2 - 16) / 2,
              borderColor: accent.accent,
            },
          ]}
        >
          <Text style={[styles.sample, { color: accent.accent }]}>Aa</Text>
          <Text style={[styles.hubLabel, { color: theme.colors.muted }]}>
            {`${Math.round(hue)}°`}
          </Text>
        </View>
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 6 },
  segmentWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
  },
  segment: {
    borderRadius: 6,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  hub: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: theme.colors.surface,
    gap: 2,
  },
  sample: {
    fontFamily: fontFamily.displayBold,
    fontSize: 30,
  },
  hubLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
  },
});
