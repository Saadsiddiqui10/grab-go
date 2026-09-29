import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Ionicons } from '@expo/vector-icons';
import { BRAND } from '@grabgo/config';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import { auth as authApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { errorFeedback } from '../../src/lib/feedback';
import { Screen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Surface';

/**
 * The way in.
 *
 * Phone first, because a Karachi customer has a phone number long before they
 * have a password, and OTP is the fastest path from "install" to "ordering".
 * Apple Sign In appears only on iOS, where Apple requires it alongside other
 * social options; Google and email sit behind it.
 */
export default function WelcomeScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const applySession = useAuthStore((state) => state.applySession);
  const pendingReferralCode = useAuthStore((state) => state.pendingReferralCode);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Sign in with Apple needs iOS 13+ and a build entitled to use it. Asking the
   * module rather than assuming means the button is absent where it would not
   * work — including inside Expo Go — instead of failing when tapped.
   */
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => undefined);
  }, []);

  const signInWithApple = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) throw new Error('No identity token');

      // Apple returns the name only on the very first authorisation, so it is
      // forwarded now or never.
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(' ');

      const session = await authApi.oauth({
        provider: 'APPLE',
        idToken: credential.identityToken,
        ...(fullName ? { fullName } : {}),
        ...(pendingReferralCode ? { referralCode: pendingReferralCode } : {}),
      });

      await applySession(session);
      router.replace('/(tabs)');
    } catch (caught) {
      // A cancelled sheet is not an error worth showing.
      if ((caught as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;

      errorFeedback();
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'Apple sign-in did not complete. Try another way in.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={{ top: true, bottom: true }}>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: theme.spacing.xxl }}>
        {/* --------------------------------------------------------- brand */}
        <View style={{ gap: theme.spacing.base, marginTop: theme.spacing.xxxl }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: theme.radii.xl,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.primary,
            }}
          >
            <Ionicons name="cafe" size={32} color="#FFFFFF" />
          </View>

          <View style={{ gap: 6 }}>
            <Text variant="display">{BRAND.name}</Text>
            <Text variant="title3" color="textMuted">
              {BRAND.tagline}
            </Text>
          </View>

          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.base }}>
            <Benefit icon="time-outline" label="Order before you arrive" />
            <Benefit icon="flash-outline" label="Skip the queue at the counter" />
            <Benefit icon="gift-outline" label="Earn Grab Points on every order" />
          </View>
        </View>

        {/* ------------------------------------------------------- actions */}
        <View style={{ gap: theme.spacing.sm }}>
          {pendingReferralCode ? (
            <Card style={{ backgroundColor: theme.colors.primarySubtle }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Ionicons name="gift" size={20} color={theme.colors.primary} />
                <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
                  Code <Text variant="subhead">{pendingReferralCode}</Text> applied — you and
                  your friend both get a reward.
                </Text>
              </View>
            </Card>
          ) : null}

          {error ? (
            <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
              <Text variant="footnote" color="danger">
                {error}
              </Text>
            </Card>
          ) : null}

          <Button
            label="Continue with phone"
            size="lg"
            icon="phone-portrait-outline"
            fullWidth
            onPress={() => router.push('/(auth)/phone')}
          />

          {Platform.OS === 'ios' && appleAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                theme.isDark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={theme.radii.lg}
              style={{ height: 52 }}
              onPress={() => void signInWithApple()}
            />
          ) : null}

          <Button
            label="Continue with email"
            variant="secondary"
            size="lg"
            icon="mail-outline"
            fullWidth
            disabled={busy}
            onPress={() => router.push('/(auth)/email')}
          />

          <Button
            label="Browse without an account"
            variant="ghost"
            fullWidth
            onPress={() => router.replace('/(tabs)')}
          />

          <Text variant="caption" color="textMuted" align="center" style={{ marginTop: 4 }}>
            By continuing you agree to our Terms and Privacy Policy.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

function Benefit({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <Ionicons name={icon} size={18} color={theme.colors.primary} />
      <Text variant="body" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}
