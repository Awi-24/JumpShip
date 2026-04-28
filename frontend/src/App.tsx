import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Search from './pages/Search';
import JobTracker from './pages/JobTracker';
import './styles.css';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('JumpShip ErrorBoundary caught:', error, info);
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 32, maxWidth: 640, margin: '64px auto',
          background: 'var(--card-bg, #1a1a1a)', borderRadius: 12,
          border: '1px solid rgba(248,113,113,0.35)', color: 'var(--text, #eee)',
        }}>
          <h2 style={{ marginTop: 0, color: '#f87171' }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #888)' }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: '8px 16px', background: 'transparent',
              border: '1px solid var(--border-bright, #444)', borderRadius: 8,
              color: 'var(--gold, #fbbf24)', cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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

  let content: ReactNode;
  if (page === 'landing')      content = <Landing onEnter={() => setPage('search')} />;
  else if (page === 'search')  content = <Search onBack={() => setPage('landing')} onNavigate={setPage} />;
  else if (page === 'tracker') content = <JobTracker onBack={() => setPage('search')} />;
  else                         content = <Landing onEnter={() => setPage('search')} />;

  return <ErrorBoundary key={page}>{content}</ErrorBoundary>;
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
