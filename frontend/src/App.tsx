import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Search from './pages/Search';
import Profile from './pages/Profile';
import Agents from './pages/Agents';
import JobTracker from './pages/JobTracker';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
});

export type Page = 'landing' | 'search' | 'profile' | 'agents' | 'tracker';

function AppContent() {
  const [page, setPage] = useState<Page>('landing');

  const navigate = (p: Page) => setPage(p);

  if (page === 'landing') return <Landing onEnter={() => setPage('search')} />;
  if (page === 'profile') return <Profile onBack={() => setPage('search')} />;
  if (page === 'agents')  return <Agents  onBack={() => setPage('search')} />;
  if (page === 'tracker') return <JobTracker onBack={() => setPage('search')} onNavigate={navigate} />;

  // Default: search
  return <Search onBack={() => setPage('landing')} onNavigate={navigate} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
