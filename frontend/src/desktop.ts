// Running inside the Tauri desktop shell (crates/desktop)? Tauri injects its IPC bridge into the page; the window
// commands are allowed for this origin by crates/desktop/capabilities/main.json. No @tauri-apps/api dependency:
// two window commands don't need it.

import { useState } from 'react';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
/** Dev only: `npm run dev` + `?desktop` renders the desktop window in a browser (window buttons do nothing). */
const preview = import.meta.env.DEV && new URLSearchParams(location.search).has('desktop');

export const isDesktop = Boolean(bridge) || preview;
/** Windows draws no native frame (decorations off in main.rs): the page provides title bar and window buttons. */
export const customChrome = (Boolean(bridge) && navigator.userAgent.includes('Windows')) || preview;

export function windowCommand(cmd: 'minimize' | 'close'): Promise<unknown> {
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

/** A boolean UI preference kept in localStorage (collapsed panes); defaults to false when storage is unavailable. */
export function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });
  const set = (v: boolean) => {
    setValue(v);
    try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* per-session only */ }
  };
  return [value, set];
}
