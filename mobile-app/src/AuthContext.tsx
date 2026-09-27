import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  api, clearSession, loadSession, saveSession, setUnauthorizedHandler,
  type CitizenUser, type SessionKind, type StaffUser,
} from './api';
import { useLocale } from './i18n';
import { forgetRegisteredPushToken } from './useNotifications';

interface AuthState {
  /** Non-null when a citizen is signed in. */
  citizen: CitizenUser | null;
  /** Non-null when a staff member is signed in — unlocks the admin section. */
  staff: StaffUser | null;
  kind: SessionKind | null;
  /** True until a stored token has been validated against the API on first paint. */
  loading: boolean;

  registerCitizen: (body: { fullName: string; email: string; password: string; phone?: string }) => Promise<void>;
  loginCitizen: (email: string, password: string) => Promise<void>;
  loginStaff: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Applies a profile edit without a refetch. */
  setCitizen: (user: CitizenUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [citizen, setCitizenState] = useState<CitizenUser | null>(null);
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [kind, setKind] = useState<SessionKind | null>(null);
  const [loading, setLoading] = useState(true);
  const locale = useLocale();

  // A stored token is a claim, not proof. Validate it before rendering the app, or every screen
  // mounts and then fails in a cascade of 401s.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const session = await loadSession();
      if (!session) { if (!cancelled) setLoading(false); return; }

      try {
        if (session.kind === 'staff') {
          const me = await api.meStaff();
          if (!cancelled) { setStaff(me); setKind('staff'); }
        } else {
          const me = await api.meCitizen();
          if (!cancelled) { setCitizenState(me); setKind('citizen'); }
        }
      } catch {
        await clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // A 401 anywhere in the app drops the session, so the router falls back to the login screen
  // instead of leaving the user staring at a screen that silently fails to load.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCitizenState(null);
      setStaff(null);
      setKind(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Best-effort, both callbacks: syncs whatever language the citizen already picked on the auth
  // screen (the server default is "sq" for a brand-new account) so a push notification sent before
  // they ever open Profile still arrives in the language they actually chose.
  const syncLocaleIfNeeded = useCallback((user: CitizenUser) => {
    if (locale !== user.preferredLocale) api.updatePreferredLocale(locale).catch(() => {});
  }, [locale]);

  const registerCitizen = useCallback(async (body: { fullName: string; email: string; password: string; phone?: string }) => {
    const session = await api.registerCitizen(body);
    await saveSession(session.token, 'citizen');
    setCitizenState(session.user);
    setStaff(null);
    setKind('citizen');
    syncLocaleIfNeeded(session.user);
  }, [syncLocaleIfNeeded]);

  const loginCitizen = useCallback(async (email: string, password: string) => {
    const session = await api.loginCitizen(email, password);
    await saveSession(session.token, 'citizen');
    setCitizenState(session.user);
    setStaff(null);
    setKind('citizen');
    syncLocaleIfNeeded(session.user);
  }, [syncLocaleIfNeeded]);

  const loginStaff = useCallback(async (email: string, password: string) => {
    const session = await api.loginStaff(email, password);
    await saveSession(session.token, 'staff');
    setStaff(session.user);
    setCitizenState(null);
    setKind('staff');
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort, and only for a citizen: a shared or resold phone should stop receiving another
    // person's case updates. Must happen before clearSession() — the token is what authorizes the call.
    if (kind === 'citizen') {
      try { await api.unregisterPushToken(); } catch { /* the account is being signed out regardless */ }
      await forgetRegisteredPushToken();
    }

    await clearSession();
    setCitizenState(null);
    setStaff(null);
    setKind(null);
  }, [kind]);

  const value = useMemo<AuthState>(() => ({
    citizen, staff, kind, loading,
    registerCitizen, loginCitizen, loginStaff, signOut,
    setCitizen: setCitizenState,
  }), [citizen, staff, kind, loading, registerCitizen, loginCitizen, loginStaff, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
