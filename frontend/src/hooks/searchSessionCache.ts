import type { JobAssessment, JobResult, ResumeProfile, SortOption } from '../types';

const KEY = 'jumpship_search_session';

export interface SearchSessionSnapshot {
  v: 1;
  resumeProfile: ResumeProfile | null;
  keywords: string[];
  location: string;
  jobType: string;
  sortBy: SortOption;
  activeSites: string[];
  resultsWanted: number;
  visibleCount: number;
  jobs: JobResult[];
  assessments: Record<string, JobAssessment>;
  showBookmarksOnly: boolean;
  showHidden: boolean;
}

export function loadSearchSession(): Partial<SearchSessionSnapshot> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SearchSessionSnapshot;
    if (p.v !== 1 || !Array.isArray(p.jobs)) return null;
    const assessments =
      p.assessments && typeof p.assessments === 'object' ? p.assessments : {};
    return { ...p, assessments };
  } catch {
    return null;
  }
}

export function saveSearchSession(s: SearchSessionSnapshot): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota or private mode */
  }
}

export function clearSearchSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
