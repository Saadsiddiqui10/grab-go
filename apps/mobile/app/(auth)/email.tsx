import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema, fullNameSchema, passwordSchema } from '@grabgo/validation';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import { auth as authApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { errorFeedback, successFeedback } from '../../src/lib/feedback';
import { KeyboardScreen } from '../../src/components/ui/Screen';
import { Text } from '../../src/components/ui/Text';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Card, SegmentedControl } from '../../src/components/ui/Surface';

/**
 * Email sign-in and registration.
 *
 * The form is validated with the same Zod schemas the API uses, so the rules a
 * customer meets here are exactly the rules the server enforces — no drift, and
 * server-side field errors map straight onto the inputs.
 */

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

const signUpSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

type Mode = 'SIGN_IN' | 'SIGN_UP';

export default function EmailScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const applySession = useAuthStore((state) => state.applySession);
  const pendingReferralCode = useAuthStore((state) => state.pendingReferralCode);

  const [mode, setMode] = useState<Mode>('SIGN_IN');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<{ fullName?: string; email: string; password: string }>({
    resolver: zodResolver(mode === 'SIGN_IN' ? signInSchema : signUpSchema),
    defaultValues: { fullName: '', email: '', password: '' },
    mode: 'onBlur',
  });

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setFormError(null);

    try {
      const session =
        mode === 'SIGN_IN'
          ? await authApi.login({ email: values.email, password: values.password })
          : await authApi.register({
              fullName: values.fullName ?? '',
              email: values.email,
              password: values.password,
              ...(pendingReferralCode ? { referralCode: pendingReferralCode } : {}),
            });

      successFeedback();
      await applySession(session);
      router.replace('/(tabs)');
    } catch (caught) {
      errorFeedback();

      // The API returns field-level errors; map them onto the form so the
      // message appears under the input that caused it.
      if (caught instanceof ApiError && caught.fields) {
        for (const [field, messages] of Object.entries(caught.fields)) {
          if (field === 'email' || field === 'password' || field === 'fullName') {
            form.setError(field, { message: messages[0] ?? 'Invalid value' });
          }
        }
      }

      setFormError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'Something went wrong. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  });

  return (
    <KeyboardScreen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}
      >
        <View style={{ gap: 6 }}>
          <Text variant="title1">
            {mode === 'SIGN_IN' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text variant="body" color="textMuted">
            {mode === 'SIGN_IN'
              ? 'Sign in to pick up where you left off.'
              : 'One account for every cafe on Grab & Go.'}
          </Text>
        </View>

        <SegmentedControl
          options={[
            { value: 'SIGN_IN', label: 'Sign in' },
            { value: 'SIGN_UP', label: 'Create account' },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setFormError(null);
            form.clearErrors();
          }}
        />

        {mode === 'SIGN_UP' ? (
          <Controller
            control={form.control}
            name="fullName"
            render={({ field, fieldState }) => (
              <Input
                label="Your name"
                placeholder="Saad Ahmed"
                autoCapitalize="words"
                textContentType="name"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
        ) : null}

        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Input
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Input
              label="Password"
              placeholder={mode === 'SIGN_UP' ? 'At least 10 characters' : 'Your password'}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'SIGN_UP' ? 'new-password' : 'current-password'}
              textContentType={mode === 'SIGN_UP' ? 'newPassword' : 'password'}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              {...(mode === 'SIGN_UP'
                ? { hint: 'A memorable passphrase beats a short complicated one.' }
                : {})}
            />
          )}
        />

        {pendingReferralCode && mode === 'SIGN_UP' ? (
          <Card style={{ backgroundColor: theme.colors.primarySubtle }}>
            <Text variant="footnote" color="textSecondary">
              Referral code {pendingReferralCode} will be applied to your account.
            </Text>
          </Card>
        ) : null}

        {formError ? (
          <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
            <Text variant="footnote" color="danger">
              {formError}
            </Text>
          </Card>
        ) : null}

        <Button
          label={mode === 'SIGN_IN' ? 'Sign in' : 'Create account'}
          size="lg"
          fullWidth
          loading={busy}
          onPress={() => void submit()}
        />

        <Button
          label="Use my phone number instead"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/(auth)/phone')}
        />
      </ScrollView>
    </KeyboardScreen>
  );
}
