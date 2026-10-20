import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Landing from './pages/Landing';
import Search from './pages/Search';
import JobTracker from './pages/JobTracker';
import Start from './pages/Start';
import Profile from './pages/Profile';
import TitleBar from './components/TitleBar';
import NavRail, { NAV, type DesktopPage } from './components/NavRail';
import StatusBar from './components/StatusBar';
import SettingsModal from './components/SettingsModal';
import { useSettings } from './hooks/useSettings';
import { isDesktop, useStoredFlag } from './desktop';
import type { SearchHistoryEntry } from './searchHistory';
import './styles.css';
import './desktop.css';

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

/** Desktop window: title bar, nav rail, the current view, status bar. Search stays mounted while hidden so its
 *  results survive a visit to the tracker or settings. */
function DesktopApp() {
  const [page, setPage] = useState<DesktopPage>('start');
  const [searchOpened, setSearchOpened] = useState(false);
  const [entry, setEntry] = useState<SearchHistoryEntry | null>(null);
  const [back, setBack] = useState<DesktopPage>('start');
  const { settings, saveSettings } = useSettings();
  const [railMin, setRailMin] = useStoredFlag('jumpship-rail-min');

  const go = useCallback((next: DesktopPage) => {
    if (next === 'search') setSearchOpened(true);
    setPage(prev => { if (prev !== next) setBack(prev); return next; });
  }, []);
  const openSearch = (e?: SearchHistoryEntry) => {
    setEntry(e ?? null);
    go('search');
  };

  // Ctrl+1..5 jumps between views, as listed in the rail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && NAV[i]) {
        e.preventDefault();
        go(NAV[i].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  let content: ReactNode = null;
  if (page === 'start') content = <Start onSearch={openSearch} onTracker={() => go('tracker')} />;
  else if (page === 'tracker') content = <JobTracker onBack={() => go('search')} />;
  else if (page === 'profile') content = <Profile asPage onClose={() => go(back)} />;
  else if (page === 'settings') content = (
    <SettingsModal asPage open initial={settings} onSave={saveSettings} onClose={() => go(back)} />
  );

  return (
    <div className={`desk${railMin ? ' desk--rail-min' : ''}`}>
      <TitleBar page={page} />
      <NavRail page={page} onNavigate={go} collapsed={railMin} onToggle={() => setRailMin(!railMin)} />
      <main className="desk-main">
        {searchOpened && (
          <div className="desk-view" hidden={page !== 'search'}>
            <ErrorBoundary>
              <Search
                key={entry?.timestamp ?? 'new'}
                initialEntry={entry}
                onBack={() => go('start')}
                onNavigate={go}
              />
            </ErrorBoundary>
          </div>
        )}
        {content && (
          <div className="desk-view">
            <ErrorBoundary key={page}>{content}</ErrorBoundary>
          </div>
        )}
      </main>
      <StatusBar />
    </div>
  );
}

export default function App() {
  if (isDesktop) {
    return (
      <QueryClientProvider client={queryClient}>
        <DesktopApp />
      </QueryClientProvider>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        <AmbientBackground />
        <AppContent />
      </div>
    </QueryClientProvider>
  );
}
