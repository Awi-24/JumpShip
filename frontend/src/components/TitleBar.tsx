import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';
import { customChrome, windowCommand } from '../desktop';
import type { DesktopPage } from './NavRail';

/** Window title bar: square traffic lights (Windows, where the page draws the frame), the current view as a path,
 *  theme toggle. The whole bar drags the window. */
export default function TitleBar({ page }: { page: DesktopPage }) {
  const [active, setActive] = useState(true);

  useEffect(() => {
    const focus = () => setActive(true);
    const blur = () => setActive(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return (
    <header
      className={`titlebar${active ? '' : ' titlebar--inactive'}`}
      data-tauri-drag-region={customChrome ? 'deep' : undefined}
    >
      {customChrome && (
        <div className="lights">
          <button type="button" className="light light--close" aria-label="Close" onClick={() => windowCommand('close')} />
          <button type="button" className="light light--min" aria-label="Minimize" onClick={() => windowCommand('minimize')} />
          {/* The window has a fixed size (main.rs): maximize is shown disabled, as on macOS. */}
          <button type="button" className="light light--max" aria-label="Maximize" disabled />
        </div>
      )}
      <div className="titlebar-title">
        <span>jumpship</span>
        <span className="titlebar-path">~/{page === 'settings' ? 'config' : page}</span>
        <span className="cursor" aria-hidden />
      </div>
      <ThemeToggle compact className="titlebar-theme" />
    </header>
  );
}
