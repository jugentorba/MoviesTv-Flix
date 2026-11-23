import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import {
  axisFromTouch,
  isSliderDrag,
  valueFromDrag,
  type GestureAxis,
} from './playerGestureMath';

export interface SliderIndicator {
  axis: GestureAxis;
  value: number;
}

export interface PlayerSliderOptions {
  brightness: number;
  volume: number;
  width: number;
  height: number;
  enabled: boolean;
  onBrightness(value: number): void;
  onVolume(value: number): void;
}

/**
 * Vertical drags on the picture: brightness on the left half, volume on the
 * right. Capture-phase so the drag wins over the tap surface underneath, and
 * only for movements that are clearly vertical, so the scrubber and carousels
 * keep their gestures.
 */
export function usePlayerSliders(options: PlayerSliderOptions): {
  panHandlers: Record<string, unknown>;
  indicator: SliderIndicator | null;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const startValueRef = useRef(0);
  const axisRef = useRef<GestureAxis | null>(null);
  const [indicator, setIndicator] = useState<SliderIndicator | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  }, []);

  const apply = useCallback((axis: GestureAxis, value: number) => {
    const current = optionsRef.current;
    if (axis === 'brightness') current.onBrightness(value);
    else current.onVolume(value);
    setIndicator({ axis, value });
  }, []);

  const panHandlers = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      const current = optionsRef.current;
      return current.enabled && isSliderDrag(gesture.dx, gesture.dy);
    },
    onPanResponderGrant: (event, gesture) => {
      const current = optionsRef.current;
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      const axis = axisFromTouch(gesture.x0, current.width);
      axisRef.current = axis;
      startValueRef.current = axis === 'brightness'
        ? current.brightness
        : current.volume;
      // Show the readout immediately so the user sees which slider they grabbed.
      if (axis) setIndicator({ axis, value: startValueRef.current });
      void event;
    },
    onPanResponderMove: (_event, gesture) => {
      const axis = axisRef.current;
      if (!axis) return;
      apply(axis, valueFromDrag(
        startValueRef.current,
        gesture.dy,
        optionsRef.current.height,
      ));
    },
    onPanResponderRelease: () => {
      axisRef.current = null;
      clearTimerRef.current = setTimeout(() => setIndicator(null), 700);
    },
    onPanResponderTerminate: () => {
      axisRef.current = null;
      setIndicator(null);
    },
    onPanResponderTerminationRequest: () => false,
  }).panHandlers as Record<string, unknown>, [apply]);

  return { panHandlers, indicator };
}
