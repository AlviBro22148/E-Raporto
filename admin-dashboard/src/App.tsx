import { Navigate, Route, Routes } from 'react-router-dom';
import { useRealtimeSync } from './api/realtime';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { LoginPage } from './pages/LoginPage';
import { PatternsPage } from './pages/PatternsPage';
import { PhotoReusePage } from './pages/PhotoReusePage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { ReportsPage } from './pages/ReportsPage';

/** Blocks rendering until the stored token has been validated, so no page flashes then 401s. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spinner /></div>;
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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:id" element={<ReportDetailPage />} />
          <Route path="/duplicates" element={<DuplicatesPage />} />
          <Route path="/patterns" element={<PatternsPage />} />
          <Route path="/photo-reuse" element={<PhotoReusePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/reports" replace />} />
      </Routes>
    </AuthProvider>
  );
}
