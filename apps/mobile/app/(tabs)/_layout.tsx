import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { useCartCount } from '../../src/stores/cart';
import { Text } from '../../src/components/ui/Text';

/**
 * Bottom navigation.
 *
 * The same five destinations on both platforms, presented the way each expects:
 * iOS gets a translucent blurred bar that content scrolls under, Android an
 * opaque surface with a hairline. Labels stay visible on both — icon-only tabs
 * fail people who do not recognise the glyphs.
 */
export default function TabsLayout(): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cartCount = useCartCount();

  const isIOS = Platform.OS === 'ios';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: isIOS ? 0 : 2,
        },
        tabBarStyle: {
          position: isIOS ? 'absolute' : 'relative',
          borderTopWidth: isIOS ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          backgroundColor: isIOS ? 'transparent' : theme.colors.surface,
          elevation: isIOS ? 0 : 8,
          height: (isIOS ? 50 : 60) + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        tabBarBackground: isIOS
          ? () => (
              <BlurView
                intensity={80}
                tint={theme.isDark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            )
          : undefined,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'search' : 'search-outline'} size={23} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, focused }) => (
            <View>
              <Ionicons
                name={focused ? 'receipt' : 'receipt-outline'}
                size={23}
                color={color}
              />
              {/* The cart lives in the Orders tab badge so a half-finished
                  basket is never more than one tap away from any screen. */}
              {cartCount > 0 ? (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: theme.colors.primary, borderColor: theme.colors.surface },
                  ]}
                >
                  <Text
                    variant="caption"
                    style={{ color: theme.colors.textOnPrimary, fontSize: 10, lineHeight: 13 }}
                    maxScale={1}
                  >
                    {cartCount > 9 ? '9+' : cartCount}
                  </Text>
                </View>
              ) : null}
            </View>
          ),
          tabBarAccessibilityLabel:
            cartCount > 0 ? `Orders, ${cartCount} items in your cart` : 'Orders',
        }}
      />

      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'gift' : 'gift-outline'} size={23} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={23} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
