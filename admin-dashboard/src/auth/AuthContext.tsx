import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, tokenStore } from '../api/client';
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

  // A token in localStorage is a claim, not proof — validate it before rendering the dashboard,
  // otherwise every panel renders and then fails in a cascade of 401s.
  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return; }

    let cancelled = false;
    api.me()
      .then(me => { if (!cancelled) setUser(me); })
      .catch(() => { tokenStore.clear(); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    tokenStore.set(response.token);
    setUser(response.user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
