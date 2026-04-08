import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Search from './pages/Search';
import JobTracker from './pages/JobTracker';
import Agents from './pages/Agents';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
});

type Page = 'landing' | 'search' | 'tracker' | 'agents';

function AppContent() {
  const [page, setPage] = useState<Page>('landing');

  if (page === 'landing') return <Landing onEnter={() => setPage('search')} />;
  if (page === 'search')  return <Search onBack={() => setPage('landing')} onNavigate={setPage} />;
  if (page === 'tracker') return <JobTracker onBack={() => setPage('search')} />;
  if (page === 'agents')  return <Agents onBack={() => setPage('search')} />;
  
  return <Landing onEnter={() => setPage('search')} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
