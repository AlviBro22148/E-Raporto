import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useT } from '../../src/i18n';
import { MIN_TARGET, useTheme } from '../../src/theme';

function TabIcon({ glyph, color, focused }: { glyph: string; color: ColorValue; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, color, opacity: focused ? 1 : 0.75 }} accessible={false}>
      {glyph}
    </Text>
  );
}

/**
 * The municipal staff section. Same tab shell as the citizen app so the two feel like one product,
 * but a distinct set of destinations: a clerk's job is triage, dedup and oversight, not reporting.
 */
export default function StaffLayout() {
  const t = useTheme();
  const tr = useT();

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
        name="queue"
        options={{
          title: tr('nav.queue'),
          headerTitle: tr('nav.queueHeader'),
          tabBarIcon: ({ color, focused }) => <TabIcon glyph="▤" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="duplicates"
        options={{
          title: tr('nav.duplicates'),
          headerTitle: tr('nav.duplicatesHeader'),
          tabBarIcon: ({ color, focused }) => <TabIcon glyph="⧉" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="patterns"
        options={{
          title: tr('nav.patterns'),
          headerTitle: tr('nav.patternsHeader'),
          tabBarIcon: ({ color, focused }) => <TabIcon glyph="◈" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="fraud"
        options={{
          title: tr('nav.fraud'),
          headerTitle: tr('nav.fraudHeader'),
          tabBarIcon: ({ color, focused }) => <TabIcon glyph="⚠" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: tr('nav.analytics'),
          headerTitle: tr('nav.analyticsHeader'),
          tabBarIcon: ({ color, focused }) => <TabIcon glyph="◔" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: tr('nav.account'),
          headerTitle: tr('nav.accountHeader'),
          tabBarIcon: ({ color, focused }) => <TabIcon glyph="◍" color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
