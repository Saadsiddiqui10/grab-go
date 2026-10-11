import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { emailSchema, passwordSchema } from '@grabgo/validation';
import { useTheme } from '../../src/theme';
import { auth as authApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { errorFeedback, successFeedback } from '../../src/lib/feedback';
import { KeyboardScreen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Surface';

/**
 * Forgotten password.
 *
 * Two steps: ask for a reset for an email address, then set a new password with
 * the code from the email. The reset email's link opens this screen with the
 * code filled in (grabgo://forgot?token=…). The API answers the same way
 * whether or not the account exists, so this screen never reveals who has an
 * account.
 */
export default function ForgotPasswordScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; email?: string }>();

  const [step, setStep] = useState<'REQUEST' | 'RESET' | 'DONE'>(params.token ? 'RESET' : 'REQUEST');
  const [email, setEmail] = useState(params.email ?? '');
  const [token, setToken] = useState(params.token ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [devToken, setDevToken] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; token?: string; password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async (): Promise<void> => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setErrors({ email: parsed.error.issues[0]?.message ?? 'Enter a valid email' });
      return;
    }

    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await authApi.requestPasswordReset(parsed.data);
      // A development API has no email provider, so it hands the code back.
      if (result.devToken) {
        setToken(result.devToken);
        setDevToken(true);
      }
      setStep('RESET');
    } catch (caught) {
      errorFeedback();
      setFormError(caught instanceof ApiError ? caught.displayMessage : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    const next: typeof errors = {};
    if (token.trim().length < 16) next.token = 'Paste the code from the email';
    const strength = passwordSchema.safeParse(password);
    if (!strength.success) next.password = strength.error.issues[0]?.message ?? 'Choose a stronger password';
    if (confirm !== password) next.confirm = 'The passwords do not match';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFormError(null);
    try {
      await authApi.confirmPasswordReset({ token: token.trim(), password });
      successFeedback();
      setStep('DONE');
    } catch (caught) {
      errorFeedback();
      setFormError(caught instanceof ApiError ? caught.displayMessage : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScreen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}
      >
        <View style={{ gap: 6 }}>
          <Text variant="title1">
            {step === 'DONE' ? 'Password changed' : step === 'RESET' ? 'Set a new password' : 'Forgot your password?'}
          </Text>
          <Text variant="body" color="textMuted">
            {step === 'DONE'
              ? 'You have been signed out everywhere. Sign in with your new password.'
              : step === 'RESET'
                ? 'If that email has an account, we have sent it a reset link. Open it on this phone, or paste the code here.'
                : 'Enter the email you sign in with and we will send you a reset link.'}
          </Text>
        </View>

        {step === 'REQUEST' ? (
          <Input
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
          />
        ) : null}

        {step === 'RESET' ? (
          <>
            {devToken ? (
              <Card style={{ backgroundColor: theme.colors.warningMuted }}>
                <Text variant="footnote" color="textSecondary">
                  Development server: email is not set up, so the reset code was filled in for you.
                </Text>
              </Card>
            ) : null}
            <Input
              label="Reset code"
              placeholder="From the email"
              autoCapitalize="none"
              autoCorrect={false}
              value={token}
              onChangeText={setToken}
              error={errors.token}
            />
            <Input
              label="New password"
              placeholder="At least 10 characters"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
              error={errors.password}
            />
            <Input
              label="Confirm new password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              value={confirm}
              onChangeText={setConfirm}
              error={errors.confirm}
            />
          </>
        ) : null}

        {formError ? (
          <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
            <Text variant="footnote" color="danger">
              {formError}
            </Text>
          </Card>
        ) : null}

        {step === 'REQUEST' ? (
          <Button label="Send reset link" size="lg" fullWidth loading={busy} onPress={() => void request()} />
        ) : step === 'RESET' ? (
          <>
            <Button label="Set new password" size="lg" fullWidth loading={busy} onPress={() => void reset()} />
            <Button label="Use a different email" variant="ghost" fullWidth onPress={() => setStep('REQUEST')} />
          </>
        ) : (
          <Button label="Sign in" size="lg" fullWidth onPress={() => router.replace('/(auth)/email')} />
        )}
      </ScrollView>
    </KeyboardScreen>
  );
}
