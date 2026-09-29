import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth';
import { useUpdateProfile } from '../../src/api/hooks';
import { auth as authApi } from '../../src/api/endpoints';
import { ApiError } from '../../src/api/client';
import { errorFeedback, successFeedback } from '../../src/lib/feedback';
import { ScrollScreen } from '../../src/components/ui/Screen';
import { Text, SectionTitle } from '../../src/components/ui/Text';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Card, Divider, ListRow } from '../../src/components/ui/Surface';

/**
 * Personal details and account deletion.
 *
 * Deletion is behind a two-step confirmation and is explicit about what happens:
 * the account goes, the order records stay, because those are financial records
 * the cafes and the platform are required to keep.
 */
export default function AccountScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const updateProfile = useUpdateProfile();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    router.replace('/(auth)/welcome');
    return <></>;
  }

  const save = (): void => {
    setError(null);
    setSaved(false);

    updateProfile.mutate(
      {
        ...(fullName.trim() && fullName !== user.fullName ? { fullName: fullName.trim() } : {}),
        ...(email.trim() && email !== user.email ? { email: email.trim() } : {}),
      },
      {
        onSuccess: () => {
          successFeedback();
          setSaved(true);
        },
        onError: (caught) => {
          errorFeedback();
          setError(
            caught instanceof ApiError
              ? caught.displayMessage
              : 'We could not save those changes.',
          );
        },
      },
    );
  };

  const confirmDelete = (): void => {
    Alert.alert(
      'Delete your account?',
      'This cannot be undone. Your profile, points and rewards are removed. Past orders are kept as financial records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you sure?', 'Deleting is permanent.', [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete permanently',
                style: 'destructive',
                onPress: () => {
                  void authApi
                    .deleteAccount()
                    .then(async () => {
                      await signOut();
                      router.replace('/(tabs)');
                    })
                    .catch((caught: unknown) => {
                      setError(
                        caught instanceof ApiError
                          ? caught.displayMessage
                          : 'We could not delete your account. Contact support.',
                      );
                    });
                },
              },
            ]);
          },
        },
      ],
    );
  };

  const dirty = fullName !== user.fullName || email !== (user.email ?? '');

  return (
    <ScrollScreen contentContainerStyle={{ paddingTop: theme.spacing.base, gap: theme.spacing.lg }}>
      <SectionTitle>Personal details</SectionTitle>

      <View style={{ gap: theme.spacing.md }}>
        <Input
          label="Name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          textContentType="name"
        />

        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          hint={
            user.emailVerified ? 'Verified' : 'Changing this means verifying the new address.'
          }
        />

        <Input
          label="Phone"
          value={user.phone ?? 'Not added'}
          editable={false}
          hint={user.phoneVerified ? 'Verified' : 'Not verified'}
        />
      </View>

      {error ? (
        <Card style={{ backgroundColor: theme.colors.dangerMuted }}>
          <Text variant="footnote" color="danger">
            {error}
          </Text>
        </Card>
      ) : null}

      {saved ? (
        <Card style={{ backgroundColor: theme.colors.successMuted }}>
          <Text variant="footnote" color="success">
            Your details were saved.
          </Text>
        </Card>
      ) : null}

      <Button
        label="Save changes"
        fullWidth
        disabled={!dirty}
        loading={updateProfile.isPending}
        onPress={save}
      />

      <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
        <Text variant="overline" color="textMuted">
          DANGER ZONE
        </Text>

        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.spacing.base }}>
            <ListRow
              icon="log-out-outline"
              title="Sign out of all devices"
              onPress={() => void signOut({ allDevices: true })}
            />
            <Divider inset={44} />
            <ListRow
              icon="trash-outline"
              title="Delete account"
              subtitle="Permanent. Past orders are retained."
              destructive
              onPress={confirmDelete}
            />
          </View>
        </Card>
      </View>
    </ScrollScreen>
  );
}
