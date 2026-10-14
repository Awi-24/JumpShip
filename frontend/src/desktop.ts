// Running inside the Tauri desktop shell (crates/desktop)? Tauri injects its IPC bridge into the page; the window
// commands are allowed for this origin by crates/desktop/capabilities/main.json. No @tauri-apps/api dependency:
// four window commands don't need it.

import { createContext } from 'react';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;

export const isDesktop = Boolean(bridge);
/** Windows draws no native frame (decorations off in main.rs): the page provides title bar and caption buttons. */
export const customChrome = isDesktop && navigator.userAgent.includes('Windows');

export function windowCommand(cmd: 'minimize' | 'toggle_maximize' | 'close' | 'is_maximized'): Promise<unknown> {
  return bridge ? bridge.invoke(`plugin:window|${cmd}`, { label: 'main' }) : Promise.resolve(false);
}

/** Desktop behaviour: no browser context menu outside text, no reload shortcuts (they would drop the app state). */
export function initDesktop(): void {
  if (!isDesktop) return;
  const root = document.documentElement;
  root.classList.add('is-desktop');
  if (customChrome) root.classList.add('has-custom-chrome');

  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    const editable = t.closest('input, textarea, [contenteditable="true"]');
    if (!editable && !window.getSelection()?.toString()) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    const reload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
    if (reload) e.preventDefault();
  });
}

/** The title bar's action slot: pages portal their own buttons (Profile, Settings) into it. */
export const TitlebarSlot = createContext<HTMLElement | null>(null);
