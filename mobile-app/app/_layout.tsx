import { useEffect } from 'react';
import { Platform, StatusBar as RNStatusBar, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/AuthContext';
import { RealtimeProvider } from '../src/RealtimeContext';
import { VerificationProvider, useVerifications } from '../src/VerificationContext';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { FeedbackProvider } from '../src/components/Feedback';
import { Loading } from '../src/components/ui';
import { I18nProvider, useT } from '../src/i18n';
import { useTheme } from '../src/theme';

/**
 * Sends the user to the right section whenever the session changes.
 *
 * Three destinations, one rule each: staff go to the admin section, citizens to the citizen tabs,
 * and everyone else to the auth screens. Doing this in one effect — rather than guarding each
 * screen — means there is exactly one place that can be wrong about who is allowed where.
 */
/**
 * Opens the realtime connection only once somebody is actually signed in — the hub requires a JWT, so
 * connecting on the login screen would just be a guaranteed 401 and a retry loop behind it.
 */
function RealtimeGate({ children }: { children: React.ReactNode }) {
  const { kind, loading } = useAuth();
  return <RealtimeProvider enabled={!loading && kind !== null}>{children}</RealtimeProvider>;
}

/**
 * Only citizens are ever asked to verify a resolution, so only a citizen session loads the queue —
 * a signed-in clerk fetching "reports I filed and must check" would be a request that can only ever
 * return nothing.
 */
function VerificationGate({ children }: { children: React.ReactNode }) {
  const { kind, loading } = useAuth();
  return (
    <VerificationProvider enabled={!loading && kind === 'citizen'}>
      <VerificationPrompt />
      {children}
    </VerificationProvider>
  );
}

/**
 * Puts the "is it actually fixed?" question in front of the citizen instead of waiting to be found.
 *
 * Renders nothing. It exists because this is the one thing in the app the municipality asks of the
 * citizen rather than the other way round, and a question that sits behind a tab is a question that
 * does not get answered — which would leave the verified-resolution rate measuring how curious people
 * are, not how good the repairs were.
 *
 * The exclusions below are the whole of its politeness, and each one is a real way this could be
 * hostile: interrupting the report form would destroy text the citizen has typed and cannot recover;
 * interrupting the auth screens would push a screen at somebody who is not signed in yet; pushing a
 * second verification on top of a first would stack modals. Everywhere else — the map, their reports,
 * a detail screen — an interruption is only mildly rude, and the question is worth that.
 */
function VerificationPrompt() {
  const { next, markPresented } = useVerifications();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!next) return;

    // Read through a widened copy: expo-router types `segments` as a union of the exact route tuples,
    // so indexing past the first element is a compile error on the one-segment routes even though it is
    // perfectly safe at runtime.
    const path = segments as readonly string[];
    const section = path[0];

    if (section === 'verify') return;                             // one at a time
    if (section === 'report' && path[1] === 'new') return;         // never eat a half-written report
    if (section === '(auth)' || section === '(staff)' || section === 'staff') return;

    // Marked before navigating, not after: this effect re-runs on the very segment change the push
    // causes, and without the mark the recomputed `next` would be the same report again.
    markPresented(next.reportId);
    router.push(`/verify/${next.reportId}`);
  }, [next, segments, router, markPresented]);

  return null;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { citizen, staff, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const section = segments[0];
    const inAuth = section === '(auth)';
    const inStaff = section === '(staff)';
    // Screens pushed from the root stack — report/new, report/[id], staff/report/[id] — sit outside
    // every group by design (a plain stack push over the tabs, not nested inside one), so their first
    // segment is a literal folder name like "staff", never the group name "(staff)". Only the two
    // *tabbed* sections count as "citizen territory" for this check.
    const inCitizenTabs = section === '(tabs)';

    if (!citizen && !staff) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    // Bounce a staff session only out of the screens that are genuinely wrong for it — the auth
    // screens, or the citizen tabs. Anything else (including staff/report/[id]) is left alone, or the
    // detail screen would redirect itself back to the queue the instant it opened.
    if (staff && (inAuth || inCitizenTabs)) { router.replace('/(staff)/queue'); return; }
    if (citizen && (inAuth || inStaff)) router.replace('/(tabs)');
  }, [citizen, staff, loading, segments, router]);

  const t = useTheme();
  const tr = useT();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center' }}>
        <Loading label={tr('root.opening')} />
      </View>
    );
  }

  return <>{children}</>;
}

