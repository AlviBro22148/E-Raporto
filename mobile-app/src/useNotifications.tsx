import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { api, type Notification } from './api';
import { t, useLocale } from './i18n';
import { useRealtime } from './RealtimeContext';

const SEEN_KEY = 'e-raporto.seenNotificationIds';
const REGISTERED_TOKEN_KEY = 'e-raporto.registeredPushToken';

/**
 * Status-change notifications, in two layers.
 *
 *   1. In-app (always works): we poll the API and surface unread items as a banner on "My Reports"
 *      and a badge on the tab bar.
 *   2. OS-level local notifications (only outside Expo Go): a system banner for anything new.
 *
 * Why the split: `expo-notifications` **throws at import time on Android inside Expo Go** since SDK
 * 53 — not when you call it, when the module initialises. A static `import` therefore takes down the
 * entire module graph that references it, which is how this crashed the whole tab layout. So the
 * module is loaded lazily, behind a guard, and its absence is a degraded feature rather than a fatal
 * error. In a development build (or any standalone build) layer 2 switches itself on with no code
 * change; real push (FCM/APNs) still needs one manual step (`eas init`) to go live.
 */

// `storeClient` is Expo Go. Compared as a string rather than via the ExecutionEnvironment enum so a
// change in what expo-constants exports can never become a crash on this path.
const isExpoGo = Constants.executionEnvironment === 'storeClient';

type NotificationsModule = typeof import('expo-notifications');

// undefined = not yet attempted, null = unavailable on this runtime.
let notificationsModule: NotificationsModule | null | undefined;

function loadNotifications(): NotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;

  if (isExpoGo) {
    notificationsModule = null;
    return null;
  }

  try {
    // Deliberately require(), not import: this must be able to fail without taking the module down.
    const mod = require('expo-notifications') as NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      }),
    });
    notificationsModule = mod;
  } catch {
    notificationsModule = null;
  }

  return notificationsModule;
}

/** True when the OS can show a banner. False in Expo Go — the in-app badge still works. */
export const osNotificationsAvailable = (): boolean => loadNotifications() !== null;

/**
 * Forgets which token was last registered, so the next sign-in on this device registers fresh instead
 * of assuming the still-unchanged device token is already known to the API. Without this, signing out
 * of one citizen account and into another on the same phone would leave the second account with no
 * push registration at all — the token comparison in `registerPushTokenIfNeeded` would see no change
 * and skip the call, even though the backend record for that token now belongs to nobody.
 */
export const forgetRegisteredPushToken = (): Promise<void> => AsyncStorage.removeItem(REGISTERED_TOKEN_KEY);

/**
 * Obtains this device's Expo push token and registers it with the API, so the citizen keeps getting
 * notified even with the app fully closed — not just the in-app poll, which only runs while it's open.
 *
 * Every real failure mode here is expected, not exceptional, so each is a silent no-op rather than a
 * thrown error the caller would have to handle:
 *   · Expo Go — `expo-notifications` has no remote-push support there since SDK 53 (`loadNotifications`
 *     already returns null, same guard as the local-notification path).
 *   · No `extra.eas.projectId` in app.json — this build was never linked to an EAS project via
 *     `eas init`, so there is no destination for Expo's push service to deliver to yet.
 *   · Permission denied — the in-app notification list still works regardless.
 * Registration is skipped when the token has not changed since the last successful call, so a poll on
 * every foreground does not turn into a PUT on every foreground.
 */
async function registerPushTokenIfNeeded(): Promise<void> {
  const mod = loadNotifications();
  if (!mod) return;

  // A plain truthy check is not enough here: a `null` placeholder written into app.json's
  // extra.eas.projectId comes back from Expo Go's served manifest as `{}`, not as JS null/undefined —
  // and `{}` is truthy. That mismatch is exactly what broke push registration before this check existed
  // (getExpoPushTokenAsync received an object where it needed a string project id and threw deep inside
  // a Node-`path`-style polyfill). Requiring an actual non-empty string closes that off regardless of
  // what shape a future edit to app.json ends up putting there.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) return;

  try {
    if (Platform.OS === 'android') {
      // Required before requesting a token on Android 13+, per Expo's own setup guide — the OS won't
      // surface the permission prompt without a channel already declared.
      await mod.setNotificationChannelAsync('default', {
        name: t('notifications.channelName'),
        importance: mod.AndroidImportance.DEFAULT,
      });
    }

    const permission = await mod.getPermissionsAsync();
    const granted = permission.granted
      || (Platform.OS === 'ios' && permission.ios?.status === mod.IosAuthorizationStatus.PROVISIONAL);
    if (!granted) return;

    const { data: token } = await mod.getExpoPushTokenAsync({ projectId });

    const lastRegistered = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY);
    if (token === lastRegistered) return;

    await api.registerPushToken(token);
    await AsyncStorage.setItem(REGISTERED_TOKEN_KEY, token);
  } catch {
    // Network hiccup, or a runtime that throws on getExpoPushTokenAsync for a reason this device's
    // build doesn't fit (e.g. a simulator with no push capability) — the in-app list still works.
  }
}

