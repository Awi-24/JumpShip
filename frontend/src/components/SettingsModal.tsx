import { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import type { Settings } from '../hooks/useSettings';
import type { LLMProvider } from '../types';

// Curated fallback model lists (used when live fetch fails)
const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  ollama:    [],
  openclaw:  ['openclaw-default'],
  lmstudio:  ['lmstudio-default'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
};

const LOCAL_PROVIDERS: LLMProvider[] = ['ollama', 'openclaw', 'lmstudio'];

interface Props {
  open: boolean;
  initial: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsModal({ open, initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => { setDraft(initial); }, [initial]);

  // Fetch models whenever provider/URL/key changes
  useEffect(() => {
    if (!open) return;
    setLiveModels([]);

    if (draft.llmProvider === 'ollama' || draft.llmProvider === 'openclaw' || draft.llmProvider === 'lmstudio') {
      // Fetch from local Ollama-compatible server via backend proxy
      setLoadingModels(true);
      const params = draft.ollamaUrl ? `?base_url=${encodeURIComponent(draft.ollamaUrl)}` : '';
      fetch(`/api/ollama/models${params}`)
        .then(r => r.json())
        .then((models: string[]) => {
          setLiveModels(models);
          if (models.length > 0 && !models.includes(draft.llmModel)) {
            setDraft(d => ({ ...d, llmModel: models[0] }));
          }
        })
        .catch(() => setLiveModels([]))
        .finally(() => setLoadingModels(false));

    } else if (draft.llmProvider === 'groq' && draft.groqKey) {
      // Fetch available Groq models via backend proxy (avoids CORS issues)
      setLoadingModels(true);
      fetch(`/api/groq/models?api_key=${encodeURIComponent(draft.groqKey)}`)
        .then(r => r.json())
        .then((models: string[]) => {
          setLiveModels(models);
          if (models.length > 0 && !models.includes(draft.llmModel)) {
            setDraft(d => ({ ...d, llmModel: models[0] }));
          }
        })
        .catch(() => setLiveModels(PROVIDER_MODELS.groq))
        .finally(() => setLoadingModels(false));

    } else {
      // Cloud providers without key — use curated fallback list
      setLiveModels(PROVIDER_MODELS[draft.llmProvider] ?? []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.llmProvider, draft.ollamaUrl, draft.groqKey]);

  if (!open) return null;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const handleProviderChange = (p: LLMProvider) => {
    const defaultModel = PROVIDER_MODELS[p][0] ?? '';
    setDraft(d => ({ ...d, llmProvider: p, llmModel: defaultModel }));
    setStatus('idle');
  };

  const testConnection = async () => {
    setStatus('checking');
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setStatus(data.llm_available ? 'ok' : 'error');
    } catch {
      setStatus('error');
    }
  };

  const isCloud = !LOCAL_PROVIDERS.includes(draft.llmProvider);

  const apiKey =
    draft.llmProvider === 'openai'    ? draft.openaiKey :
    draft.llmProvider === 'anthropic' ? draft.anthropicKey :
    draft.llmProvider === 'groq'      ? draft.groqKey : '';

  const setApiKey = (val: string) => {
    if (draft.llmProvider === 'openai')    set('openaiKey', val);
    if (draft.llmProvider === 'anthropic') set('anthropicKey', val);
    if (draft.llmProvider === 'groq')      set('groqKey', val);
  };

  // Use live models when available, else fallback
  const modelOptions = liveModels.length > 0 ? liveModels : PROVIDER_MODELS[draft.llmProvider];
  const hasModelList = modelOptions.length > 0;
  const isOllamaUnreachable =
    draft.llmProvider === 'ollama' && !loadingModels && liveModels.length === 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">⚙ Settings</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '24px 28px' }}>
          <div className="settings-section">

            {/* Provider */}
            <div className="settings-row">
              <label className="settings-label">Provider</label>
              <CustomSelect
                value={draft.llmProvider}
                onChange={v => handleProviderChange(v as LLMProvider)}
                options={[
                  { value: 'ollama',    label: 'Ollama',               group: 'Local' },
                  { value: 'lmstudio', label: 'LM Studio',             group: 'Local' },
                  { value: 'openclaw', label: 'OpenClaw',              group: 'Local' },
                  { value: 'openai',   label: 'OpenAI',                group: 'Cloud API' },
                  { value: 'anthropic',label: 'Anthropic',             group: 'Cloud API' },
                  { value: 'groq',     label: 'Groq (fast & free tier)', group: 'Cloud API' },
                ]}
              />
            </div>

            {/* Local URL */}
            {!isCloud && (
              <div className="settings-row">
                <label className="settings-label">Base URL</label>
                <input
                  className="config-input"
                  value={draft.ollamaUrl}
                  onChange={e => set('ollamaUrl', e.target.value)}
                  placeholder="default (host.docker.internal:11434)"
                />
                <div className="settings-hint">
                  Leave blank to use the server's configured URL. In Docker, use host.docker.internal:11434.
                </div>
              </div>
            )}

            {/* Model */}
            <div className="settings-row">
              <label className="settings-label">
                Model
                {loadingModels && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span className="spinner" style={{ width: 10, height: 10, display: 'inline-block', verticalAlign: 'middle' }} /> fetching…
                  </span>
                )}
                {!loadingModels && liveModels.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#4ade80' }}>
                    {liveModels.length} model{liveModels.length > 1 ? 's' : ''} available
                  </span>
                )}
                {isOllamaUnreachable && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#f87171' }}>
                    Ollama unreachable — type manually
                  </span>
                )}
              </label>

              {hasModelList ? (
                // Proper dropdown when models are known
                <CustomSelect
                  value={draft.llmModel}
                  onChange={v => set('llmModel', v)}
                  options={modelOptions.map(m => ({ value: m, label: m }))}
                />
              ) : (
                // Free-text when Ollama is unreachable or provider has no list
                <input
                  className="config-input"
                  value={draft.llmModel}
                  onChange={e => set('llmModel', e.target.value)}
                  placeholder="e.g. qwen2.5:7b-instruct"
                  autoComplete="off"
                />
              )}
            </div>

            {/* API Key */}
            {isCloud && (
              <div className="settings-row">
                <label className="settings-label">
                  API Key
                  <span className="settings-required">required</span>
                </label>
                <input
                  className="config-input"
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={
                    draft.llmProvider === 'openai'    ? 'sk-…' :
                    draft.llmProvider === 'anthropic' ? 'sk-ant-…' : 'gsk_…'
                  }
                  autoComplete="off"
                />
                <div className="settings-hint">
                  Stored only in your browser — never sent anywhere except the provider's API.
                </div>
              </div>
            )}

            {/* Groq helper */}
            {draft.llmProvider === 'groq' && (
              <div className="settings-hint" style={{ marginTop: 2 }}>
                Get a free key at{' '}
                <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--gold)' }}>
                  console.groq.com/keys
                </a>{' '}
                — recommended: <code>llama-3.3-70b-versatile</code> or <code>llama-3.1-8b-instant</code> (fastest).
              </div>
            )}

            {/* Assessment Speed */}
            <div className="settings-row" style={{ marginTop: 8 }}>
              <label className="settings-label">Assessment Speed</label>
              <div className="speed-mode-picker">
                {(['careful', 'balanced', 'turbo'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className={`speed-mode-btn ${draft.assessmentSpeed === mode ? 'active' : ''}`}
                    onClick={() => set('assessmentSpeed', mode)}
                  >
                    <span className="speed-mode-icon">
                      {mode === 'careful' ? '🔬' : mode === 'balanced' ? '⚡' : '🚀'}
                    </span>
                    <span className="speed-mode-label">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                    <span className="speed-mode-desc">
                      {mode === 'careful' ? '1 at a time' : mode === 'balanced' ? '3 parallel' : '6 parallel'}
                    </span>
                  </button>
                ))}
              </div>
              <div className="settings-hint">
                Controls how many jobs are analyzed simultaneously. Turbo is faster but uses more resources.
              </div>
            </div>

            {/* Connection test */}
            <div className="settings-row settings-row--inline" style={{ marginTop: 20 }}>
              <button className="test-btn" onClick={testConnection} disabled={status === 'checking'}>
                {status === 'checking'
                  ? <><div className="spinner" style={{ width: 12, height: 12 }} /> Testing…</>
                  : 'Test Connection'}
              </button>
              {status === 'ok'    && <span className="test-result ok">✓ Connected</span>}
              {status === 'error' && (
                <span className="test-result error">
                  ✕ Unreachable
                  {!isCloud && <span className="test-hint"> — is {draft.llmProvider} running?</span>}
                </span>
              )}
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-secondary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: 14 }}
            onClick={() => { onSave(draft); onClose(); }}
          >
            Save Settings
          </button>
        </div>

      </div>
    </div>
  );
}
