export type DesktopPage = 'start' | 'search' | 'tracker' | 'profile' | 'settings';

/** Views in rail order; Ctrl+<n> jumps to the n-th (App.tsx). */
export const NAV: { id: DesktopPage; label: string }[] = [
  { id: 'start', label: 'start' },
  { id: 'search', label: 'search' },
  { id: 'tracker', label: 'tracker' },
  { id: 'profile', label: 'profile' },
  { id: 'settings', label: 'config' },
];

interface NavRailProps {
  page: DesktopPage;
  onNavigate: (page: DesktopPage) => void;
  /** Narrow rail: views by number only. */
  collapsed: boolean;
  onToggle: () => void;
}

/** Left rail of the desktop window: the app's views as a terminal menu, the active one marked with ▸. */
export default function NavRail({ page, onNavigate, collapsed, onToggle }: NavRailProps) {
  return (
    <nav className="rail" aria-label="Views">
      {NAV.map(({ id, label }, i) => (
        <button
          key={id}
          type="button"
          className={`rail-item${i === 3 ? ' rail-item--sep' : ''}`}
          aria-current={page === id ? 'page' : undefined}
          onClick={() => onNavigate(id)}
          title={collapsed ? `${label} (Ctrl+${i + 1})` : `Ctrl+${i + 1}`}
        >
          <span className="rail-mark" aria-hidden>{page === id ? '▸' : ' '}</span>
          <span className="rail-label">{label}</span>
          <kbd>^{i + 1}</kbd>
        </button>
      ))}
      <img className="rail-logo" src="/app-icon.png" alt="" aria-hidden />
      <button
        type="button"
        className="rail-toggle"
        onClick={onToggle}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        aria-expanded={!collapsed}
      >
        {collapsed ? '»' : '«'}
      </button>
    </nav>
  );
}
