import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type FraudFlag, type FraudFlagKind, type ReportListItem } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { useFeedback } from '../../src/components/Feedback';
import {
  Button, Caption, Card, CategoryPill, EmptyState, ErrorState, Heading, Loading, StatusPill,
  formatRelative,
} from '../../src/components/ui';
import { categoryName, reportTitle, useLocale, useT } from '../../src/i18n';
import { radius, space, type, useTheme } from '../../src/theme';

const KIND_ORDER: FraudFlagKind[] = [
  'PhotoReuse', 'DescriptionMismatch', 'SeverityExaggeration', 'StockPhoto',
  'PhotoOfPhoto', 'GpsMismatch', 'TemplatedText', 'StaffFlagged',
];

/**
 * The unified fraud review queue — every reason a report might be worth a second look, in one place.
 * Six are automated (a perceptual hash, a distance check, four calibrated Claude vision questions), one
 * is a clerk's own judgement call with no algorithm behind it. None of them are proof: reusing a photo,
 * text that reads templated, a photo whose GPS doesn't match the pin — every one of these has an honest
 * explanation as often as a dishonest one. Nothing here ever touches the report(s) it points at; a flag
 * only ever asks a clerk to look, and acknowledging one just records that the look happened.
 */
export default function StaffFraudScreen() {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { notify } = useFeedback();

  const [items, setItems] = useState<FraudFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<FraudFlagKind | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.staffFraudFlags());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('fraud.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useRealtimeSubscription({ entity: 'fraudFlag' }, () => { void load(); });
  useRealtimeSubscription({ entity: 'report' }, () => { void load(); });

  async function act(item: FraudFlag, acknowledge: boolean) {
    setBusyId(item.flagId);
    try {
      if (acknowledge) await api.staffAcknowledgeFraudFlag(item.flagId);
      else await api.staffDismissFraudFlag(item.flagId);
      await load();
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('fraud.actionFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const byKind = new Map<FraudFlagKind, number>();
    for (const item of items) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
    return byKind;
  }, [items]);

  const visible = kindFilter ? items.filter(i => i.kind === kindFilter) : items;

  if (loading) return <Loading label={tr('fraud.loading')} />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;

  return (
    <FlatList
      data={visible}
      keyExtractor={i => i.flagId}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.lg,
        flexGrow: 1,
      }}
      ListHeaderComponent={items.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md }}>
          <KindChip
            label={`${tr('fraud.all')} · ${items.length}`}
            active={kindFilter === null}
            onPress={() => setKindFilter(null)}
          />
          {KIND_ORDER.filter(k => counts.has(k)).map(k => (
            <KindChip
              key={k}
              label={`${tr(`fraud.kind.${k}`)} · ${counts.get(k)}`}
              active={kindFilter === k}
              onPress={() => setKindFilter(k === kindFilter ? null : k)}
            />
          ))}
        </View>
      ) : null}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={t.brand2} />
      }
      ListEmptyComponent={
        <EmptyState icon="✓" title={tr('fraud.emptyTitle')} hint={tr('fraud.emptyHint')} />
      }
      renderItem={({ item }) => (
        <FraudCard
          item={item}
          busy={busyId === item.flagId}
          onAcknowledge={() => { void act(item, true); }}
          onDismiss={() => { void act(item, false); }}
        />
      )}
    />
  );
}

function KindChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? t.brandSoft : t.surface2,
        borderWidth: 1, borderColor: active ? t.brand2 : t.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={[type.label, { color: active ? t.brand2 : t.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

function scoreLine(item: FraudFlag, tr: ReturnType<typeof useT>): string | null {
  if (item.score == null) return null;
  switch (item.kind) {
    case 'PhotoReuse': return tr('fraud.scorePhotoReuse', { score: item.score });
    case 'GpsMismatch': return tr('fraud.scoreGpsMismatch', { score: Math.round(item.score) });
    case 'TemplatedText': return tr('fraud.scoreTemplatedText', { pct: Math.round(item.score * 100) });
    default: return tr('fraud.scoreConfidence', { pct: Math.round(item.score * 100) });
  }
}

function FraudCard({ item, busy, onAcknowledge, onDismiss }: {
  item: FraudFlag; busy: boolean; onAcknowledge: () => void; onDismiss: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const color = item.kind === 'StaffFlagged' ? t.brand2 : item.kind === 'SeverityExaggeration' ? t.danger : t.warning;
  const score = scoreLine(item, tr);

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View
          style={{
            width: 40, height: 40, borderRadius: radius.md,
            backgroundColor: `${color}1F`, borderWidth: 1, borderColor: `${color}66`,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 17 }}>{item.kind === 'StaffFlagged' ? '🖐' : '⚠'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Heading style={{ color }}>{tr(`fraud.kind.${item.kind}`)}</Heading>
          {score && <Caption>{score}</Caption>}
        </View>
      </View>

      <Text style={[type.body, { color: t.ink }]}>{item.reasoning}</Text>
      <Caption>
        {item.raisedByStaffName
          ? tr('fraud.raisedByLine', { name: item.raisedByStaffName, relative: formatRelative(item.createdAt, tr) })
          : tr('fraud.signalLine', { relative: formatRelative(item.createdAt, tr) })}
      </Caption>

      <Side report={item.report} caption={tr('fraud.reportLabel')} />
      {item.relatedReport && (
        <>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 18, color: t.ink3 }}>⧉</Text>
          </View>
          <Side report={item.relatedReport} caption={tr('fraud.relatedReportLabel')} />
        </>
      )}

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          title={tr('fraud.falsePositive')}
          variant="secondary"
          onPress={onDismiss}
          loading={busy}
          style={{ flex: 1 }}
        />
        <Button
          title={tr('fraud.acknowledge')}
          onPress={onAcknowledge}
          loading={busy}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

function Side({ report, caption }: { report: ReportListItem; caption: string }) {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  return (
    <View style={{ gap: space.xs, backgroundColor: t.surface2, borderRadius: radius.md, padding: space.md }}>
      <Text style={[type.caption, { color: t.ink3, letterSpacing: 0.6 }]}>{caption}</Text>
      <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>{report.publicRef}</Text>
      <Text style={[type.bodyStrong, { color: t.ink }]} numberOfLines={2}>{reportTitle(report, locale)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 }}>
        <StatusPill status={report.status} small />
        {report.category && <CategoryPill name={categoryName(report.category, locale)} color={report.category.colorHex} small />}
      </View>
      <Caption>
        {tr('duplicates.reporterLine', { handle: report.reporterLabel, address: report.addressText ?? tr('common.noAddress'), relative: formatRelative(report.createdAt, tr) })}
      </Caption>
    </View>
  );
}
