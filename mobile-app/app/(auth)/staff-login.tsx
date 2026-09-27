import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/AuthContext';
import { AuthForm, AuthLink } from '../../src/components/AuthForm';
import { Caption } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { space } from '../../src/theme';

export default function StaffLoginScreen() {
  const router = useRouter();
  const { loginStaff } = useAuth();
  const t = useT();

  return (
    <AuthForm
      title={t('auth.staffLoginTitle')}
      subtitle={t('auth.staffLoginSubtitle')}
      submitLabel={t('auth.staffLoginSubmit')}
      fields={[
        { key: 'email', label: t('auth.staffEmailLabel'), placeholder: t('auth.staffEmailPlaceholder'), keyboard: 'email-address' },
        { key: 'password', label: t('auth.passwordLabel'), secure: true },
      ]}
      onSubmit={async v => { await loginStaff(v.email.trim(), v.password); }}
      footer={
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <AuthLink label={t('auth.backToCitizen')} onPress={() => router.replace('/(auth)/login')} />
          <Caption style={{ textAlign: 'center' }}>
            {t('auth.staffDemoAccount')}
          </Caption>
        </View>
      }
    />
  );
}
