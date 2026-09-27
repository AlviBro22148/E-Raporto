import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { api, type PendingVerification } from './api';
import { useRealtime } from './RealtimeContext';

/**
 * The queue of "is it actually fixed?" questions this citizen owes an answer to.
 *
 * Kept in one provider above the router rather than fetched by the screen that asks, because the ask is
 * not something the citizen navigates to — it finds them. It has to survive a tab change, arrive while
 * they are looking at the map, and still be waiting the next time they open the app. A screen-local
 * fetch could do none of that.
 *
 * Three things fill this list, in descending order of speed:
 *   1. A realtime notification of type VerificationRequested — the clerk pressed resolve seconds ago and
 *      the phone is open. This is the path that makes the demo work.
 *   2. A refetch on every return to the foreground, which covers the far more common case of the app
 *      having been closed when the case was resolved.
 *   3. The load on sign-in, which catches everything that happened while they were signed out.
 *
 * There is deliberately no polling timer. A question that waited three days can wait until the citizen
 * next opens the app; draining their battery to shorten that is a cost they never agreed to.
 */

interface VerificationState {
  pending: PendingVerification[];
  /** The next unanswered question that has not already been put in front of them this session. */
  next: PendingVerification | null;
  refresh: () => Promise<void>;
  /** Called once the screen has been presented, so it is not pushed at them again on every render. */
  markPresented: (reportId: string) => void;
  /** Called after a successful answer — drops it from the queue without waiting for a refetch. */
  markAnswered: (reportId: string) => void;
}

const VerificationContext = createContext<VerificationState | null>(null);

export function VerificationProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [pending, setPending] = useState<PendingVerification[]>([]);

  // In memory, never persisted, and that is the whole design of it: "already shown" should last exactly
  // as long as this run of the app. A citizen who swipes the question away is not refusing forever — they
  // are busy — so the next cold start asks again. Persisting this would turn one dismissal into silence.
  const presented = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setPending(await api.pendingVerifications());
    } catch {
      // Offline, or the API is down. An unasked question is not an error worth showing anyone.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      // Signing out must clear both, or the next account on this phone inherits the previous one's
      // questions — and would be shown a verification screen for a report that is not theirs.
      setPending([]);
      presented.current.clear();
      return;
    }

    void refresh();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });

    return () => subscription.remove();
  }, [enabled, refresh]);

  /* ── Realtime ──────────────────────────────────────────────────────────────────────────────── */

  const { onNotification, onEntityChanged } = useRealtime();

  // The fast path. VerificationRequested is the one notification type that carries a task rather than
  // news, so it is the one that refetches this list the instant it lands.
  useEffect(() => onNotification(notification => {
    if (notification.type === 'VerificationRequested') void refresh();
  }), [onNotification, refresh]);

  // The correcting path. A reopen, a merge, or the citizen answering on another device all change what
  // is owed here, and none of them produce a notification of the type above.
  useEffect(() => onEntityChanged(event => {
    if (event.entity !== 'report') return;
    if (!['statusChanged', 'verified', 'disputed', 'merged'].includes(event.action)) return;
    void refresh();
  }), [onEntityChanged, refresh]);

  const markPresented = useCallback((reportId: string) => {
    presented.current.add(reportId);
  }, []);

  const markAnswered = useCallback((reportId: string) => {
    setPending(current => current.filter(p => p.reportId !== reportId));
  }, []);

  // Oldest first: the server already orders by when the case was resolved, so the question that has been
  // waiting longest is the one asked first.
  const next = pending.find(p => !presented.current.has(p.reportId)) ?? null;

  const value = useMemo<VerificationState>(
    () => ({ pending, next, refresh, markPresented, markAnswered }),
    [pending, next, refresh, markPresented, markAnswered],
  );

  return <VerificationContext.Provider value={value}>{children}</VerificationContext.Provider>;
}

export function useVerifications(): VerificationState {
  const context = useContext(VerificationContext);
  if (!context) throw new Error('useVerifications must be used inside <VerificationProvider>.');
  return context;
}
