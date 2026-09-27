import { Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
import { TabIcon, type TabIconName } from '../../src/components/TabIcons';
import { useT } from '../../src/i18n';
import { MIN_TARGET, useTheme } from '../../src/theme';
import { NotificationsProvider, useCitizenNotifications } from '../../src/useNotifications';

function TabBadge({ count }: { count: number }) {
  const t = useT();
  if (count === 0) return null;
  return (
    <View
      accessibilityLabel={t('nav.unreadBadgeA11y', { count })}
      style={{
        position: 'absolute', top: -3, right: -9,
        minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
        backgroundColor: '#E8590C', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
        {count > 9 ? '9+' : count}
      </Text>
    </View>
  );
}

/**
 * Four tabs, bottom-anchored. Bottom navigation beats a drawer for a small, frequently used set of
 * destinations, and it sits in the thumb's easy-reach zone on a one-handed grip.
 *
 * Split into an outer/inner pair so the inner component can read `useCitizenNotifications()` — that
 * only works below the `<NotificationsProvider>` this file also has to render, so the provider can't
 * live in the same component that consumes it.
 */
export default function TabsLayout() {
  return (
    <NotificationsProvider>
      <TabsNavigator />
    </NotificationsProvider>
  );
}

function TabsNavigator() {
  const t = useTheme();
  const tr = useT();
  const { unread } = useCitizenNotifications();

  const icon = (name: TabIconName) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon name={name} color={color} focused={focused} />
    );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTitleStyle: { color: t.ink, fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        tabBarActiveTintColor: t.brand2,
        tabBarInactiveTintColor: t.ink3,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.border,
          height: MIN_TARGET + 34,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
        /*
          Cross-fade between tabs, matching the stack. react-navigation drives
          this with useNativeDriver on native and animates opacity only, so like
          the stack it costs no per-frame JavaScript.
        */
        animation: 'fade',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tr('nav.map'),
          headerTitle: tr('nav.mapHeader'),
          tabBarIcon: icon('map'),
          tabBarAccessibilityLabel: tr('nav.mapA11y'),
        }}
      />
      <Tabs.Screen
        name="mine"
        options={{
          title: tr('nav.mine'),
          headerTitle: tr('nav.mineHeader'),
          tabBarIcon: icon('reports'),
          tabBarAccessibilityLabel: tr('nav.mineA11y'),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: tr('nav.notifications'),
          headerTitle: tr('nav.notificationsHeader'),
          tabBarIcon: ({ color, focused }) => (
            <View>
              <TabIcon name="bell" color={color} focused={focused} />
              <TabBadge count={unread.length} />
            </View>
          ),
          tabBarAccessibilityLabel: tr('nav.notificationsA11y'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: tr('nav.profile'),
          headerTitle: tr('nav.profileHeader'),
          tabBarIcon: icon('profile'),
          tabBarAccessibilityLabel: tr('nav.profileA11y'),
        }}
      />
    </Tabs>
  );
}
