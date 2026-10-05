import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

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
