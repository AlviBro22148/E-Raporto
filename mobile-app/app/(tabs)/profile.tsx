import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuth } from '../../src/AuthContext';
import { useFeedback } from '../../src/components/Feedback';
import { PasswordInput } from '../../src/components/PasswordInput';
import { Body, Button, Caption, Card, Heading, Label, Title, formatDateTime } from '../../src/components/ui';
import { useLocale, useSetLocale, useT, type Locale } from '../../src/i18n';
import { MIN_TARGET, radius, space, type, useTheme } from '../../src/theme';

export default function ProfileScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const insets = useSafeAreaInsets();
  const { citizen, signOut, setCitizen } = useAuth();
  const { notify, confirm } = useFeedback();

  const [fullName, setFullName] = useState(citizen?.fullName ?? '');
  const [phone, setPhone] = useState(citizen?.phone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  if (!citizen) return null;

  const profileDirty = fullName.trim() !== citizen.fullName || (phone ?? '') !== (citizen.phone ?? '');

  async function saveProfile() {
    if (!fullName.trim()) {
      notify({ tone: 'warning', title: tr('profile.nameEmptyWarning') });
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api.updateProfile({ fullName: fullName.trim(), phone: phone.trim() });
      setCitizen(updated);
      notify({ tone: 'success', title: tr('profile.savedTitle'), message: tr('profile.savedMessage') });
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('profile.saveFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    if (newPassword.length < 6) {
      notify({ tone: 'warning', title: tr('profile.passwordTooShort') });
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      notify({ tone: 'success', title: tr('profile.passwordChangedTitle'), message: tr('profile.passwordChangedMessage') });
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('profile.passwordChangeFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setSavingPassword(false);
    }
  }

  async function confirmSignOut() {
    const ok = await confirm({
      title: tr('profile.signOutConfirmTitle'),
      message: tr('profile.signOutConfirmMessage'),
      confirmLabel: tr('profile.signOutConfirmLabel'),
      tone: 'danger',
    });
    if (ok) void signOut();
  }

  const input = {
    minHeight: MIN_TARGET,
    backgroundColor: t.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.borderStrong,
    paddingHorizontal: space.md,
    color: t.ink,
    ...type.body,
  } as const;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Identity header — the name here is exactly what appears on every report they file. */}
      <Card style={{ alignItems: 'center', gap: space.sm }}>
        <View
          style={{
            width: 68, height: 68, borderRadius: 34,
            backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 26, fontWeight: '700', color: t.brand2 }}>
            {citizen.fullName.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <Title>{citizen.fullName}</Title>
        <Caption>{citizen.email}</Caption>
        <Caption>{tr('profile.memberSince', { date: formatDateTime(citizen.createdAt, locale) })}</Caption>
      </Card>

      <Card style={{ gap: space.md }}>
        <Heading>{tr('profile.language.title')}</Heading>
        <Caption>{tr('profile.language.hint')}</Caption>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {(['sq', 'en'] as Locale[]).map(code => {
            const active = locale === code;
            return (
              <Pressable
                key={code}
                onPress={() => {
                  setLocale(code);
                  // Best-effort: an OS push notification is sent server-side while the app may be
                  // closed, so the server needs to know the language too. The in-app UI already
                  // switched — this call failing silently costs nothing but a future push's language.
                  api.updatePreferredLocale(code).catch(() => {});
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: MIN_TARGET,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  backgroundColor: active ? t.brand2 : t.surface,
                  borderWidth: 1,
                  borderColor: active ? t.brand2 : t.borderStrong,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.bodyStrong, { color: active ? '#fff' : t.ink }]}>
                  {tr(`profile.language.${code}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <Heading>{tr('profile.accountData')}</Heading>
        <Caption>
          {tr('profile.accountDataHint')}
        </Caption>

        <View style={{ gap: space.xs }}>
          <Label>{tr('profile.fullNameLabel')}</Label>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={input}
            accessibilityLabel={tr('profile.fullNameLabel')}
          />
        </View>

        <View style={{ gap: space.xs }}>
          <Label>{tr('profile.phoneLabel')}</Label>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder={tr('profile.phonePlaceholder')}
            placeholderTextColor={t.ink3}
            style={input}
            accessibilityLabel={tr('profile.phoneLabel')}
          />
          <Caption>{tr('profile.phoneVisibility')}</Caption>
        </View>

        <Button
          title={tr('profile.saveChanges')}
          onPress={saveProfile}
          disabled={!profileDirty}
          loading={savingProfile}
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <Heading>{tr('profile.changePasswordTitle')}</Heading>

        <View style={{ gap: space.xs }}>
          <Label>{tr('profile.currentPasswordLabel')}</Label>
          <PasswordInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            style={input}
            accessibilityLabel={tr('profile.currentPasswordLabel')}
          />
        </View>

        <View style={{ gap: space.xs }}>
          <Label>{tr('profile.newPasswordLabel')}</Label>
          <PasswordInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder={tr('profile.newPasswordPlaceholder')}
            placeholderTextColor={t.ink3}
            style={input}
            accessibilityLabel={tr('profile.newPasswordLabel')}
          />
        </View>

        <Button
          title={tr('profile.changePasswordButton')}
          variant="secondary"
          onPress={savePassword}
          disabled={!currentPassword || !newPassword}
          loading={savingPassword}
        />
      </Card>

      <Card style={{ gap: space.sm }}>
        <Heading>{tr('profile.privacyTitle')}</Heading>
        <Body muted>
          {tr('profile.privacyBody')}
        </Body>
      </Card>

      {/* Destructive action last and visually separate, so it is never the thing a thumb lands on. */}
      <Button title={tr('profile.signOut')} variant="danger" onPress={confirmSignOut} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
