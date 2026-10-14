import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSettings } from '../hooks/useSettings';

const LOCAL = new Set(['ollama', 'lmstudio', 'openclaw']);

/** Desktop status bar, tmux style: app segment, which model assesses jobs and whether it is reachable, clock. */
export default function StatusBar() {
  const { settings } = useSettings();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await fetch('/api/health')).json() as Promise<{ llm_available?: boolean }>,
    refetchInterval: 15_000,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const local = LOCAL.has(settings.llmProvider);
  const state = health.isError ? 'red' : health.data?.llm_available || !local ? 'green' : 'yellow';
  const note = health.isError ? 'server down' : local && !health.data?.llm_available ? 'unreachable' : 'ok';

  return (
    <footer className="statusbar">
      <span className="statusbar-seg statusbar-seg--app">[jumpship]</span>
      <span className="statusbar-seg">
        <span className={`status-dot ${state}`} />
        {settings.llmProvider}{settings.llmModel ? `:${settings.llmModel}` : ''}
      </span>
      <span className={`statusbar-seg statusbar-note statusbar-note--${state}`}>{note}</span>
      <span className="statusbar-fill" />
      <span className="statusbar-seg">{local ? 'local' : 'cloud'}</span>
      <span className="statusbar-seg statusbar-seg--clock">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </footer>
  );
}
