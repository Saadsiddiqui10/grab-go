import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GrabGoMap } from '../src/map/GrabGoMap';
import { useTheme } from '../src/theme';

/**
 * The map screen.
 *
 * Deliberately just the map: pan and zoom on a branded surface. Cafe markers,
 * search, filters and location all belong to later work, and `GrabGoMap`
 * already accepts children so none of them will require changing this file.
 *
 * Options are declared inline rather than in the root layout so no existing
 * screen or route registration had to be touched.
 */
export default function MapScreen(): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ title: 'Map' }} />
      <StatusBar style="dark" />
      <GrabGoMap />
    </View>
  );
}
