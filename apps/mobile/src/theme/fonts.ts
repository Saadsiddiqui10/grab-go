import * as Font from 'expo-font';
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import type { TextStyle } from 'react-native';

/**
 * The app's typefaces.
 *
 * Fraunces, a soft "old-style" serif with a little warmth in its curves, sets
 * headings: it reads like a café chalkboard and sits naturally on the
 * espresso, cream and maroon palette. DM Sans sets everything else, so
 * prices, times and small labels stay crisp.
 *
 * Custom fonts on iOS and Android cannot be bolded with `fontWeight`; each
 * weight is its own family. `fontFor` maps a weight to the right file.
 */
export const fontFiles = {
  'Fraunces-Medium': Fraunces_500Medium,
  'Fraunces-SemiBold': Fraunces_600SemiBold,
  'Fraunces-Bold': Fraunces_700Bold,
  'DMSans-Regular': DMSans_400Regular,
  'DMSans-Medium': DMSans_500Medium,
  'DMSans-SemiBold': DMSans_600SemiBold,
  'DMSans-Bold': DMSans_700Bold,
};

let loaded = false;

/** Loads the fonts; text falls back to the system font if this fails. */
export async function loadFonts(): Promise<void> {
  try {
    await Font.loadAsync(fontFiles);
    loaded = true;
  } catch {
    loaded = false;
  }
}

/** Font family for a weight, in the heading or body face. */
export function fontFor(weight: TextStyle['fontWeight'], heading: boolean): string | undefined {
  if (!loaded) return undefined;
  const w = typeof weight === 'number' ? weight : Number.parseInt(String(weight ?? '400'), 10) || 400;
  if (heading) {
    if (w >= 700) return 'Fraunces-Bold';
    if (w >= 600) return 'Fraunces-SemiBold';
    return 'Fraunces-Medium';
  }
  if (w >= 700) return 'DMSans-Bold';
  if (w >= 600) return 'DMSans-SemiBold';
  if (w >= 500) return 'DMSans-Medium';
  return 'DMSans-Regular';
}
