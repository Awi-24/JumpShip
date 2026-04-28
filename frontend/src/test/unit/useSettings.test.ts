import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

// Mock fetch — returns empty server-side keys by default
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (typeof url === 'string' && url.endsWith('/api/settings/llm-keys')) {
    if (!init || init.method === undefined || init.method === 'GET') {
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (init.method === 'PUT') {
      return new Response(null, { status: 204 });
    }
  }
  return new Response('{}', { status: 200 });
});
// @ts-expect-error — installing mock
global.fetch = fetchMock;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useSettings', () => {
  beforeEach(() => {
    localStorageMock.clear();
    fetchMock.mockClear();
  });

  it('returns DEFAULT_SETTINGS when localStorage is empty', () => {
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
    expect(result.current.settings.llmProvider).toBe('ollama');
    expect(result.current.settings.resultsWanted).toBe(20);
    expect(result.current.settings.defaultSites).toContain('linkedin');
  });

  it('persists non-key settings to localStorage on saveSettings', () => {
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
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
    // Key fields are stripped from localStorage and routed to the server.
    expect(stored.openaiKey).toBe('');
  });

  it('sends API keys to the server (not localStorage) on save', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
    act(() => {
      result.current.saveSettings({
        ...DEFAULT_SETTINGS,
        anthropicKey: 'sk-ant-xxx',
      });
    });
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/settings/llm-keys' && (c[1] as RequestInit | undefined)?.method === 'PUT'
      );
      expect(putCall).toBeTruthy();
    });
  });

  it('loads persisted settings from localStorage on mount', () => {
    localStorageMock.setItem('jumpship_settings', JSON.stringify({
      ...DEFAULT_SETTINGS,
      llmProvider: 'groq',
      llmModel: 'mixtral-8x7b-32768',
    }));
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
    expect(result.current.settings.llmProvider).toBe('groq');
    expect(result.current.settings.llmModel).toBe('mixtral-8x7b-32768');
  });

  it('merges with DEFAULT_SETTINGS when stored data is partial', () => {
    localStorageMock.setItem('jumpship_settings', JSON.stringify({ llmProvider: 'anthropic' }));
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
    expect(result.current.settings.llmProvider).toBe('anthropic');
    expect(result.current.settings.resultsWanted).toBe(DEFAULT_SETTINGS.resultsWanted);
  });

  it('handles corrupt localStorage gracefully', () => {
    localStorageMock.setItem('jumpship_settings', 'not-valid-json{{{{');
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
    // Key fields default to '' (server returns {}); other fields use DEFAULT_SETTINGS.
    expect(result.current.settings.llmProvider).toBe(DEFAULT_SETTINGS.llmProvider);
    expect(result.current.settings.resultsWanted).toBe(DEFAULT_SETTINGS.resultsWanted);
  });

  it('updates state synchronously after saveSettings', () => {
    const { result } = renderHook(() => useSettings(), { wrapper: makeWrapper() });
    act(() => {
      result.current.saveSettings({ ...DEFAULT_SETTINGS, resultsWanted: 50 });
    });
    expect(result.current.settings.resultsWanted).toBe(50);
  });
});
