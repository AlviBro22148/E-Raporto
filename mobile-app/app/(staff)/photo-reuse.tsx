import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type PhotoReuseFlag, type ReportListItem } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { useFeedback } from '../../src/components/Feedback';
import {
  Button, Caption, Card, CategoryPill, EmptyState, ErrorState, Heading, Loading, StatusPill,
  formatRelative,
} from '../../src/components/ui';
import { categoryName, reportTitle, useLocale, useT } from '../../src/i18n';
import { radius, space, type, useTheme } from '../../src/theme';

/**
 * The reused-photo review queue.
 *
 * Not an attempt at "is this photo AI-generated" — no model does that reliably, and this app doesn't
 * claim capabilities it doesn't have. A deterministic perceptual hash instead catches the far more
 * common version of photo fraud: the same picture, or a lightly edited copy of it, used on two
 * different reports. Reusing a photo isn't proof of anything on its own — a citizen can legitimately
 * resubmit their own photo — so nothing here merges or changes either report; a clerk just gets the
 * pairing surfaced for a look. Same "system proposes, human decides" shape as duplicates and patterns.
 */
export default function StaffPhotoReuseScreen() {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { notify } = useFeedback();

  const [items, setItems] = useState<PhotoReuseFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.staffPhotoReuseFlags());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('photoReuse.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useRealtimeSubscription({ entity: 'photoReuseFlag' }, () => { void load(); });
  useRealtimeSubscription({ entity: 'report' }, () => { void load(); });

  async function act(item: PhotoReuseFlag, acknowledge: boolean) {
    setBusyId(item.flagId);
    try {
      if (acknowledge) await api.staffAcknowledgePhotoReuse(item.flagId);
      else await api.staffDismissPhotoReuse(item.flagId);
      await load();
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('photoReuse.actionFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading label={tr('photoReuse.loading')} />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;

  return (
    <FlatList
      data={items}
      keyExtractor={i => i.flagId}
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
          title={tr('photoReuse.emptyTitle')}
          hint={tr('photoReuse.emptyHint')}
        />
      }
      renderItem={({ item }) => {
        const exact = item.hammingDistance === 0;
        return (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 52, height: 52, borderRadius: radius.md,
                  backgroundColor: exact ? `${t.warning}22` : t.surface3,
                  borderWidth: 1,
                  borderColor: exact ? `${t.warning}66` : t.border,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: exact ? t.warning : t.ink2 }}>
                  {item.hammingDistance}/64
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Heading>{exact ? tr('photoReuse.exactMatch') : tr('photoReuse.similarMatch')}</Heading>
                <Caption>{tr('photoReuse.distanceLine', { distance: item.hammingDistance, relative: formatRelative(item.createdAt, tr) })}</Caption>
              </View>
            </View>

            <Side report={item.report} caption={tr('photoReuse.newReport')} />
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 18, color: t.ink3 }}>⧉</Text>
            </View>
            <Side report={item.matchedReport} caption={tr('photoReuse.matchedReport')} />

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title={tr('photoReuse.falsePositive')}
                variant="secondary"
                onPress={() => { void act(item, false); }}
                loading={busyId === item.flagId}
                style={{ flex: 1 }}
              />
              <Button
                title={tr('photoReuse.acknowledge')}
                onPress={() => { void act(item, true); }}
                loading={busyId === item.flagId}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        );
      }}
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
      <Caption>
        {tr('duplicates.reporterLine', { handle: report.reporterLabel, address: report.addressText ?? tr('common.noAddress'), relative: formatRelative(report.createdAt, tr) })}
      </Caption>
    </View>
  );
}
