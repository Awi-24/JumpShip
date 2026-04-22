import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Search from './pages/Search';
import JobTracker from './pages/JobTracker';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
});

type Page = 'landing' | 'search' | 'tracker';

function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden>
      <div className="ambient-bg__motion">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="bubble bubble-1" />
        <div className="bubble bubble-2" />
        <div className="bubble bubble-3" />
        <div className="bubble bubble-4" />
        <div className="bubble bubble-5" />
        <div className="bubble bubble-6" />
        <div className="bubble bubble-7" />
        <div className="bubble bubble-8" />
      </div>
      <div className="grid-overlay" />
    </div>
  );
}

function AppContent() {
  const [page, setPage] = useState<Page>('landing');

  if (page === 'landing') return <Landing onEnter={() => setPage('search')} />;
  if (page === 'search')  return <Search onBack={() => setPage('landing')} onNavigate={setPage} />;
  if (page === 'tracker') return <JobTracker onBack={() => setPage('search')} />;

  return <Landing onEnter={() => setPage('search')} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        <AmbientBackground />
        <AppContent />
      </div>
    </QueryClientProvider>
  );
}
