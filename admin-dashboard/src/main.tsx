import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A clerk switching tabs shouldn't trigger a wave of refetches mid-triage.
      refetchOnWindowFocus: false,
      staleTime: 20_000,
      // 401s are handled by the client (it clears the token and redirects) — retrying is pointless.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof Error && error.message.includes('Sesioni')),
    },
  },
});

// Apply the stored theme before first paint so the dashboard never flashes light then dark.
const storedTheme = localStorage.getItem('e-raporto.theme');
document.documentElement.dataset.theme =
  storedTheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
