import { useEffect, useState } from 'react';
import { House, Search, KanbanSquare } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { customChrome, windowCommand } from '../desktop';

export type DesktopPage = 'start' | 'search' | 'tracker';

const TABS: { id: DesktopPage; label: string; icon: typeof House }[] = [
  { id: 'start', label: 'Start', icon: House },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'tracker', label: 'Tracker', icon: KanbanSquare },
];

interface TitleBarProps {
  page: DesktopPage;
  onNavigate: (page: DesktopPage) => void;
  /** Receives the action slot element (pages portal Profile / Settings into it). */
  slotRef: (el: HTMLDivElement | null) => void;
}

/** Window title bar: drag area (double-click maximizes), view tabs, page actions and, on Windows, caption buttons. */
export default function TitleBar({ page, onNavigate, slotRef }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!customChrome) return;
    const sync = () => { windowCommand('is_maximized').then(m => setMaximized(Boolean(m))); };
    const focus = () => setActive(true);
    const blur = () => setActive(false);
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return (
    <header
      className={`titlebar${active ? '' : ' titlebar--inactive'}`}
      data-tauri-drag-region={customChrome ? 'deep' : undefined}
    >
      <div className="titlebar-brand">
        <img src="/app-icon.png" alt="JumpShip" />
      </div>
      <nav className="titlebar-tabs" role="tablist" aria-label="Views">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            className="titlebar-tab"
            onClick={() => onNavigate(id)}
          >
            <Icon size={14} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>
      <div className="titlebar-fill" />
      <div className="titlebar-actions" ref={slotRef} />
      <ThemeToggle compact className="titlebar-theme" />
      {customChrome && (
        <div className="caption">
          <button type="button" className="caption-btn" aria-label="Minimize" onClick={() => windowCommand('minimize')}>
            {''}
          </button>
          <button
            type="button"
            className="caption-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => windowCommand('toggle_maximize')}
          >
            {maximized ? '' : ''}
          </button>
          <button type="button" className="caption-btn caption-btn--close" aria-label="Close" onClick={() => windowCommand('close')}>
            {''}
          </button>
        </div>
      )}
    </header>
  );
}