function RootStack() {
  const t = useTheme();
  const tr = useT();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTitleStyle: { color: t.ink, fontSize: 17, fontWeight: '600' },
        headerTintColor: t.brand2,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.bg },
        /*
          Screens fade up rather than slide across — the same short rise the map's
          pin card uses, so navigating feels like one piece of motion vocabulary.

          Set here rather than per screen so every push inherits it, and there is
          one place to retune. This costs nothing per frame: react-native-screens
          runs stack transitions in native code, so no JavaScript executes while
          it plays — the JS thread is free to mount the incoming screen.
        */
        animation: 'fade_from_bottom',
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(staff)" options={{ headerShown: false }} />
      {/*
        The report flow is a modal, not a tab: it is a task with a beginning and an end, and the
        sheet presentation gives iOS users the swipe-down escape they already expect.
      */}
      {/* The one screen that keeps a slide: it is presented as a modal, and a
          sheet that fades instead of rising reads as a mistake. */}
      <Stack.Screen
        name="report/new"
        options={{ presentation: 'modal', title: tr('root.reportNewTitle'), animation: 'slide_from_bottom' }}
      />
      {/*
        gestureEnabled: false on both of these — each embeds a LeafletMap, and a LeafletMap is a
        WebView, not a React Native view. react-native-screens' interactive swipe-back leaves the
        outgoing screen mounted and dragging across the whole gesture (so it can animate back if the
        swipe is released early), and a WebView's native surface does not reliably survive being
        paused mid-drag and resumed — the failure mode is exactly a blank screen with nothing
        rendering, sometimes recoverable, often not. The header's back button still works instantly
        and is unaffected: it pops non-interactively, no drag, no partial-transition state for the
        WebView to be caught in the middle of.
      */}
      {/* A modal for the same reason report/new is one: it is a task with an answer owed at the end,
          not a place in the app. It carries no WebView, so unlike the two detail screens below it keeps
          its swipe-to-dismiss — there is nothing here that a half-finished gesture can break. */}
      <Stack.Screen
        name="verify/[id]"
        options={{ presentation: 'modal', title: tr('root.verifyTitle'), animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="report/[id]" options={{ title: tr('root.reportDetailTitle'), gestureEnabled: false }} />
      <Stack.Screen name="staff/report/[id]" options={{ title: tr('root.staffReportDetailTitle'), gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}

function AppRoot() {
  const t = useTheme();

  // The two edges of the screen are owned by two different pieces of the OS, and each needs its own
  // call to stop it rendering in Android's stock colours (a white strip below the app, a black band
  // above it) instead of the app's own.
  //
  // Bottom: the gesture-nav bar is a transparent overlay, so what shows through it is the native
  // window background — that's what SystemUI sets.
  //
  // Top: the status bar here is an opaque bar the OS draws outside the app's drawable area, so
  // nothing rendered from JS can reach it (an absolutely-positioned View across the inset was tried
  // and changed nothing). Its colour is a separate native property, which is what setBackgroundColor
  // sets. expo-status-bar no longer exposes this — it dropped the prop on the assumption that
  // edge-to-edge is always on — so this goes through React Native's own StatusBar instead, while
  // expo-status-bar keeps handling the icon style below.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.surface);
    if (Platform.OS === 'android') RNStatusBar.setBackgroundColor(t.surface, true);
  }, [t.surface]);

  return (
    <SafeAreaProvider>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      {/* Outermost of the app's own providers — a device-wide preference, not tied to a session, so it
          must survive sign-out/sign-in and reach the auth screens too. */}
      <I18nProvider>
        {/* Outside AuthGate, so a toast raised by signing out isn't unmounted by the redirect it
            triggers. */}
        <FeedbackProvider>
          <AuthProvider>
            {/* Inside AuthProvider because the hub needs a token, and above AuthGate so one connection
                serves the whole app — citizen tabs, staff section and the pushed detail screens alike —
                instead of being torn down and rebuilt on every section change. */}
            <RealtimeGate>
              {/* Below RealtimeGate because the queue refills off hub events, and above AuthGate so the
                  prompt survives a tab change rather than being remounted by every navigation. */}
              <VerificationGate>
                <AuthGate>
                  <RootStack />
                </AuthGate>
              </VerificationGate>
            </RealtimeGate>
          </AuthProvider>
        </FeedbackProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
