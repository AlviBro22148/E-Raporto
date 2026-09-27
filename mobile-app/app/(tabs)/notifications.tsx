import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtime, useRealtimeSubscription } from '../../src/RealtimeContext';
import { api, type Notification } from '../../src/api';
import { Body, Card, EmptyState, ErrorState, Loading, formatRelative } from '../../src/components/ui';
import { useLocale, useT } from '../../src/i18n';
import { MIN_TARGET, space, type, useTheme } from '../../src/theme';
import { useCitizenNotifications } from '../../src/useNotifications';

/**
 * The full history, not just what's unread — "Raportet e mia" already surfaces the unread count via the
 * tab badge, so this screen's job is to be the one place a citizen can scroll back through everything
 * that has ever happened to their reports, read or not.
 */
export default function NotificationsScreen() {
  const t = useTheme();
  const tr = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unread, refresh: refreshUnread, markAllRead, markRead } = useCitizenNotifications();

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.notifications(false));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('notifications.loadError'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useFocusEffect(useCallback(() => {
    void load();
    void refreshUnread();
  }, [load, refreshUnread]));

  // Read-state changed on another device — the row here should stop looking unread.
  useRealtimeSubscription({ entity: 'notification' }, () => { void load(); });

  // A brand-new notification arrives as its own event, not an EntityChanged, because it carries its
  // whole payload. The badge is handled in useNotifications; this keeps the visible list in step.
  const { onNotification } = useRealtime();
  useEffect(() => onNotification(() => { void load(); }), [onNotification, load]);

  const openNotification = useCallback((notification: Notification) => {
    if (!notification.isRead) {
      // Local list and shared unread state are two different things updated two different ways: this
      // screen's own `items` gets its optimistic flip here, while `markRead` owns updating (and telling
      // the server about) the `unread` array the tab badge actually reads — no re-poll, no race with it.
      setItems(current => current.map(n => (n.id === notification.id ? { ...n, isRead: true } : n)));
      markRead(notification.id);
    }
    router.push(`/report/${notification.reportId}`);
  }, [router, markRead]);

  if (loading) return <Loading label={tr('notifications.loading')} />;
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.sm,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void load(); void refreshUnread(); }}
          tintColor={t.brand2}
        />
      }
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={5}
      removeClippedSubviews
      ListHeaderComponent={
        unread.length > 0 ? (
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingBottom: space.sm, marginBottom: space.xs,
              borderBottomWidth: 1, borderBottomColor: t.border,
            }}
          >
            <Body muted>
              {unread.length === 1 ? tr('notifications.unreadOne') : tr('notifications.unreadMany', { count: unread.length })}
            </Body>
            <Pressable
              onPress={markAllRead}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={tr('notifications.markAllA11y')}
              style={{ minHeight: MIN_TARGET, justifyContent: 'center' }}
            >
              <Text style={[type.label, { color: t.brand2, fontWeight: '700' }]}>{tr('notifications.markAll')}</Text>
            </Pressable>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="🔔"
          title={tr('notifications.emptyTitle')}
          hint={tr('notifications.emptyHint')}
        />
      }
      renderItem={({ item }) => (
        <NotificationRow notification={item} onPress={() => openNotification(item)} />
      )}
    />
  );
}

function NotificationRow({ notification, onPress }: { notification: Notification; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const useEnglish = locale === 'en' && Boolean(notification.titleEn);
  const title = useEnglish ? notification.titleEn : notification.title;
  const body = useEnglish ? notification.bodyEn : notification.body;

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${title}, ${tr('notifications.itemReportA11y', { ref: notification.reportPublicRef })}${notification.isRead ? '' : tr('notifications.itemA11yUnread')}`}
      style={{
        gap: 4,
        backgroundColor: notification.isRead ? t.surface : t.brandSoft,
        borderColor: notification.isRead ? t.border : `${t.brand2}55`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        {!notification.isRead && (
          <View
            accessibilityLabel={tr('notifications.unreadDotA11y')}
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.brand2, marginTop: 6 }}
          />
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[type.bodyStrong, { color: t.ink }]}>{title}</Text>
          <Text style={[type.callout, { color: t.ink2 }]}>{body}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 2 }}>
            <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>
              {notification.reportPublicRef}
            </Text>
            <Body muted style={{ fontSize: 12 }}>{formatRelative(notification.createdAt, tr)}</Body>
          </View>
        </View>
      </View>
    </Card>
  );
}
