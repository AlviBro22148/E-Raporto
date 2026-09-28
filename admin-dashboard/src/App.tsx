import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useRealtimeSync } from './api/realtime';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';

/**
 * Route-level code splitting. Everything used to import statically, so every staff login downloaded
 * every page's code up front — Leaflet for the map and Recharts for analytics included, whether or not
 * that clerk ever opens either. Each page is now its own chunk that only loads when actually visited;
 * `Suspense` below covers the gap with the same spinner `RequireAuth` already used for the auth check.
 */
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const ReportDetailPage = lazy(() => import('./pages/ReportDetailPage').then(m => ({ default: m.ReportDetailPage })));
const DuplicatesPage = lazy(() => import('./pages/DuplicatesPage').then(m => ({ default: m.DuplicatesPage })));
const PatternsPage = lazy(() => import('./pages/PatternsPage').then(m => ({ default: m.PatternsPage })));
const FraudPage = lazy(() => import('./pages/FraudPage').then(m => ({ default: m.FraudPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));

function PageSpinner() {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spinner /></div>;
}

/** Blocks rendering until the stored token has been validated, so no page flashes then 401s. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Holds the hub connection for the whole signed-in session. Sits inside AuthProvider (it needs the
 * token) and outside the routes, so navigating between pages never drops and rebuilds the socket.
 */
function RealtimeSync() {
  const { user } = useAuth();
  useRealtimeSync(Boolean(user));
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <RealtimeSync />
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth><Shell /></RequireAuth>}>
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:id" element={<ReportDetailPage />} />
            <Route path="/duplicates" element={<DuplicatesPage />} />
            <Route path="/patterns" element={<PatternsPage />} />
            <Route path="/fraud" element={<FraudPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
