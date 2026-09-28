import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, session } from '../api/client';
import type { StaffUserDto } from '../api/types';

interface AuthState {
  user: StaffUserDto | null;
  /** True until the stored token has been validated against the API on first paint. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  // The session lives in an httpOnly cookie this code can't read — so instead of checking for a
  // stored token before deciding whether to ask, just ask. A browser with no valid cookie gets a
  // clean 401 back, which is no more expensive than the check it replaces.
  useEffect(() => {
    let cancelled = false;
    api.me()
      .then(me => { if (!cancelled) { session.mark(); setUser(me); } })
      .catch(() => { /* not signed in — the login screen is the correct state, nothing to clean up */ })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    session.mark();
    setUser(response.user);
  }, []);

  const logout = useCallback(() => {
    session.clear();
    setUser(null);
    void api.logout();
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
