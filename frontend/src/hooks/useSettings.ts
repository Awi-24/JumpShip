import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LLMProvider } from '../types';

export interface Settings {
  // LLM
  llmProvider: LLMProvider;
  llmModel: string;
  ollamaUrl: string;
  openaiKey: string;
  anthropicKey: string;
  groqKey: string;
  geminiKey: string;
  mistralKey: string;
  deepseekKey: string;
  huggingfaceKey: string;
  openrouterKey: string;
  cohereKey: string;
  // Search defaults
  resultsWanted: number;
  defaultSites: string[];
  defaultLocation: string;
  assessmentSpeed: 'careful' | 'balanced' | 'turbo';
  // Resume generation
  resumeGenThreshold: number;
  // Per-step model overrides (same provider, different model per pipeline step)
  evaluatorLlmModel: string;
  resumeGenLlmModel: string;
  interviewLlmModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  llmProvider: 'ollama',
  llmModel: '',
  ollamaUrl: '',
  openaiKey: '',
  anthropicKey: '',
  groqKey: '',
  geminiKey: '',
  mistralKey: '',
  deepseekKey: '',
  huggingfaceKey: '',
  openrouterKey: '',
  cohereKey: '',
  resultsWanted: 20,
  defaultSites: ['linkedin', 'indeed', 'glassdoor'],
  defaultLocation: '',
  assessmentSpeed: 'balanced',
  resumeGenThreshold: 70,
  evaluatorLlmModel: '',
  resumeGenLlmModel: '',
  interviewLlmModel: '',
};

const STORAGE_KEY = 'jumpship_settings';

// Mapping between Settings field <-> server provider name
const KEY_FIELD_TO_PROVIDER: Record<string, string> = {
  openaiKey: 'openai',
  anthropicKey: 'anthropic',
  groqKey: 'groq',
  geminiKey: 'gemini',
  mistralKey: 'mistral',
  deepseekKey: 'deepseek',
  huggingfaceKey: 'huggingface',
  openrouterKey: 'openrouter',
  cohereKey: 'cohere',
};
const PROVIDER_TO_KEY_FIELD: Record<string, keyof Settings> = Object.fromEntries(
  Object.entries(KEY_FIELD_TO_PROVIDER).map(([k, v]) => [v, k as keyof Settings])
) as Record<string, keyof Settings>;

const KEY_FIELDS = Object.keys(KEY_FIELD_TO_PROVIDER) as (keyof Settings)[];

type ServerKeys = Record<string, string>;

function loadLocal(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLocal(s: Settings) {
  // REMOVED 2026-04-27 — LLM API keys moved to server (Fernet-encrypted). See HDF-20260427-10.
  // Strip key fields before persisting non-secret settings.
  const sanitized: Record<string, unknown> = { ...s };
  for (const f of KEY_FIELDS) sanitized[f as string] = '';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    /* ignore */
  }
}

async function fetchLlmKeys(): Promise<ServerKeys> {
  const res = await fetch('/api/settings/llm-keys');
  if (!res.ok) throw new Error('Failed to load LLM keys');
  return res.json();
}

async function putLlmKeys(payload: ServerKeys): Promise<void> {
  const res = await fetch('/api/settings/llm-keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to save LLM keys: ${res.status}`);
  }
}

export function useLlmKeys() {
  return useQuery<ServerKeys>({
    queryKey: ['llm-keys'],
    queryFn: fetchLlmKeys,
    staleTime: 60_000,
  });
}

export function useUpdateLlmKeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: putLlmKeys,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-keys'] });
    },
  });
}

/**
 * One-shot migration: if server has no keys but localStorage holds legacy ones,
 * push them to the server then strip from localStorage. Idempotent per session.
 */
function useMigrateLocalStorageKeys(serverKeys: ServerKeys | undefined) {
  const ran = useRef(false);
  const qc = useQueryClient();
  useEffect(() => {
    if (ran.current) return;
    if (!serverKeys) return; // wait for server fetch
    if (Object.keys(serverKeys).length > 0) {
      ran.current = true;
      // Server already has keys — just strip any leftover legacy values from LS.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          let dirty = false;
          for (const f of KEY_FIELDS) {
            if (parsed[f]) { parsed[f] = ''; dirty = true; }
          }
          if (dirty) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
      } catch { /* ignore */ }
      return;
    }

    // Server empty — look for legacy values to migrate.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { ran.current = true; return; }
      const parsed = JSON.parse(raw);
      const payload: ServerKeys = {};
      for (const f of KEY_FIELDS) {
        const v = parsed[f];
        if (typeof v === 'string' && v.length > 0) {
          payload[KEY_FIELD_TO_PROVIDER[f as string]] = v;
        }
      }
      if (Object.keys(payload).length === 0) { ran.current = true; return; }

      ran.current = true;
      putLlmKeys(payload)
        .then(() => {
          for (const f of KEY_FIELDS) parsed[f] = '';
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          // eslint-disable-next-line no-console
          console.info('[migration] LLM API keys moved to server');
          qc.invalidateQueries({ queryKey: ['llm-keys'] });
        })
        .catch(err => {
          // eslint-disable-next-line no-console
          console.warn('[migration] LLM key migration failed; will retry next session', err);
          ran.current = false;
        });
    } catch {
      ran.current = true;
    }
  }, [serverKeys, qc]);
}

export function useSettings() {
  // REMOVED 2026-04-27 — LLM API keys moved to server (Fernet-encrypted). See HDF-20260427-10.
  // Non-key fields still persist in localStorage; key fields are hydrated from the server.
  const [localSettings, setLocalSettings] = useState<Settings>(loadLocal);
  const { data: serverKeys } = useLlmKeys();
  const updateKeys = useUpdateLlmKeys();

  useMigrateLocalStorageKeys(serverKeys);

  // Merge: non-key fields come from local state; key fields come from the server.
  const settings: Settings = { ...localSettings };
  const indexable = settings as unknown as Record<string, unknown>;
  for (const f of KEY_FIELDS) indexable[f as string] = '';
  if (serverKeys) {
    for (const [provider, key] of Object.entries(serverKeys)) {
      const field = PROVIDER_TO_KEY_FIELD[provider];
      if (field) indexable[field as string] = key;
    }
  }

  const saveSettings = useCallback((next: Settings) => {
    // Persist non-key fields locally.
    saveLocal(next);
    setLocalSettings(next);

    // Diff key fields against currently-known server keys; PUT only changes.
    const currentServer = serverKeys ?? {};
    const payload: ServerKeys = {};
    for (const f of KEY_FIELDS) {
      const provider = KEY_FIELD_TO_PROVIDER[f as string];
      const incoming = (next[f] as string) ?? '';
      const existing = currentServer[provider] ?? '';
      if (incoming !== existing) {
        payload[provider] = incoming; // empty string clears
      }
    }
    if (Object.keys(payload).length > 0) {
      updateKeys.mutate(payload);
    }
  }, [serverKeys, updateKeys]);

  return { settings, saveSettings };
}
