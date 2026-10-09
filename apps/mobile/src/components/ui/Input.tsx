import { forwardRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { minTouchTarget, textStyle, useTheme } from '../../theme';
import { Text } from './Text';
import { FigmaIcon } from '../../design/assets';
import { fontFor } from '../../theme/fonts';

/**
 * Text input.
 *
 * iOS draws a filled field with a soft radius; Android uses the Material-style
 * underline-free filled box with a stronger focus ring. Both surface the error
 * text below the field, with `accessibilityLabel` wired so a screen reader
 * announces the label, the value and the problem together.
 */

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | undefined;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Rendered before the input, e.g. the +92 dial code. */
  prefix?: string;
  onClear?: () => void;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, icon, prefix, onClear, value, ...props },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="subhead" color="textSecondary">
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            minHeight: Math.max(52, minTouchTarget),
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.surface,
            borderColor,
            // A thicker ring on focus is what makes the state visible at a
            // glance and satisfies the contrast requirement for focus.
            borderWidth: focused || error ? 2 : 1,
            paddingHorizontal: theme.spacing.base,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={focused ? theme.colors.primary : theme.colors.textMuted}
          />
        ) : null}

        {prefix ? (
          <Text variant="body" color="textSecondary">
            {prefix}
          </Text>
        ) : null}

        <TextInput
          ref={ref}
          {...props}
          value={value}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          placeholderTextColor={theme.colors.textMuted}
          selectionColor={theme.colors.primary}
          // Android draws its own underline inside TextInput; the container
          // already provides the field, so it is removed.
          underlineColorAndroid="transparent"
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          style={[
            styles.input,
            inputTextStyle(),
            { color: theme.colors.textPrimary, paddingVertical: Platform.OS === 'ios' ? 14 : 10 },
          ]}
        />

        {onClear && value ? (
          <Pressable
            onPress={onClear}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear"
          >
            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * One-time-code entry.
 *
 * A single input with `oneTimeCode` / `sms` autofill rather than six separate
 * boxes: the OS can then fill it from the SMS automatically, which is the whole
 * point of phone verification being fast.
 */
export function OtpInput({
  value,
  onChange,
  error,
  length = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
  length?: number;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        autoFocus
        maxLength={length}
        accessibilityLabel={`${length} digit verification code`}
        placeholder="------"
        placeholderTextColor={theme.colors.textMuted}
        selectionColor={theme.colors.primary}
        style={[
          {
            textAlign: 'center',
            letterSpacing: 12,
            fontSize: 30,
            fontWeight: '700',
            color: theme.colors.textPrimary,
            borderRadius: theme.radii.lg,
            borderWidth: error ? 2 : 1,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surface,
            paddingVertical: theme.spacing.base,
          },
        ]}
      />
      {error ? (
        <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Search field for the discover screen. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search cafes, coffee, breakfast…',
  onSubmit,
  autoFocus,
  fill,
  inkColour,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** Overrides for a themed category look. */
  fill?: string;
  inkColour?: string;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.field,
        {
          minHeight: 48,
          gap: 12,
          borderRadius: 14,
          backgroundColor: fill ?? theme.colors.field,
          borderWidth: 0,
          paddingHorizontal: 14,
        },
      ]}
    >
      <FigmaIcon name="search" size={18} tint={inkColour ?? theme.colors.fieldText} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={inkColour ?? theme.colors.fieldText}
        selectionColor={theme.colors.primary}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search"
        underlineColorAndroid="transparent"
        style={[styles.input, inputTextStyle(), { color: theme.colors.textPrimary, paddingVertical: 12 }]}
      />
      {/* iOS provides its own clear button; Android needs one drawn. */}
      {Platform.OS === 'android' && value.length > 0 ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Body type for TextInput, minus the line height: on iOS a fixed lineHeight
 * pushes input text off its baseline once Dynamic Type enlarges the font.
 */
const { lineHeight: _lineHeight, ...bodyStyle } = textStyle('body');
/** Fonts load at startup, before any input renders, so this resolves once. */
const inputTextStyle = (): typeof bodyStyle => {
  const family = fontFor('400', false);
  return family ? { ...bodyStyle, fontFamily: family, fontWeight: undefined } : bodyStyle;
};

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    padding: 0,
  },
});
