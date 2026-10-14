// Recent searches (localStorage), shared by the Search sidebar and the desktop start screen.

export interface SearchHistoryEntry {
  keywords: string[];
  location: string;
  sites: string[];
  timestamp: number;
}

export const HISTORY_KEY = 'jumpship_search_history';
const MAX_HISTORY = 10;

export function loadHistory(): SearchHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

export function saveHistory(entry: SearchHistoryEntry) {
  try {
    const history = loadHistory().filter(
      h => h.keywords.join(',') !== entry.keywords.join(',') || h.location !== entry.location
    );
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}
