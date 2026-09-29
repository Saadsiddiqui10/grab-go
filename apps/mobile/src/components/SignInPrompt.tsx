import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Screen } from './ui/Screen';
import { Text } from './ui/Text';
import { Button } from './ui/Button';

/**
 * Shown on tabs that genuinely need an account.
 *
 * The app deliberately lets people browse cafes and menus signed out — the wall
 * only appears where an account is the point (orders, points, referrals), and it
 * says what is behind it rather than just demanding a login.
 */
export function SignInPrompt({
  title,
  body,
  icon = 'person-circle-outline',
}: {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
}): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen edges={{ top: true, bottom: true }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.lg,
        }}
      >
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: theme.radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.primaryMuted,
          }}
        >
          <Ionicons name={icon} size={34} color={theme.colors.primary} />
        </View>

        <View style={{ gap: 6, alignItems: 'center' }}>
          <Text variant="title2" align="center">
            {title}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 300 }}>
            {body}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.sm, alignSelf: 'stretch' }}>
          <Button
            label="Sign in or create an account"
            onPress={() => router.push('/(auth)/welcome')}
            fullWidth
          />
          <Button
            label="Keep browsing"
            variant="ghost"
            onPress={() => router.push('/(tabs)/discover')}
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}
