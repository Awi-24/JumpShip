import { useQuery } from '@tanstack/react-query';
import { Search, KanbanSquare, History, FileText } from 'lucide-react';
import { useResumeCache } from '../hooks/useResumeCache';
import { loadHistory, type SearchHistoryEntry } from '../searchHistory';

interface StartProps {
  onSearch: (entry?: SearchHistoryEntry) => void;
  onTracker: () => void;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function ago(ts: number): string {
  const min = Math.round((ts - Date.now()) / 60_000);
  if (min > -60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  if (h > -24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}

/** Desktop start screen (replaces the web landing page inside the app). */
export default function Start({ onSearch, onTracker }: StartProps) {
  const history = loadHistory().slice(0, 6);
  const { cache: resume } = useResumeCache();
  const tracked = useQuery({
    queryKey: ['applications-count'],
    queryFn: async () => ((await (await fetch('/api/applications')).json()) as { count: number }).count,
  });

  return (
    <div className="start">
      <header className="start-head">
        <h1><img src="/logo-wordmark.png" alt="JumpShip" /></h1>
        <p>Search job boards and company career sites, then score every opening against your résumé with your own AI model.</p>
      </header>

      <div className="start-cols">
        <section data-pane="actions">
          <button type="button" className="start-row" onClick={() => onSearch()}>
            <Search size={18} strokeWidth={1.75} />
            <span>
              <strong>New search</strong>
              <small>Choose keywords, location and job boards</small>
            </span>
          </button>
          <button type="button" className="start-row" onClick={() => onSearch()}>
            <FileText size={18} strokeWidth={1.75} />
            <span>
              <strong>{resume ? resume.fileName : 'Add your résumé'}</strong>
              <small>
                {resume
                  ? `Loaded ${ago(new Date(resume.savedAt).getTime())} · used for match scores`
                  : 'Needed for match scores and tailored résumés'}
              </small>
            </span>
          </button>
          <button type="button" className="start-row" onClick={onTracker}>
            <KanbanSquare size={18} strokeWidth={1.75} />
            <span>
              <strong>Open tracker</strong>
              <small>
                {tracked.data === undefined
                  ? 'Applications by stage'
                  : `${tracked.data} application${tracked.data === 1 ? '' : 's'} tracked`}
              </small>
            </span>
          </button>
        </section>

        <section data-pane="recent">
          {history.length === 0 ? (
            <p className="start-empty">Your searches appear here, ready to run again.</p>
          ) : (
            history.map(h => (
              <button key={h.timestamp} type="button" className="start-row start-row--recent" onClick={() => onSearch(h)}>
                <History size={16} strokeWidth={1.75} />
                <span>
                  <strong>{h.keywords.join(', ')}</strong>
                  <small>{h.location || 'Any location'} · {h.sites.length} boards</small>
                </span>
                <time dateTime={new Date(h.timestamp).toISOString()}>{ago(h.timestamp)}</time>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
