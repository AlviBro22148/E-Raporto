import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/AuthContext';
import { useFeedback } from '../../src/components/Feedback';
import { Body, Button, Caption, Card, Heading, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { space, type, useTheme } from '../../src/theme';

export default function StaffAccountScreen() {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { staff, signOut } = useAuth();
  const { confirm } = useFeedback();

  if (!staff) return null;

  async function confirmSignOut() {
    const ok = await confirm({
      title: tr('staffAccount.signOutConfirmTitle'),
      message: tr('staffAccount.signOutConfirmMessage'),
      confirmLabel: tr('staffAccount.signOutConfirmLabel'),
      tone: 'danger',
    });
    if (ok) void signOut();
  }

  const roleLabel = staff.role === 'Admin' ? tr('staffAccount.roleAdmin')
    : staff.role === 'Supervisor' ? tr('staffAccount.roleSupervisor')
    : tr('staffAccount.roleFieldAgent');

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
    >
      <Card style={{ alignItems: 'center', gap: space.sm }}>
        <View
          style={{
            width: 68, height: 68, borderRadius: 34,
            backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 26, fontWeight: '700', color: t.brand2 }}>
            {staff.fullName.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <Title>{staff.fullName}</Title>
        <Caption>{staff.email}</Caption>
        <Caption>{staff.jobTitle ?? roleLabel}</Caption>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Heading>{tr('staffAccount.roleAndAccess')}</Heading>
        <Row label={tr('staffAccount.roleRow')} value={roleLabel} />
        <Row label={tr('staffAccount.departmentRow')} value={staff.departmentName ?? tr('staffAccount.allDepartments')} />
        <Body muted>
          {staff.role === 'Admin' ? tr('staffAccount.adminNote') : tr('staffAccount.staffNote')}
        </Body>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Heading>{tr('staffAccount.aboutAiTitle')}</Heading>
        <Body muted>
          {tr('staffAccount.aboutAiBody')}
        </Body>
      </Card>

      <Button title={tr('staffAccount.signOut')} variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <Text style={[type.callout, { color: t.ink3, minWidth: 90 }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: t.ink, flex: 1 }]}>{value}</Text>
    </View>
  );
}
