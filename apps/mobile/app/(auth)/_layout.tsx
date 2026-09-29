import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';

export default function AuthLayout(): React.JSX.Element {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.colors.background },
        gestureEnabled: Platform.OS === 'ios',
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="phone" options={{ title: '' }} />
      <Stack.Screen name="verify" options={{ title: '' }} />
      <Stack.Screen name="email" options={{ title: '' }} />
    </Stack>
  );
}
