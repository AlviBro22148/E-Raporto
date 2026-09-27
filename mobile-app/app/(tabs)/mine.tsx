import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mediaUrl, type ReportListItem } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import {
  Button, Caption, Card, CategoryPill, EmptyState, ErrorState, Loading, StatusPill, formatRelative,
} from '../../src/components/ui';
import { categoryName, reportTitle, useLocale, useT } from '../../src/i18n';
import { MIN_TARGET, radius, space, type, useTheme } from '../../src/theme';

export default function MyReportsScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReports(await api.myReports());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('mine.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  // Unfiltered on purpose: this list is only the citizen's own reports, so the server has already
  // narrowed it — a status change on someone else's report simply matches nothing here.
  useRealtimeSubscription({ entity: 'report' }, () => { void load(); });

  if (loading) return <Loading label={tr('mine.loading')} />;
  if (error && reports.length === 0) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;
  }

  return (
    <FlatList
      data={reports}
      keyExtractor={item => item.id}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.md,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load(); }}
          tintColor={t.brand2}
        />
      }
      // Windowing matters even at 20 rows: these cards carry images, and a citizen who has used the
      // app for a year will have hundreds.
      initialNumToRender={8}
      maxToRenderPerBatch={10}
      windowSize={5}
      removeClippedSubviews
      ListEmptyComponent={
        <EmptyState
          icon="📍"
          title={tr('mine.emptyTitle')}
          hint={tr('mine.emptyHint')}
          action={<Button title={tr('mine.reportCta')} onPress={() => router.push('/report/new')} />}
        />
      }
      renderItem={({ item }) => (
        <ReportRow
          item={item}
          onPress={() => router.push(`/report/${item.id}`)}
          onVerify={() => router.push(`/verify/${item.id}`)}
        />
      )}
    />
  );
}

function ReportRow({ item, onPress, onVerify }: {
  item: ReportListItem; onPress: () => void; onVerify: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();

  // A resolved report with no verdict against it is a question this citizen still owes. The modal asks
  // it once per app launch; this is the standing reminder for anyone who dismissed it with "Më vonë",
  // so the ask does not depend on catching them at the right moment.
  const awaitingVerification = item.status === 'Resolved' && !item.verificationOutcome;

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={tr('mine.itemA11y', { ref: item.publicRef, title: reportTitle(item, locale) })}
      style={{ gap: space.md }}
    >
      <View style={{ flexDirection: 'row', gap: space.md }}>
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: mediaUrl(item.thumbnailUrl) }}
            style={{ width: 62, height: 62, borderRadius: radius.sm, backgroundColor: t.surface3 }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            style={{
              width: 62, height: 62, borderRadius: radius.sm,
              backgroundColor: t.surface3, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20, color: t.ink3 }}>▢</Text>
          </View>
        )}

        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>
            {item.publicRef}
          </Text>
          <Text style={[type.bodyStrong, { color: t.ink }]} numberOfLines={2}>{reportTitle(item, locale)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <StatusPill status={item.status} small confirmed={item.verificationOutcome === 'Confirmed'} />
            {item.category && (
              <CategoryPill name={categoryName(item.category, locale)} color={item.category.colorHex} small />
            )}
          </View>
        </View>
      </View>

      {/* Plain language, not workflow jargon: a citizen should never have to decode "InReview". */}
      <View
        style={{
          backgroundColor: t.surface2,
          borderRadius: radius.sm,
          padding: space.md,
          gap: 3,
        }}
      >
        <Text style={[type.callout, { color: t.ink2 }]}>{tr(`statusHelp.${item.status}`)}</Text>
        <Caption>
          {tr('map.reported', { relative: formatRelative(item.createdAt, tr) })}
          {item.confirmationCount > 1 && tr('map.confirmedBy', { count: item.confirmationCount })}
        </Caption>
      </View>

      {awaitingVerification ? (
        <Pressable
          onPress={onVerify}
          accessibilityRole="button"
          accessibilityLabel={tr('mine.verifyPromptA11y')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: MIN_TARGET,
            paddingHorizontal: space.md,
            borderRadius: radius.sm,
            backgroundColor: `${t.warning}14`,
            borderWidth: 1,
            borderColor: `${t.warning}55`,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={[type.bodyStrong, { color: t.warning, flex: 1 }]}>
            {tr('mine.verifyPrompt')}
          </Text>
          <Text style={[type.bodyStrong, { color: t.warning }]}>›</Text>
        </Pressable>
      ) : item.verificationOutcome ? (
        <Caption
          style={{
            color: item.verificationOutcome === 'Confirmed' ? t.success : t.danger,
          }}
        >
          {item.verificationOutcome === 'Confirmed'
            ? tr('mine.confirmedLine')
            : tr('mine.disputedLine')}
        </Caption>
      ) : null}
    </Card>
  );
}
