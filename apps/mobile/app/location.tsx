import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme';
import { useLocationStore } from '../src/stores/location';
import { useCities } from '../src/api/hooks';
import { Screen } from '../src/components/ui/Screen';
import { Text } from '../src/components/ui/Text';
import { Card, Divider, ListRow } from '../src/components/ui/Surface';
import { Button } from '../src/components/ui/Button';
import { SearchInput } from '../src/components/ui/Input';
import { ErrorState, ListSkeleton } from '../src/components/ui/States';

/**
 * Choose your area.
 *
 * The screen that makes location genuinely optional. A customer who declined the
 * OS prompt — or who is ordering for a cafe near the office rather than near
 * their current position — picks an area here and gets the same experience.
 */
export default function LocationScreen(): React.JSX.Element {
  const theme = useTheme();
  const router = useRouter();

  const cities = useCities();
  const permission = useLocationStore((state) => state.permission);
  const isLocating = useLocationStore((state) => state.isLocating);
  const manualArea = useLocationStore((state) => state.manualArea);
  const requestAndLocate = useLocationStore((state) => state.requestAndLocate);
  const setManualArea = useLocationStore((state) => state.setManualArea);

  const [search, setSearch] = useState('');

  const areas = (cities.data ?? []).flatMap((city) =>
    city.areas.map((area) => ({ ...area, cityName: city.name })),
  );

  const filtered = search.trim()
    ? areas.filter((area) =>
        area.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : areas;

  const useCurrentLocation = async (): Promise<void> => {
    const granted = await requestAndLocate();
    if (granted) {
      // GPS takes precedence over a previously chosen area.
      await setManualArea(null);
      router.back();
    }
  };

  return (
    <Screen edges={{ bottom: true }}>
      <View style={{ flex: 1, gap: theme.spacing.base, paddingTop: theme.spacing.base }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search areas in Karachi…"
        />

        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.spacing.base }}>
            <ListRow
              icon="navigate"
              title={isLocating ? 'Finding you…' : 'Use my current location'}
              subtitle={
                permission === 'denied'
                  ? 'Blocked — enable location for Grab & Go in Settings'
                  : 'Sorts cafes by how close they are'
              }
              tone="primary"
              onPress={() => void useCurrentLocation()}
            />

            {manualArea ? (
              <>
                <Divider inset={44} />
                <ListRow
                  icon="close-circle-outline"
                  title="Clear selected area"
                  onPress={() => {
                    void setManualArea(null);
                    router.back();
                  }}
                />
              </>
            ) : null}
          </View>
        </Card>

        <Text variant="overline" color="textMuted">
          KARACHI AREAS
        </Text>

        {cities.isLoading ? (
          <ListSkeleton rows={6} />
        ) : cities.isError ? (
          <ErrorState compact onRetry={() => void cities.refetch()} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(area) => area.id}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <Divider inset={theme.spacing.base} />}
            contentContainerStyle={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.lg,
            }}
            ListEmptyComponent={
              <View style={{ padding: theme.spacing.xl }}>
                <Text variant="footnote" color="textMuted" align="center">
                  No areas matched that search.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const selected = manualArea?.areaId === item.id;

              return (
                <View style={{ paddingHorizontal: theme.spacing.base }}>
                  <ListRow
                    title={item.name}
                    subtitle={item.cityName}
                    onPress={() => {
                      void setManualArea({
                        areaId: item.id,
                        areaName: item.name,
                        cityId: item.cityId,
                        cityName: item.cityName,
                        latitude: item.latitude,
                        longitude: item.longitude,
                      });
                      router.back();
                    }}
                    right={
                      selected ? (
                        <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                      ) : undefined
                    }
                  />
                </View>
              );
            }}
          />
        )}

        <Button label="Done" variant="secondary" fullWidth onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
