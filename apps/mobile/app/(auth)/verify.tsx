import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import { auth as authApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { errorFeedback, successFeedback } from '../../src/lib/feedback';
import { KeyboardScreen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Input, OtpInput } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { goBack } from '../../src/lib/navigation';

const RESEND_SECONDS = 30;

/**
 * Code verification.
 *
 * Submits automatically once six digits are present, because making someone tap
 * "Verify" after the OS has already autofilled the code is a wasted step.
 */
export default function VerifyScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const applySession = useAuthStore((state) => state.applySession);
  const pendingReferralCode = useAuthStore((state) => state.pendingReferralCode);

  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const verify = async (submitted: string): Promise<void> => {
    if (!phone) return;

    setBusy(true);
    setError(undefined);

    try {
      const session = await authApi.verifyOtp({
        phone,
        code: submitted,
        ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
        ...(pendingReferralCode ? { referralCode: pendingReferralCode } : {}),
      });

      successFeedback();
      await applySession(session);

      // A brand new account with no name gets asked once, here, rather than
      // being dropped into the app as "Grab & Go customer".
      if (session.isNewUser && !fullName.trim()) {
        setNeedsName(true);
        setBusy(false);
        return;
      }

      router.replace('/(tabs)');
    } catch (caught) {
      errorFeedback();
      setCode('');
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'That code did not work. Try again.',
      );
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    if (!phone || countdown > 0) return;
    setCountdown(RESEND_SECONDS);
    setError(undefined);

    try {
      await authApi.requestOtp({ phone, intent: 'LOGIN' });
    } catch {
      setError('We could not resend the code. Try again shortly.');
    }
  };

  if (needsName) {
    return (
      <KeyboardScreen>
        <View style={{ flex: 1, gap: theme.spacing.xl, paddingTop: theme.spacing.lg }}>
          <View style={{ gap: 6 }}>
            <Text variant="title1">What should we call you?</Text>
            <Text variant="body" color="textMuted">
              Your name appears on your orders so the cafe knows who to hand them to.
            </Text>
          </View>

          <Input
            label="Your name"
            placeholder="Saad Ahmed"
            autoFocus
            autoCapitalize="words"
            textContentType="name"
            value={fullName}
            onChangeText={setFullName}
          />

          <Button
            label="Continue"
            size="lg"
            fullWidth
            disabled={fullName.trim().length < 2}
            onPress={() => {
              void useAuthStore.getState().refreshProfile();
              router.replace('/(tabs)');
            }}
          />
        </View>
      </KeyboardScreen>
    );
  }

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, gap: theme.spacing.xl, paddingTop: theme.spacing.lg }}>
        <View style={{ gap: 6 }}>
          <Text variant="title1">Enter your code</Text>
          <Text variant="body" color="textMuted">
            Sent to {phone}.{' '}
            <Text variant="subhead" color="primary" onPress={() => goBack(router, '/(auth)/welcome')}>
              Change number
            </Text>
          </Text>
        </View>

        <OtpInput
          value={code}
          error={error}
          onChange={(next) => {
            setCode(next);
            setError(undefined);
            // Autofill delivers all six digits at once; verify immediately.
            if (next.length === 6) void verify(next);
          }}
        />

        <Button
          label="Verify"
          size="lg"
          fullWidth
          loading={busy}
          disabled={code.length !== 6}
          onPress={() => void verify(code)}
        />

        <Button
          label={countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
          variant="ghost"
          fullWidth
          disabled={countdown > 0}
          onPress={() => void resend()}
        />
      </View>
    </KeyboardScreen>
  );
}
