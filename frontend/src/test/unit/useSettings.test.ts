import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettings, DEFAULT_SETTINGS } from '../../hooks/useSettings';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('useSettings', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns DEFAULT_SETTINGS when localStorage is empty', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.llmProvider).toBe('ollama');
    expect(result.current.settings.resultsWanted).toBe(20);
    expect(result.current.settings.defaultSites).toContain('linkedin');
  });

  it('persists settings to localStorage on saveSettings', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.saveSettings({
        ...DEFAULT_SETTINGS,
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        openaiKey: 'sk-test',
      });
    });
    expect(result.current.settings.llmProvider).toBe('openai');
    const stored = JSON.parse(localStorageMock.getItem('jumpship_settings')!);
    expect(stored.llmProvider).toBe('openai');
    expect(stored.openaiKey).toBe('sk-test');
  });

  it('loads persisted settings from localStorage on mount', () => {
    localStorageMock.setItem('jumpship_settings', JSON.stringify({
      ...DEFAULT_SETTINGS,
      llmProvider: 'groq',
      llmModel: 'mixtral-8x7b-32768',
    }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.llmProvider).toBe('groq');
    expect(result.current.settings.llmModel).toBe('mixtral-8x7b-32768');
  });

  it('merges with DEFAULT_SETTINGS when stored data is partial', () => {
    localStorageMock.setItem('jumpship_settings', JSON.stringify({ llmProvider: 'anthropic' }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.llmProvider).toBe('anthropic');
    // Unset fields fall back to defaults
    expect(result.current.settings.resultsWanted).toBe(DEFAULT_SETTINGS.resultsWanted);
  });

  it('handles corrupt localStorage gracefully', () => {
    localStorageMock.setItem('jumpship_settings', 'not-valid-json{{{{');
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('updates state synchronously after saveSettings', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.saveSettings({ ...DEFAULT_SETTINGS, resultsWanted: 50 });
    });
    expect(result.current.settings.resultsWanted).toBe(50);
  });
});
