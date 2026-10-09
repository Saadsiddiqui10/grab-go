import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Whether the user has asked the OS to reduce motion (iOS Settings ›
 * Accessibility › Motion, or Android's "Remove animations").
 *
 * Animations that only decorate (press springs, skeleton pulses, entrances,
 * parallax) check this and either snap to their end state or stay still. The
 * screen must still make sense without them, which is the point.
 *
 * Starts as `false` and settles within a frame; the subscription keeps it
 * current if the setting changes while the app is open.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * A colour that blends from its previous value to the new one instead of
 * snapping, e.g. a page wash when the selected category changes. Returns an
 * animated colour for `backgroundColor`. Snaps when Reduce Motion is on.
 */
export function useBlendedColor(colour: string, duration = 260): Animated.AnimatedInterpolation<string> | string {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const [pair, setPair] = useState<[string, string]>([colour, colour]);
  const current = useRef(colour);

  useEffect(() => {
    if (colour === current.current) return;
    setPair([current.current, colour]);
    current.current = colour;
    progress.setValue(0);
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.quad),
      // Colours cannot run on the native driver; this is one view.
      useNativeDriver: false,
    }).start();
  }, [colour, duration, progress, reduceMotion]);

  if (pair[0] === pair[1]) return pair[1];
  return progress.interpolate({ inputRange: [0, 1], outputRange: pair });
}

/**
 * A 0→1 value that replays whenever `key` changes (not on first mount), for
 * fading content in after a switch such as a new category. Native-driven.
 */
export function useEnterOnChange(key: unknown, duration = 240): Animated.Value {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduceMotion) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [key, duration, progress, reduceMotion]);

  return progress;
}

/** Fade-and-rise style for a value from `useEnterOnChange`. */
export function enterStyle(progress: Animated.Value): {
  opacity: Animated.AnimatedInterpolation<number>;
  transform: Array<{ translateY: Animated.AnimatedInterpolation<number> }>;
} {
  return {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };
}
