import { useState, useCallback } from 'react';
import type { ResumeProfile } from '../types';

const KEY = 'jumpship_resume_cache';

interface ResumeCache {
  profile: ResumeProfile;
  keywords: string[];
  fileName: string;
  savedAt: string;
}

function load(): ResumeCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(cache: ResumeCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export function useResumeCache() {
  const [cache, setCacheState] = useState<ResumeCache | null>(load);

  const saveResume = useCallback((profile: ResumeProfile, keywords: string[], fileName: string) => {
    const entry: ResumeCache = {
      profile,
      keywords,
      fileName,
      savedAt: new Date().toISOString(),
    };
    save(entry);
    setCacheState(entry);
  }, []);

  const clearResume = useCallback(() => {
    clear();
    setCacheState(null);
  }, []);

  return { cache, saveResume, clearResume };
}
