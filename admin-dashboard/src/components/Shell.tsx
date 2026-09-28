import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import logoEmblem from '../assets/logo-emblem.png';

const THEME_KEY = 'e-raporto.theme';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null)
      ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))] as const;
}

const NAV = [
  { to: '/reports', label: 'Raportet', icon: '▤' },
  { to: '/duplicates', label: 'Dublikatat', icon: '⧉' },
  { to: '/patterns', label: 'Modelet', icon: '◈' },
  { to: '/fraud', label: 'Mashtrime të mundshme', icon: '⚠' },
  { to: '/analytics', label: 'Analitika', icon: '◔' },
];

export function Shell() {
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();

  // Badge the duplicate queue so a clerk sees pending review work without navigating to it.
  const { data: summary } = useQuery({
    queryKey: ['analytics'],
    queryFn: api.analytics,
    refetchInterval: 60_000,
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '236px 1fr', height: '100vh' }}>
      <aside
        style={{
          background: 'var(--brand-800)',
          color: '#e8eef6',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 14px',
          gap: 24,
        }}
      >
        <div style={{ padding: '0 8px' }}>
          <div className="row" style={{ gap: 11, alignItems: 'center' }}>
            <img
              src={logoEmblem}
              alt=""
              aria-hidden="true"
              style={{ width: 40, height: 40, flex: 'none', objectFit: 'contain' }}
            />
            <div className="stack-4" style={{ gap: 0 }}>
              <strong style={{ fontSize: 15, letterSpacing: '-0.01em' }}>E-Raporto</strong>
              <span style={{ fontSize: 10.5, color: '#93a7c0', letterSpacing: '0.04em' }}>
                BASHKIA ELBASAN
              </span>
            </div>
          </div>
        </div>

        <nav className="stack-4" aria-label="Navigimi kryesor">
          {NAV.map(item => {
            const badge = item.to === '/duplicates' ? summary?.pendingDuplicateReviews
              : item.to === '/patterns' ? summary?.openSystemicPatterns
              : item.to === '/fraud' ? summary?.pendingFraudFlags
              : undefined;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 8,
                  fontSize: 13.5,
                  fontWeight: 550,
                  color: isActive ? '#fff' : '#b6c4d6',
                  background: isActive ? 'rgb(255 255 255 / 0.11)' : 'transparent',
                  textDecoration: 'none',
                })}
              >
                <span aria-hidden="true" style={{ fontSize: 14, opacity: 0.85 }}>{item.icon}</span>
                {item.label}
                {badge ? <span className="spacer" /> : null}
                {badge ? (
                  <span className="pill-count" style={{ background: '#e8590c' }}>{badge}</span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="spacer" />

        <div className="stack-8" style={{ padding: '0 4px' }}>
          <button
            className="btn btn-sm"
            onClick={toggleTheme}
            style={{ background: 'transparent', borderColor: 'rgb(255 255 255 / 0.16)', color: '#cbd7e6' }}
          >
            {theme === 'dark' ? '☀ Ndriçim i çelët' : '☾ Ndriçim i errët'}
          </button>

          <div
            style={{
              borderTop: '1px solid rgb(255 255 255 / 0.12)',
              paddingTop: 12, marginTop: 4,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.fullName}</div>
            <div style={{ fontSize: 11.5, color: '#8fa3bd', marginBottom: 8 }}>
              {user?.jobTitle ?? user?.departmentName ?? user?.role}
            </div>
            <button
              className="btn btn-sm"
              onClick={logout}
              style={{ background: 'transparent', borderColor: 'rgb(255 255 255 / 0.16)', color: '#cbd7e6', width: '100%' }}
            >
              Dil
            </button>
          </div>
        </div>
      </aside>

      <main style={{ overflow: 'auto', background: 'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  );
}
