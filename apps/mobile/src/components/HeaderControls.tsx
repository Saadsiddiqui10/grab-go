import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { tapFeedback } from '../lib/feedback';
import { FigmaIcon } from '../design/assets';
import { Text } from './ui/Text';
import { AppIcon } from './ui/AppIcon';

/** The round pink map button beside the Home and Discover titles. */
export function MapButton({
  onPress,
  background,
  iconColour,
}: {
  onPress: () => void;
  /** Overrides for a themed category look. */
  background?: string;
  iconColour?: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="Show cafes on a map"
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background ?? theme.colors.accentSoft,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {/* A filled folded map reads at a glance; the outline was thin. */}
      <AppIcon name="mapFilled" size={21} color={iconColour ?? theme.colors.onAccentSoft} />
    </Pressable>
  );
}

/** "📍 Karachi ⌄" under the title: opens the area picker. */
export function LocationRow({
  label,
  onPress,
  pinColour,
  textColour,
}: {
  label: string;
  onPress: () => void;
  pinColour?: string;
  textColour?: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Location: ${label}. Change area`}
      hitSlop={8}
      style={{ alignSelf: 'flex-start', marginTop: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <FigmaIcon name="mapPin" width={14} height={17} tint={pinColour ?? theme.colors.onAccentSoft} />
        <Text
          variant="subhead"
          color="textSecondary"
          style={[{ fontSize: 14, fontWeight: '400' }, textColour ? { color: textColour } : null]}
        >
          {label}
        </Text>
        <FigmaIcon name="chevronDown" size={13} tint={textColour ?? theme.colors.textSecondary} />
      </View>
    </Pressable>
  );
}
