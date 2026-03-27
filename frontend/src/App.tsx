import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Search from './pages/Search';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 0 },
  },
});

type Page = 'landing' | 'search';

function AppContent() {
  const [page, setPage] = useState<Page>('landing');

  return page === 'landing' ? (
    <Landing onEnter={() => setPage('search')} />
  ) : (
    <Search onBack={() => setPage('landing')} />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