interface NotificationsState {
  unread: Notification[];
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Optimistic — updates the shared unread list immediately, then tells the server in the background. */
  markRead: (id: string) => void;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

/**
 * One poll loop, one `unread` array, shared by every screen that reads it — the tab bar's badge and the
 * "Njoftimet" screen used to each call the hook body directly, which gave each of them its own private
 * `unread` state. Marking something read on the screen updated only the screen's own copy; the badge,
 * reading its separate copy, kept showing the old count until its own independent poll happened to run
 * again (backgrounding the app, mostly) — which is exactly the "still shows 2 after I've read them all"
 * bug this Provider exists to close. `useCitizenNotifications` below is now just a context read, so every
 * consumer sees the same state and the same instant update.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const state = useNotificationsState();
  return <NotificationsContext.Provider value={state}>{children}</NotificationsContext.Provider>;
}

export function useCitizenNotifications(): NotificationsState {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useCitizenNotifications must be used inside <NotificationsProvider>.');
  return context;
}

function useNotificationsState(): NotificationsState {
  const locale = useLocale();
  const [unread, setUnread] = useState<Notification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const loaded = useRef(false);

  const loadSeen = useCallback(async () => {
    if (loaded.current) return;
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    if (raw) { try { seenIds.current = new Set(JSON.parse(raw)); } catch { /* ignore */ } }
    loaded.current = true;
  }, []);

  const poll = useCallback(async () => {
    try {
      await loadSeen();
      const notifications = await api.notifications(true);

      // Layer 1 — always runs. The tab badge and the banner depend only on this.
      setUnread(notifications);

      // Layer 2 — best effort.
      const fresh = notifications.filter(n => !seenIds.current.has(n.id));
      if (fresh.length === 0) return;

      const mod = loadNotifications();
      if (mod) {
        for (const notification of fresh) {
          try {
            const useEnglish = locale === 'en' && Boolean(notification.titleEn);
            await mod.scheduleNotificationAsync({
              content: {
                title: useEnglish ? notification.titleEn : notification.title,
                body: useEnglish ? notification.bodyEn : notification.body,
                data: { reportId: notification.reportId },
              },
              trigger: null,   // deliver immediately
            });
          } catch { /* one failed banner must not stop the rest */ }
        }
      }

      // Mark them seen either way, so switching to a dev build doesn't replay old notifications.
      for (const notification of fresh) seenIds.current.add(notification.id);

      // Cap the persisted set so it cannot grow without bound over a long pilot.
      const ids = [...seenIds.current].slice(-300);
      seenIds.current = new Set(ids);
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch {
      // Offline or the API is down — notifications are a nicety, never a reason to show an error.
    }
  }, [loadSeen, locale]);

  useEffect(() => {
    let cancelled = false;

    const mod = loadNotifications();
    mod?.requestPermissionsAsync()
      .then(() => registerPushTokenIfNeeded())
      .catch(() => { /* denial is fine; the in-app list still works */ });

    if (!cancelled) void poll();

    // Poll on foreground rather than on a timer: a background interval on a phone is a battery cost
    // the citizen never agreed to, and a status change is not worth draining anyone's afternoon.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void poll();
    });

    return () => { cancelled = true; subscription.remove(); };
  }, [poll]);

  const markAllRead = useCallback(async () => {
    try { await api.markAllRead(); setUnread([]); } catch { /* retried on next poll */ }
  }, []);

  // Removes it from the shared unread list immediately — the caller (the notifications screen) does not
  // need to also trigger a re-poll to make the tab badge reflect this, and a re-poll would race the PATCH
  // to the server anyway, which is how this bug reads as "sometimes fixes itself, sometimes doesn't."
  const markRead = useCallback((id: string) => {
    setUnread(current => current.filter(n => n.id !== id));
    api.markRead(id).catch(() => { /* reconciled on next poll if this genuinely failed */ });
  }, []);

  // ── Realtime ───────────────────────────────────────────────────────────────────────────────
  // The poll on foreground stays as the floor: it is what keeps the badge honest when the socket is
  // down, on a runtime without one, or after the app was killed. These listeners are what remove the
  // wait when it is up — a status change reaches the badge in the time it takes the server to push it.
  const { onNotification, onUnreadCount } = useRealtime();

  useEffect(() => onNotification(notification => {
    // Guard against a double-add: a poll racing the push could otherwise count the same row twice.
    setUnread(current => (current.some(n => n.id === notification.id) ? current : [notification, ...current]));
  }), [onNotification]);

  useEffect(() => onUnreadCount(count => {
    // The server's count is authoritative and arrives when another device marked things read. Trimming
    // rather than refetching keeps this cheap; the next poll restores the full list if it ever drifts.
    setUnread(current => (count === 0 ? [] : current.slice(0, count)));
  }), [onUnreadCount]);

  return useMemo(() => ({ unread, refresh: poll, markAllRead, markRead }), [unread, poll, markAllRead, markRead]);
}
