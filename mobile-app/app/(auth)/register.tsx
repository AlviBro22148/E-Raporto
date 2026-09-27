import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/AuthContext';
import { AuthForm, AuthLink } from '../../src/components/AuthForm';
import { Caption } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { space } from '../../src/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const { registerCitizen } = useAuth();
  const t = useT();

  return (
    <AuthForm
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      submitLabel={t('auth.registerSubmit')}
      fields={[
        { key: 'fullName', label: t('auth.fullNameLabel'), placeholder: t('auth.fullNamePlaceholder'), autoCapitalize: 'words' },
        { key: 'email', label: t('auth.emailLabel'), placeholder: t('auth.emailPlaceholder'), keyboard: 'email-address' },
        { key: 'phone', label: t('auth.phoneLabel'), placeholder: t('auth.phonePlaceholder'), keyboard: 'phone-pad', optional: true },
        { key: 'password', label: t('auth.passwordLabel'), placeholder: t('auth.registerPasswordPlaceholder'), secure: true },
      ]}
      onSubmit={async v => {
        if (v.password.length < 6) throw new Error(t('auth.passwordTooShort'));
        await registerCitizen({
          fullName: v.fullName.trim(),
          email: v.email.trim(),
          password: v.password,
          phone: v.phone?.trim() || undefined,
        });
      }}
      footer={
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <AuthLink label={t('auth.haveAccount')} onPress={() => router.replace('/(auth)/login')} />
          <Caption style={{ textAlign: 'center' }}>
            {t('auth.phoneHint')}
          </Caption>
        </View>
      }
    />
  );
}
