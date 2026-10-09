import { useCallback, useRef, type ComponentType } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useReducedMotion } from '../../lib/motion';

/**
 * A short fade-and-rise each time a tab comes into focus, so switching tabs
 * feels like a deliberate move rather than a hard cut. The system tab bar has
 * no transition of its own.
 *
 * 220 ms, native-driven (opacity and transform only), and skipped entirely
 * with Reduce Motion on. Only the content animates; the tab bar stays put.
 */
export function withTabTransition<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function TabScreen(props: P): React.JSX.Element {
    const progress = useRef(new Animated.Value(1)).current;
    const reduceMotion = useReducedMotion();

    useFocusEffect(
      useCallback(() => {
        if (reduceMotion) {
          progress.setValue(1);
          return;
        }
        progress.setValue(0);
        const animation = Animated.timing(progress, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
      }, [progress, reduceMotion]),
    );

    return (
      <Animated.View
        style={[
          styles.fill,
          {
            opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            ],
          },
        ]}
      >
        <Screen {...props} />
      </Animated.View>
    );
  }

  TabScreen.displayName = `withTabTransition(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return TabScreen;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
