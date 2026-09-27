import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useSetLocale, useT, type Locale } from '../i18n';
import { PasswordInput } from './PasswordInput';
import { Body, Button, Caption, Title } from './ui';
import { MIN_TARGET, radius, space, type, useTheme } from '../theme';

/**
 * The one language switch reachable before signing in. The citizen profile screen has its own —
 * this exists because that one is behind a login wall, and a citizen who wants English has to be
 * able to say so on the very first screen they see, not after creating an account in the wrong
 * language. Small and top-corner on purpose: it's a preference, not the point of this screen.
 */
function AuthLanguageSwitch({ top }: { top: number }) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useTheme();

  return (
    <View
      style={{
        position: 'absolute', top: top + space.sm, right: space.lg, zIndex: 10, elevation: 10,
        flexDirection: 'row', backgroundColor: t.brandSoft, borderRadius: radius.pill,
        borderWidth: 1, borderColor: t.brand2, padding: 3, gap: 2,
      }}
    >
      {(['sq', 'en'] as Locale[]).map(code => {
        const active = locale === code;
        return (
          <Pressable
            key={code}
            onPress={() => setLocale(code)}
            accessibilityRole="button"
            accessibilityLabel={code === 'sq' ? 'Shqip' : 'English'}
            accessibilityState={{ selected: active }}
            hitSlop={6}
            style={{
              minWidth: 34, minHeight: 30, alignItems: 'center', justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: active ? t.brand2 : 'transparent',
            }}
          >
            <Text style={[type.caption, { fontWeight: '700', color: active ? '#fff' : t.ink3 }]}>
              {code.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface Field {
  key: string;
  label: string;
  placeholder?: string;
  secure?: boolean;
  keyboard?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'words';
  optional?: boolean;
}

/**
 * Shared form chrome for sign-in / sign-up / staff sign-in.
 *
 * One component rather than three near-identical screens: the fields differ, the layout, keyboard
 * handling, error surface and touch targets do not — and keeping them identical is what makes the
 * three screens feel like one app.
 */
export function AuthForm({
  title, subtitle, fields, submitLabel, onSubmit, footer, error, brandHeader = true,
}: {
  title: string;
  subtitle?: string;
  fields: Field[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  footer?: React.ReactNode;
  error?: string | null;
  brandHeader?: boolean;
}) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const shownError = error ?? localError;

  const missing = fields.filter(f => !f.optional && !values[f.key]?.trim());
  const canSubmit = missing.length === 0 && !submitting;

  async function handleSubmit() {
    setLocalError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : tr('auth.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      // t.surface, not t.bg — this screen is full-bleed with no separate header/tab-bar chrome, so
      // its own background is what touches the status bar / gesture-nav bar. Those are painted with
      // t.surface (see app/_layout.tsx's SystemUI.setBackgroundColorAsync), so this has to match that,
      // not the plain page background every other screen uses under its header/tab-bar instead.
      style={{ flex: 1, backgroundColor: t.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AuthLanguageSwitch top={insets.top} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: space.lg,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {brandHeader && (
          <View style={{ alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
            <Image
              source={require('../../assets/logo-emblem.png')}
              accessibilityIgnoresInvertColors
              style={{ width: 76, height: 76 }}
              resizeMode="contain"
            />
            <Text style={[type.caption, { color: t.ink3, letterSpacing: 1.2 }]}>
              {tr('auth.brandTag')}
            </Text>
          </View>
        )}

        <View style={{ gap: space.xs }}>
          <Title>{title}</Title>
          {subtitle && <Body muted>{subtitle}</Body>}
        </View>

        <View style={{ gap: space.md }}>
          {fields.map(field => {
            // Shared by both branches so a password field is identical to every other field apart
            // from the reveal toggle.
            const inputProps = {
              value: values[field.key] ?? '',
              onChangeText: (text: string) => setValues(v => ({ ...v, [field.key]: text })),
              placeholder: field.placeholder,
              placeholderTextColor: t.ink3,
              keyboardType: field.keyboard ?? 'default',
              autoCapitalize:
                field.autoCapitalize ?? (field.keyboard === 'email-address' ? 'none' : 'sentences'),
              autoCorrect: false,
              accessibilityLabel: field.label,
              style: {
                minHeight: MIN_TARGET,
                backgroundColor: t.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: t.borderStrong,
                paddingHorizontal: space.md,
                color: t.ink,
                ...type.body,
              },
            } as const;

            return (
              <View key={field.key} style={{ gap: space.xs }}>
                <Text style={[type.label, { color: t.ink3, textTransform: 'uppercase' }]}>
                  {field.label}{field.optional ? tr('auth.optionalSuffix') : ''}
                </Text>
                {field.secure
                  ? <PasswordInput {...inputProps} />
                  : <TextInput {...inputProps} />}
              </View>
            );
          })}
        </View>

        {shownError && (
          <View
            accessibilityRole="alert"
            style={{
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: `${t.danger}18`,
              borderWidth: 1,
              borderColor: `${t.danger}55`,
            }}
          >
            <Text style={[type.callout, { color: t.danger }]}>{shownError}</Text>
          </View>
        )}

        <Button
          title={submitLabel}
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          style={{ minHeight: MIN_TARGET + 6 }}
        />

        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={{ minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={[type.body, { color: t.brand2, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

export { Caption };
