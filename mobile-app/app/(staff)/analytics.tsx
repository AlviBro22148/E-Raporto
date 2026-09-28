import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type AnalyticsSummary } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { Body, Caption, Card, ErrorState, Heading, Label, Loading } from '../../src/components/ui';
import { categoryName, useLocale, useT, type TranslateFn } from '../../src/i18n';
import { radius, space, statusColor, type, useTheme } from '../../src/theme';

function formatHours(hours: number | undefined, t: TranslateFn): string {
  if (hours == null) return '—';
  if (hours < 1) return t('analytics.hoursMin', { count: Math.round(hours * 60) });
  if (hours < 48) return t('analytics.hoursHours', { count: hours.toFixed(1) });
  return t('analytics.hoursDays', { count: (hours / 24).toFixed(1) });
}

export default function StaffAnalyticsScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.staffAnalytics());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('analytics.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Every counter on this screen is derived from reports, so it goes stale the moment one changes.
  useRealtimeSubscription({ entity: 'report' }, () => { void load(); });

  if (loading) return <Loading label={tr('analytics.loading')} />;
  if (error || !data) return <ErrorState message={error ?? tr('analytics.genericError')} onRetry={() => { setLoading(true); void load(); }} />;

  const agreement = data.aiAgreementRate == null ? null : Math.round(data.aiAgreementRate * 100);
  const maxCategory = Math.max(1, ...data.byCategory.map(c => c.count));

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={t.brand2} />
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <Stat label={tr('analytics.totalReports')} value={String(data.totalReports)} hint={tr('analytics.totalReportsHint', { count: data.openReports })} />
        <Stat label={tr('analytics.avgAcknowledge')} value={formatHours(data.avgHoursToAcknowledge, tr)} hint={tr('analytics.avgAcknowledgeHint')} />
        <Stat label={tr('analytics.avgResolution')} value={formatHours(data.avgHoursToResolution, tr)} hint={tr('analytics.avgResolutionHint', { count: data.resolvedReports })} />
        <Stat
          label={tr('analytics.slaBreaches')}
          value={String(data.slaBreachCount)}
          hint={tr('analytics.slaBreachesHint')}
          tone={data.slaBreachCount > 0 ? 'warning' : 'success'}
        />
      </View>

      {/*
        The honesty panel. We report agreement — how often a clerk left the AI's category alone —
        not "accuracy", because we have no labelled ground truth. Saying so is the point.
      */}
      <Card style={{ gap: space.sm, borderLeftWidth: 3, borderLeftColor: t.brand2 }}>
        <Label>{tr('analytics.aiAgreement')}</Label>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          <Text style={{ fontSize: 32, fontWeight: '700', color: t.ink, letterSpacing: -0.5 }}>
            {agreement == null ? '—' : `${agreement}%`}
          </Text>
          <Caption>{tr('analytics.aiAgreementDetail', { overridden: data.aiOverriddenCount, classified: data.aiClassifiedCount })}</Caption>
        </View>
        <Body muted>
          {tr('analytics.aiAgreementBody')}
        </Body>
      </Card>

      <Card style={{ gap: space.md }}>
        <Heading>{tr('analytics.byCategory')}</Heading>
        {data.byCategory.length === 0 ? <Caption>{tr('analytics.noData')}</Caption> : data.byCategory.map(c => (
          <View key={c.code} style={{ gap: 5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: c.colorHex }} />
              <Text style={[type.callout, { color: t.ink2, flex: 1 }]} numberOfLines={1}>{categoryName(c, locale)}</Text>
              <Text style={[type.bodyStrong, { color: t.ink }]}>{c.count}</Text>
            </View>
            {/* Bars, not arcs: magnitude reads better and a 1-count row can't vanish. */}
            <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden' }}>
              <View style={{ width: `${(c.count / maxCategory) * 100}%`, height: '100%', backgroundColor: c.colorHex }} />
            </View>
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.md }}>
        <Heading>{tr('analytics.byStatus')}</Heading>
        {data.byStatus.length === 0 ? <Caption>{tr('analytics.noData')}</Caption> : data.byStatus.map(s => (
          <View key={s.status} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: statusColor[s.status] ?? t.ink3 }} />
            <Text style={[type.callout, { color: t.ink2, flex: 1 }]}>{tr(`status.${s.status}`) || s.status}</Text>
            <Text style={[type.bodyStrong, { color: t.ink }]}>{s.count}</Text>
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.md }}>
        <Heading>{tr('analytics.byDepartment')}</Heading>
        {data.byDepartment.length === 0 ? <Caption>{tr('analytics.noData')}</Caption> : data.byDepartment.map(d => (
          <View key={d.id} style={{ gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[type.callout, { color: t.ink, flex: 1 }]} numberOfLines={1}>{d.shortName}</Text>
              <Caption>{tr('analytics.openResolved', { open: d.open, resolved: d.resolved })}</Caption>
            </View>
            {d.slaBreaches > 0 && (
              <Text style={[type.caption, { color: t.warning }]}>{tr('analytics.slaBreachLine', { count: d.slaBreaches })}</Text>
            )}
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.xs }}>
        <Heading>{tr('analytics.duplicatesTitle')}</Heading>
        <Caption>
          {tr('analytics.duplicatesLine', { merged: data.duplicatesMerged, pending: data.pendingDuplicateReviews })}
        </Caption>
      </Card>

      <Card style={{ gap: space.xs }}>
        <Heading>{tr('analytics.fraudTitle')}</Heading>
        <Caption>
          {tr('analytics.fraudLine', {
            pending: data.pendingFraudFlags,
            confirmed: data.confirmedFraudFlags,
            dismissed: data.dismissedFraudFlags,
          })}
        </Caption>
      </Card>
    </ScrollView>
  );
}

function Stat({ label, value, hint, tone = 'default' }: {
  label: string; value: string; hint?: string; tone?: 'default' | 'warning' | 'success';
}) {
  const t = useTheme();
  const color = tone === 'warning' ? t.warning : tone === 'success' ? t.success : t.ink;
  return (
    <View
      style={{
        flexGrow: 1, flexBasis: '45%',
        backgroundColor: t.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: t.border,
        padding: space.lg,
        gap: 2,
      }}
    >
      <Text style={[type.caption, { color: t.ink3, textTransform: 'uppercase', letterSpacing: 0.5 }]}>
        {label}
      </Text>
      <Text style={{ fontSize: 24, fontWeight: '700', color, letterSpacing: -0.4 }}>{value}</Text>
      {hint && <Caption>{hint}</Caption>}
    </View>
  );
}
