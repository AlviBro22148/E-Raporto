import * as signalR from '@microsoft/signalr';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { API_URL, loadSession, type Notification } from './api';

/* ── The wire contract, mirroring E-RaportoBackend/Realtime/RealtimeContracts.cs ────────────── */

export type RealtimeEntity =
  | 'report' | 'notification' | 'duplicateCandidate' | 'citizenProfile' | 'systemicPattern'
  | 'photoReuseFlag';

export interface EntityChangedEvent {
  entity: RealtimeEntity;
  action: string;
  id: string;
  publicRef?: string | null;
  status?: string | null;
  occurredAt: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type EntityHandler = (event: EntityChangedEvent) => void;
type NotificationHandler = (notification: Notification) => void;
type UnreadHandler = (count: number) => void;

interface RealtimeState {
  state: ConnectionState;
  /** Subscribes to entity events. Returns its own unsubscribe — call it on unmount. */
  onEntityChanged: (handler: EntityHandler) => () => void;
  onNotification: (handler: NotificationHandler) => () => void;
  onUnreadCount: (handler: UnreadHandler) => () => void;
  /** Joins a per-report room for the lifetime of a detail screen. */
  subscribe: (topic: string) => Promise<void>;
  unsubscribe: (topic: string) => Promise<void>;
}

const RealtimeContext = createContext<RealtimeState | null>(null);

/* ── Provider ──────────────────────────────────────────────────────────────────────────────── */

/**
 * One hub connection for the whole app, opened once a citizen or staff member is signed in.
 *
 * Fan-out is done here rather than by letting each screen attach its own `connection.on(...)`: the
 * SignalR client keys handlers by method name, so N screens registering "EntityChanged" and one of
 * them unmounting is a live question about whose handler just got removed. Screens instead register
 * against a local Set, which has none of that ambiguity, and the single SignalR handler is attached
 * exactly once for the connection's lifetime.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>('disconnected');

  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const entityHandlers = useRef(new Set<EntityHandler>());
  const notificationHandlers = useRef(new Set<NotificationHandler>());
  const unreadHandlers = useRef(new Set<UnreadHandler>());
  // Rooms are re-joined after a reconnect: server-side group membership dies with the connection, so
  // a detail screen that was open across a tunnel change would otherwise go quietly deaf.
  const topics = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let connection: signalR.HubConnection | null = null;

    (async () => {
      const session = await loadSession();
      if (!session || cancelled) return;

      connection = new signalR.HubConnectionBuilder()
        .withUrl(`${API_URL}/hubs/realtime`, {
          // A React Native fetch cannot attach an Authorization header to the WebSocket handshake, so
          // the token rides the query string — which is why the API only accepts it there for this path.
          accessTokenFactory: async () => (await loadSession())?.token ?? '',
        })
        // Backs off 0s, 2s, 10s, 30s, then keeps retrying every 30s rather than giving up: a phone that
        // spends an hour on a bad train line should still be live when it comes back, not silently stale.
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: retry =>
            [0, 2000, 10_000, 30_000][retry.previousRetryCount] ?? 30_000,
        })
        .configureLogging(signalR.LogLevel.Warning)
        .build();

      connection.on('EntityChanged', (event: EntityChangedEvent) => {
        for (const handler of entityHandlers.current) handler(event);
      });
      connection.on('NotificationReceived', (notification: Notification) => {
        for (const handler of notificationHandlers.current) handler(notification);
      });
      connection.on('UnreadCountChanged', (count: number) => {
        for (const handler of unreadHandlers.current) handler(count);
      });

      connection.onreconnecting(() => setState('reconnecting'));
      connection.onreconnected(async () => {
        setState('connected');
        for (const topic of topics.current) {
          try { await connection?.invoke('Subscribe', topic); } catch { /* room is best-effort */ }
        }
      });
      connection.onclose(() => setState('disconnected'));

      try {
        setState('connecting');
        await connection.start();
        if (cancelled) { await connection.stop(); return; }
        setState('connected');
      } catch {
        // The app is fully usable over plain REST; realtime is an accelerator, never a prerequisite.
        setState('disconnected');
      }

      connectionRef.current = connection;
    })();

    return () => {
      cancelled = true;
      const active = connection;
      connectionRef.current = null;
      // off() before stop(): stopping alone leaves the handler registrations attached to a dead
      // connection object, which is the classic way these turn into duplicate fires after a re-login.
      active?.off('EntityChanged');
      active?.off('NotificationReceived');
      active?.off('UnreadCountChanged');
      void active?.stop();
      setState('disconnected');
    };
  }, [enabled]);

  // A phone suspends its socket in the background. On return, reconnect immediately instead of waiting
  // for the next backoff tick, so the first thing the citizen sees is already current.
  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', appState => {
      if (appState !== 'active') return;
      const connection = connectionRef.current;
      if (connection && connection.state === signalR.HubConnectionState.Disconnected) {
        connection.start().then(() => setState('connected')).catch(() => setState('disconnected'));
      }
    });

    return () => subscription.remove();
  }, [enabled]);

  const register = <T,>(set: React.RefObject<Set<T>>) => (handler: T) => {
    set.current.add(handler);
    return () => { set.current.delete(handler); };
  };

  const subscribe = useCallback(async (topic: string) => {
    topics.current.add(topic);
    try { await connectionRef.current?.invoke('Subscribe', topic); } catch { /* rejoined on reconnect */ }
  }, []);

  const unsubscribe = useCallback(async (topic: string) => {
    topics.current.delete(topic);
    try { await connectionRef.current?.invoke('Unsubscribe', topic); } catch { /* connection already gone */ }
  }, []);

  const value = useMemo<RealtimeState>(() => ({
    state,
    onEntityChanged: register(entityHandlers),
    onNotification: register(notificationHandlers),
    onUnreadCount: register(unreadHandlers),
    subscribe,
    unsubscribe,
  }), [state, subscribe, unsubscribe]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeState {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside <RealtimeProvider>.');
  return context;
}

/* ── Screen-level hook ─────────────────────────────────────────────────────────────────────── */

/**
 * Runs `onChange` whenever a matching entity event arrives, and cleans itself up on unmount.
 *
 * `onChange` is held in a ref so a screen can pass an inline arrow function — the usual cause of a
 * subscribe/unsubscribe churn on every render — without the subscription being torn down and rebuilt
 * each time. The effect below therefore depends only on the filter, not on the callback's identity.
 */
export function useRealtimeSubscription(
  filter: { entity: RealtimeEntity; id?: string; actions?: string[] },
  onChange: (event: EntityChangedEvent) => void,
) {
  const { onEntityChanged, subscribe, unsubscribe } = useRealtime();
  const callback = useRef(onChange);
  callback.current = onChange;

  const { entity, id, actions } = filter;
  const actionKey = actions?.join(',') ?? '';

  useEffect(() => {
    const allowed = actionKey ? actionKey.split(',') : null;

    const off = onEntityChanged(event => {
      if (event.entity !== entity) return;
      if (id && event.id !== id) return;
      if (allowed && !allowed.includes(event.action)) return;
      callback.current(event);
    });

    // A detail screen also joins that report's room, so it stays covered if per-report events are ever
    // narrowed to the room alone rather than broadcast to everyone.
    const topic = entity === 'report' && id ? `report:${id}` : null;
    if (topic) void subscribe(topic);

    return () => {
      off();
      if (topic) void unsubscribe(topic);
    };
  }, [entity, id, actionKey, onEntityChanged, subscribe, unsubscribe]);
}
