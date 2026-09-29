import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { phoneSchema } from '@grabgo/validation';
import { useTheme } from '../../src/theme';
import { auth as authApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { errorFeedback } from '../../src/lib/feedback';
import { KeyboardScreen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Surface';

/**
 * Phone entry.
 *
 * The number is normalised with the same schema the server uses, so
 * `0300 1234567` and `+923001234567` are one account rather than two.
 */
export default function PhoneScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const parsed = phoneSchema.safeParse(phone);

    if (!parsed.success) {
      errorFeedback();
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid mobile number');
      return;
    }

    setBusy(true);
    setError(undefined);

    try {
      const result = await authApi.requestOtp({ phone: parsed.data, intent: 'LOGIN' });

      // Development builds return the code so a simulator with no SIM can sign in.
      if (result.devCode) setDevCode(result.devCode);

      router.push({ pathname: '/(auth)/verify', params: { phone: parsed.data } });
    } catch (caught) {
      errorFeedback();
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'We could not send that code. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScreen>
      <View style={{ flex: 1, gap: theme.spacing.xl, paddingTop: theme.spacing.lg }}>
        <View style={{ gap: 6 }}>
          <Text variant="title1">What&apos;s your number?</Text>
          <Text variant="body" color="textMuted">
            We&apos;ll text you a code to sign in. No password to remember.
          </Text>
        </View>

        <Input
          label="Mobile number"
          prefix="+92"
          placeholder="300 1234567"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          value={phone}
          onChangeText={(next) => {
            setPhone(next);
            setError(undefined);
          }}
          error={error}
          onSubmitEditing={() => void submit()}
          returnKeyType="go"
          onClear={() => setPhone('')}
        />

        {devCode ? (
          <Card style={{ backgroundColor: theme.colors.infoMuted }}>
            <Text variant="footnote" color="info">
              Development mode: your code is {devCode}
            </Text>
          </Card>
        ) : null}

        <Button
          label="Send code"
          size="lg"
          fullWidth
          loading={busy}
          disabled={phone.trim().length < 10}
          onPress={() => void submit()}
        />
      </View>
    </KeyboardScreen>
  );
}
