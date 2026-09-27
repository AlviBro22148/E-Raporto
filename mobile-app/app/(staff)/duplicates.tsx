import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type DuplicateReviewItem, type ReportListItem } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { useFeedback } from '../../src/components/Feedback';
import {
  Body, Button, Caption, Card, CategoryPill, EmptyState, ErrorState, Heading, Loading, StatusPill,
  formatRelative,
} from '../../src/components/ui';
import { categoryName, reportTitle, useLocale, useT } from '../../src/i18n';
import { radius, space, type, useTheme } from '../../src/theme';

/**
 * The duplicate review queue.
 *
 * The score is always broken into its parts — distance, text overlap, category match — because a
 * clerk has to be able to disagree with it. The system proposes; a human decides. Nothing merges
 * automatically, and a false merge in front of a jury would cost far more than an extra ticket.
 */
export default function StaffDuplicatesScreen() {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { notify, confirm } = useFeedback();

  const [items, setItems] = useState<DuplicateReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.staffDuplicates());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('duplicates.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Both entities matter here: a colleague reviewing a suggestion removes a row, and a merge performed
  // from the report screen auto-dismisses other pending suggestions for the same report.
  useRealtimeSubscription({ entity: 'duplicateCandidate' }, () => { void load(); });
  useRealtimeSubscription({ entity: 'report' }, () => { void load(); });

  async function act(item: DuplicateReviewItem, merge: boolean) {
    setBusyId(item.candidateId);
    try {
      if (merge) await api.staffConfirmDuplicate(item.candidateId);
      else await api.staffRejectDuplicate(item.candidateId);
      await load();
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('duplicates.actionFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmMerge(item: DuplicateReviewItem) {
    const ok = await confirm({
      title: tr('duplicates.confirmMergeTitle'),
      message: tr('duplicates.confirmMergeMessage', { newRef: item.newReport.publicRef, existingRef: item.existingReport.publicRef }),
      confirmLabel: tr('duplicates.confirmMergeLabel'),
      tone: 'danger',
    });
    if (ok) void act(item, true);
  }

  if (loading) return <Loading label={tr('duplicates.loading')} />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;

  return (
    <FlatList
      data={items}
      keyExtractor={i => i.candidateId}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.lg,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={t.brand2} />
      }
      ListEmptyComponent={
        <EmptyState
          icon="✓"
          title={tr('duplicates.emptyTitle')}
          hint={tr('duplicates.emptyHint')}
        />
      }
      renderItem={({ item }) => (
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View
              style={{
                width: 52, height: 52, borderRadius: radius.md,
                backgroundColor: item.score >= 0.75 ? `${t.warning}22` : t.surface3,
                borderWidth: 1,
                borderColor: item.score >= 0.75 ? `${t.warning}66` : t.border,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: item.score >= 0.75 ? t.warning : t.ink2 }}>
                {Math.round(item.score * 100)}%
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Heading>{tr('duplicates.possibleMatch')}</Heading>
              {/* The explainability: three legible numbers, not a black box. */}
              <Caption>
                {tr('duplicates.distanceSimilarity', { distance: Math.round(item.distanceMeters), similarity: Math.round(item.textSimilarity * 100) })}
                {item.method.includes('same-category') ? tr('duplicates.sameCategory') : ''}
              </Caption>
            </View>
          </View>

          <Side report={item.newReport} caption={tr('duplicates.newReport')} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 18, color: t.ink3 }}>⧉</Text>
          </View>
          <Side report={item.existingReport} caption={tr('duplicates.existingReport')} />

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              title={tr('duplicates.notSame')}
              variant="secondary"
              onPress={() => { void act(item, false); }}
              loading={busyId === item.candidateId}
              style={{ flex: 1 }}
            />
            <Button
              title={tr('duplicates.merge')}
              onPress={() => confirmMerge(item)}
              loading={busyId === item.candidateId}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      )}
    />
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
      {/* The one screen in the product that shows the handle. Here it is load-bearing: "the same
          person filed both of these" and "two different people saw the same thing" are opposite
          answers to the question this screen exists to ask. */}
      <Caption>
        {tr('duplicates.reporterLine', { handle: report.reporterLabel, address: report.addressText ?? tr('common.noAddress'), relative: formatRelative(report.createdAt, tr) })}
      </Caption>
    </View>
  );
}
