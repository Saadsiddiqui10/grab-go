import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '../../src/theme';
import { useCartCount } from '../../src/stores/cart';

/**
 * Bottom navigation on iOS: the system tab bar.
 *
 * This is UITabBar itself, so on iOS 26 it is real Liquid Glass and on older
 * versions the standard translucent bar, with SF Symbols, Dynamic Type's large
 * content viewer, VoiceOver and scroll-to-top on re-tap all coming from the
 * OS. Android keeps the JS tab bar in `_layout.tsx`, which Expo Router picks
 * for every platform without its own file.
 *
 * The bar is left to draw its own material: no background colour, no blur of
 * our own. Only the tint is the brand's.
 */
export default function TabsLayout(): React.JSX.Element {
  const theme = useTheme();
  const cartCount = useCartCount();

  return (
    <NativeTabs tintColor={theme.colors.primary} badgeBackgroundColor={theme.colors.primary}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
      </NativeTabs.Trigger>

      {/* The cart count rides on Orders so a half-finished basket is one tap
          from anywhere; the system badge announces itself to VoiceOver. */}
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bag', selected: 'bag.fill' }} />
        {/* Rendered only when there is something in the cart: the `hidden`
            prop still draws a "0" badge in this version. */}
        {cartCount > 0 ? (
          <NativeTabs.Trigger.Badge>{cartCount > 9 ? '9+' : String(cartCount)}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="rewards">
        <NativeTabs.Trigger.Label>Rewards</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gift', selected: 'gift.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
