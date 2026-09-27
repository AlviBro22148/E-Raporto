import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api, type SystemicPattern, type SystemicPatternMember,
} from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { useFeedback } from '../../src/components/Feedback';
import {
  Body, Button, Caption, Card, EmptyState, ErrorState, Heading, Loading, StatusPill, formatRelative,
} from '../../src/components/ui';
import { categoryName, reportTitle, useLocale, useT } from '../../src/i18n';
import { radius, space, type, useTheme } from '../../src/theme';

/**
 * The systemic-pattern review queue — the root-cause counterpart to the duplicate queue.
 *
 * Where duplicates ask "is this the same physical problem as that one?", a pattern asks whether several
 * DIFFERENT reports, taken together, point at one thing worth investigating as a whole. Nothing here
 * merges a report into another — each stays its own case; this is only a lens.
 */
export default function StaffPatternsScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notify } = useFeedback();

  const [items, setItems] = useState<SystemicPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.staffPatterns());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('patterns.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useRealtimeSubscription({ entity: 'systemicPattern' }, () => { void load(); });

  async function act(pattern: SystemicPattern, action: 'acknowledge' | 'dismiss' | 'refresh') {
    setBusyId(pattern.id);
    try {
      if (action === 'acknowledge') await api.staffAcknowledgePattern(pattern.id);
      else if (action === 'dismiss') await api.staffDismissPattern(pattern.id);
      else await api.staffRefreshPattern(pattern.id);
      await load();
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('patterns.actionFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading label={tr('patterns.loading')} />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;

  return (
    <FlatList
      data={items}
      keyExtractor={p => p.id}
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
          icon="◈"
          title={tr('patterns.emptyTitle')}
          hint={tr('patterns.emptyHint')}
        />
      }
      renderItem={({ item }) => {
        const color = item.connectionType === 'SharedCause' ? t.success
          : item.connectionType === 'SystemicCondition' ? t.warning
          : t.ink3;
        const expanded = expandedId === item.id;

        return (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View
                style={{
                  width: 52, height: 52, borderRadius: radius.md,
                  backgroundColor: `${color}1F`, borderWidth: 1, borderColor: `${color}66`,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: '700', color }}>{item.memberCount}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Heading>{item.connectionType ? tr(`connection.${item.connectionType}`) : tr('patterns.unreviewed')}</Heading>
                <Caption>
                  {tr('patterns.metaLine', {
                    category: categoryName(item.category, locale),
                    department: item.department ? ` · ${item.department.name}` : '',
                    count: item.memberCount,
                    relative: formatRelative(item.lastReportAt, tr),
                    confidence: item.confidence != null ? tr('patterns.confidenceSuffix', { pct: Math.round(item.confidence * 100) }) : '',
                  })}
                </Caption>
              </View>
            </View>

            {item.connectionType && (
              <Caption>{tr(`connectionHint.${item.connectionType}`)}</Caption>
            )}

            {item.summarySq ? (
              <View
                style={{
                  borderLeftWidth: 3, borderLeftColor: color,
                  backgroundColor: t.surface2, borderRadius: radius.sm,
                  padding: space.md,
                }}
              >
                <Text style={[type.body, { color: t.ink2, lineHeight: 21 }]}>{item.summarySq}</Text>
              </View>
            ) : (
              <Caption>
                {tr('patterns.notAnalyzed')}
              </Caption>
            )}

            <Pressable onPress={() => setExpandedId(expanded ? null : item.id)}>
              <Caption style={{ color: t.brand2, fontWeight: '600' }}>
                {expanded ? '▾' : '▸'} {tr('patterns.membersToggle', { count: item.members.length })}
              </Caption>
            </Pressable>

            {expanded && (
              <View style={{ gap: space.sm }}>
                {item.members.map(member => (
                  <MemberRow key={member.id} member={member} onPress={() => router.push(`/staff/report/${member.id}`)} />
                ))}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title={tr('patterns.refresh')}
                variant="secondary"
                onPress={() => { void act(item, 'refresh'); }}
                loading={busyId === item.id}
                style={{ flex: 1 }}
              />
              <Button
                title={tr('patterns.dismiss')}
                variant="secondary"
                onPress={() => { void act(item, 'dismiss'); }}
                loading={busyId === item.id}
                style={{ flex: 1 }}
              />
              <Button
                title={tr('patterns.acknowledge')}
                onPress={() => { void act(item, 'acknowledge'); }}
                loading={busyId === item.id}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        );
      }}
    />
  );
}

function MemberRow({ member, onPress }: { member: SystemicPatternMember; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  return (
    <Card onPress={onPress} style={{ gap: 4, backgroundColor: t.surface2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'], flex: 1 }]}>
          {member.publicRef}
        </Text>
        <StatusPill status={member.status} small />
      </View>
      <Body numberOfLines={2}>{reportTitle(member, locale)}</Body>
      <Caption>{member.addressText ?? tr('common.noAddress')} · {formatRelative(member.createdAt, tr)}</Caption>
    </Card>
  );
}
