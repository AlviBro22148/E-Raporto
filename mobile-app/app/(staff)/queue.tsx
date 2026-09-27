import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mediaUrl, type ReportListItem, type ReportStatus } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import {
  Caption, CategoryPill, EmptyState, ErrorState, Loading, StatusPill, formatRelative,
} from '../../src/components/ui';
import { categoryName, reportTitle, useLocale, useT, type TranslateFn } from '../../src/i18n';
import { radius, shadow, space, type, useTheme } from '../../src/theme';

type Filter = { key: string; labelKey: string; status?: ReportStatus[]; needsReview?: boolean };

const FILTERS: Filter[] = [
  { key: 'all', labelKey: 'queue.filterAll' },
  { key: 'new', labelKey: 'queue.filterNew', status: ['Submitted'] },
  { key: 'review', labelKey: 'queue.filterReview', needsReview: true },
  { key: 'active', labelKey: 'queue.filterActive', status: ['Assigned', 'InProgress'] },
  { key: 'resolved', labelKey: 'queue.filterResolved', status: ['Resolved'] },
];

export default function StaffQueueScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState<Filter>(FILTERS[0]);
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Filter) => {
    setError(null);
    try {
      const page = await api.staffReports({
        status: f.status,
        needsReview: f.needsReview,
        pageSize: 50,
        sort: 'newest',
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('queue.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => { void load(filter); }, [load, filter]));

  // The queue is the screen most likely to be open on a second screen while someone else works the
  // same case, which is exactly when a stale list causes two clerks to act on one report.
  useRealtimeSubscription({ entity: 'report' }, () => { void load(filter); });

  function select(f: Filter) {
    setFilter(f);
    setLoading(true);
    void load(f);
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Filters in one row above the list — a clerk switches these constantly. */}
      <View style={{ backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}
        >
          {FILTERS.map(f => {
            const active = f.key === filter.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => select(f)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  minHeight: 38,
                  justifyContent: 'center',
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  backgroundColor: active ? t.brand2 : t.surface3,
                  borderWidth: 1,
                  borderColor: active ? t.brand2 : t.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={[type.label, { color: active ? '#fff' : t.ink2 }]}>{tr(f.labelKey)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? <Loading label={tr('queue.loading')} />
        : error ? <ErrorState message={error} onRetry={() => { setLoading(true); void load(filter); }} />
        : (
          <FlatList
            data={items}
            keyExtractor={i => i.id}
            contentContainerStyle={{
              padding: space.lg,
              paddingBottom: insets.bottom + space.xxl,
              gap: space.md,
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); void load(filter); }}
                tintColor={t.brand2}
              />
            }
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews
            ListHeaderComponent={
              <Caption>{tr('queue.totalLine', { total, filter: tr(filter.labelKey).toLowerCase() })}</Caption>
            }
            ListEmptyComponent={
              <EmptyState
                icon="✓"
                title={tr('queue.emptyTitle')}
                hint={filter.needsReview ? tr('queue.emptyHintReview') : tr('queue.emptyHintDefault')}
              />
            }
            renderItem={({ item }) => (
              <StaffReportRow item={item} onPress={() => router.push(`/staff/report/${item.id}`)} />
            )}
          />
        )}
    </View>
  );
}

function StaffReportRow({ item, onPress }: { item: ReportListItem; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const lowConfidence = item.aiConfidence != null && item.aiConfidence < 0.65;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr('queue.itemA11y', {
        ref: item.publicRef, title: reportTitle(item, locale),
        status: (item.verificationOutcome === 'Confirmed' && item.status === 'Resolved' ? tr('status.ResolvedConfirmed') : tr(`status.${item.status}`)) || item.status,
      })}
      style={({ pressed }) => ({
        backgroundColor: t.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: item.isSlaBreached ? `${t.danger}66` : t.border,
        padding: space.lg,
        gap: space.md,
        opacity: pressed ? 0.9 : 1,
        ...shadow(1),
      })}
    >
      <View style={{ flexDirection: 'row', gap: space.md }}>
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: mediaUrl(item.thumbnailUrl) }}
            style={{ width: 56, height: 56, borderRadius: radius.sm, backgroundColor: t.surface3 }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={{
            width: 56, height: 56, borderRadius: radius.sm, backgroundColor: t.surface3,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 18, color: t.ink3 }}>▢</Text>
          </View>
        )}

        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>
              {item.publicRef}
            </Text>
            {item.pendingDuplicateCount > 0 && (
              <Text style={[type.caption, { color: t.warning }]}>⧉ {item.pendingDuplicateCount}</Text>
            )}
            {item.isSlaBreached && (
              <Text style={[type.caption, { color: t.danger, fontWeight: '700' }]}>{tr('queue.slaBreached')}</Text>
            )}
          </View>
          <Text style={[type.bodyStrong, { color: t.ink }]} numberOfLines={2}>{reportTitle(item, locale)}</Text>
          {item.confirmationCount > 0 && <Caption>{tr('queue.confirmations', { count: item.confirmationCount })}</Caption>}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
        <StatusPill status={item.status} small confirmed={item.verificationOutcome === 'Confirmed'} />
        {item.category && <CategoryPill name={categoryName(item.category, locale)} color={item.category.colorHex} small />}
        {lowConfidence && (
          <View style={{
            paddingVertical: 3, paddingHorizontal: 9, borderRadius: radius.pill,
            backgroundColor: `${t.warning}1A`, borderWidth: 1, borderColor: `${t.warning}55`,
          }}>
            <Text style={[type.caption, { color: t.warning }]}>
              AI {Math.round((item.aiConfidence ?? 0) * 100)}%
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Caption>{formatRelative(item.createdAt, tr)}</Caption>
      </View>
    </Pressable>
  );
}
