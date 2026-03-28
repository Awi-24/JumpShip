import { useState, useCallback } from 'react';
import type { LLMProvider } from '../types';

export interface Settings {
  // LLM
  llmProvider: LLMProvider;
  llmModel: string;
  ollamaUrl: string;
  openaiKey: string;
  anthropicKey: string;
  groqKey: string;
  // Search defaults
  resultsWanted: number;
  defaultSites: string[];
  defaultLocation: string;
  assessmentSpeed: 'careful' | 'balanced' | 'turbo';
}

export const DEFAULT_SETTINGS: Settings = {
  llmProvider: 'ollama',
  llmModel: '',        // empty → SettingsModal auto-fills from live Ollama model list
  ollamaUrl: '',       // empty → backend uses its own OLLAMA_BASE_URL env var
  openaiKey: '',
  anthropicKey: '',
  groqKey: '',
  resultsWanted: 20,
  defaultSites: ['linkedin', 'indeed', 'glassdoor'],
  defaultLocation: '',
  assessmentSpeed: 'balanced',
};

const STORAGE_KEY = 'jumpship_settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(load);

  const saveSettings = useCallback((next: Settings) => {
    save(next);
    setSettingsState(next);
  }, []);

  return { settings, saveSettings };
}
