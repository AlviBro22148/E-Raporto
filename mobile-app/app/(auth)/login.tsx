import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/AuthContext';
import { AuthForm, AuthLink } from '../../src/components/AuthForm';
import { Caption } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { space } from '../../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { loginCitizen } = useAuth();
  const t = useT();

  return (
    <AuthForm
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      submitLabel={t('auth.loginSubmit')}
      fields={[
        { key: 'email', label: t('auth.emailLabel'), placeholder: t('auth.emailPlaceholder'), keyboard: 'email-address' },
        { key: 'password', label: t('auth.passwordLabel'), secure: true },
      ]}
      onSubmit={async v => { await loginCitizen(v.email.trim(), v.password); }}
      footer={
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <AuthLink label={t('auth.noAccount')} onPress={() => router.push('/(auth)/register')} />
          <AuthLink label={t('auth.staffLink')} onPress={() => router.push('/(auth)/staff-login')} />
          <Caption style={{ textAlign: 'center' }}>
            {t('auth.mapWithoutAccount')}
          </Caption>
        </View>
      }
    />
  );
}
