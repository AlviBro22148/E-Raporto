import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useT } from '../i18n';
import { MIN_TARGET, useTheme } from '../theme';

/**
 * Eye glyph drawn from plain Views.
 *
 * The project ships no icon library and no SVG renderer, and an emoji eye depends on the device's
 * font coverage to render at a predictable size. Three rectangles do not: the outline is a pill, the
 * pupil a dot, and the struck-through state adds a diagonal — which is what carries the on/off
 * meaning, so the state is never signalled by colour alone.
 */
function EyeIcon({ off, color }: { off: boolean; color: string }) {
  return (
    <View style={{ width: 24, height: 18, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 20,
          height: 13,
          borderRadius: 10,
          borderWidth: 1.6,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 5.5, height: 5.5, borderRadius: 3, backgroundColor: color }} />
      </View>
      {off && (
        <View
          style={{
            position: 'absolute',
            width: 24,
            height: 1.6,
            borderRadius: 1,
            backgroundColor: color,
            transform: [{ rotate: '-45deg' }],
          }}
        />
      )}
    </View>
  );
}

/**
 * A password field with a reveal toggle.
 *
 * Typing a password blind on a phone keyboard is where sign-in attempts go to die, so every password
 * field in the app gets the same control rather than each screen solving it differently. The input
 * reserves a touch-target's worth of room on its right so revealed text never runs under the button.
 *
 * `autoCorrect` is forced off: leaving it on lets the keyboard offer suggestions for the password
 * once it becomes visible, and on Android it can also clear the field as `secureTextEntry` flips.
 */
export function PasswordInput({ style, ...props }: TextInputProps) {
  const t = useTheme();
  const tr = useT();
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ justifyContent: 'center' }}>
      <TextInput
        {...props}
        // After the spread, not before: none of these are meaningful to override on a password
        // field, and a caller passing the defaults it uses for ordinary text fields is exactly how
        // they got set wrong. autoCapitalize in particular has to be "none" — Android's IME holds
        // the first character in a composing state while it decides whether to capitalise it for a
        // new sentence, which leaves that one character sitting there unmasked until it commits,
        // and would capitalise the first letter of a typed password on top of that.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={!visible}
        style={[style, { paddingRight: MIN_TARGET }]}
      />
      <Pressable
        onPress={() => setVisible(v => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? tr('passwordInput.hide') : tr('passwordInput.show')}
        accessibilityState={{ selected: visible }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: MIN_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <EyeIcon off={!visible} color={visible ? t.brand2 : t.ink3} />
      </Pressable>
    </View>
  );
}
