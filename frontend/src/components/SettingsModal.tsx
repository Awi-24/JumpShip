import { useState, useEffect } from 'react';
import type { Settings } from '../hooks/useSettings';
import type { LLMProvider } from '../types';

// Fallback / cloud model suggestions shown when Ollama can't be queried
const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  ollama:    [],  // populated at runtime from /api/ollama/models
  openclaw:  ['openclaw-default'],
  lmstudio:  ['lmstudio-default'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  groq:      ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
};

const LOCAL_PROVIDERS: LLMProvider[] = ['ollama', 'openclaw', 'lmstudio'];
const ALL_SITES = ['linkedin', 'indeed', 'glassdoor', 'zip_recruiter'];

interface Props {
  open: boolean;
  initial: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsModal({ open, initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [activeTab, setActiveTab] = useState<'llm' | 'search'>('llm');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Keep draft in sync if settings change externally
  useEffect(() => { setDraft(initial); }, [initial]);

  // Fetch Ollama models whenever provider is ollama or the base URL changes
  useEffect(() => {
    if (!open) return;
    if (draft.llmProvider !== 'ollama') return;

    setLoadingModels(true);
    const params = draft.ollamaUrl
      ? `?base_url=${encodeURIComponent(draft.ollamaUrl)}`
      : '';

    fetch(`/api/ollama/models${params}`)
      .then(r => r.json())
      .then((models: string[]) => {
        setOllamaModels(models);
        // If the current model isn't in the fetched list, auto-select the first one
        if (models.length > 0 && !models.includes(draft.llmModel)) {
          setDraft(d => ({ ...d, llmModel: models[0] }));
        }
      })
      .catch(() => setOllamaModels([]))
      .finally(() => setLoadingModels(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft.llmProvider, draft.ollamaUrl]);

  if (!open) return null;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const handleProviderChange = (p: LLMProvider) => {
    const defaultModel = PROVIDER_MODELS[p][0] ?? '';
    setDraft(d => ({ ...d, llmProvider: p, llmModel: defaultModel }));
    setStatus('idle');
  };

  const toggleSite = (site: string) => {
    setDraft(d => ({
      ...d,
      defaultSites: d.defaultSites.includes(site)
        ? d.defaultSites.filter(s => s !== site)
        : [...d.defaultSites, site],
    }));
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
  const apiKey = draft.llmProvider === 'openai'
    ? draft.openaiKey
    : draft.llmProvider === 'anthropic'
    ? draft.anthropicKey
    : draft.llmProvider === 'groq'
    ? draft.groqKey
    : '';

  const setApiKey = (val: string) => {
    if (draft.llmProvider === 'openai')    set('openaiKey', val);
    if (draft.llmProvider === 'anthropic') set('anthropicKey', val);
    if (draft.llmProvider === 'groq')      set('groqKey', val);
  };

  // For cloud providers use the hardcoded list; for Ollama use the live list
  const modelSuggestions = draft.llmProvider === 'ollama'
    ? ollamaModels
    : PROVIDER_MODELS[draft.llmProvider];

  const datalistId = `model-suggestions-${draft.llmProvider}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">⚙ Settings</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === 'llm' ? 'active' : ''}`}
            onClick={() => setActiveTab('llm')}
          >
            🤖 LLM Provider
          </button>
          <button
            className={`modal-tab ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            🔍 Search Defaults
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">

          {/* ── LLM TAB ── */}
          {activeTab === 'llm' && (
            <div className="settings-section">

              <div className="settings-row">
                <label className="settings-label">Provider</label>
                <select
                  className="config-select"
                  value={draft.llmProvider}
                  onChange={e => handleProviderChange(e.target.value as LLMProvider)}
                >
                  <optgroup label="Local">
                    <option value="ollama">Ollama</option>
                    <option value="lmstudio">LM Studio</option>
                    <option value="openclaw">OpenClaw</option>
                  </optgroup>
                  <optgroup label="Cloud API">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="groq">Groq</option>
                  </optgroup>
                </select>
              </div>

              {/* Local provider URL — shown first so URL can be set before model fetch */}
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
                    Leave blank to use the server's configured URL. In Docker, Ollama is reached via host.docker.internal:11434.
                  </div>
                </div>
              )}

              <div className="settings-row">
                <label className="settings-label">
                  Model
                  {loadingModels && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span className="spinner" style={{ width: 10, height: 10, display: 'inline-block', verticalAlign: 'middle' }} /> fetching…
                    </span>
                  )}
                  {draft.llmProvider === 'ollama' && !loadingModels && ollamaModels.length === 0 && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#f87171' }}>
                      Ollama unreachable — type model name manually
                    </span>
                  )}
                  {draft.llmProvider === 'ollama' && !loadingModels && ollamaModels.length > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#4ade80' }}>
                      {ollamaModels.length} model{ollamaModels.length > 1 ? 's' : ''} found
                    </span>
                  )}
                </label>

                {/* datalist gives autocomplete from live list while still allowing free text */}
                <datalist id={datalistId}>
                  {modelSuggestions.map(m => <option key={m} value={m} />)}
                </datalist>
                <input
                  className="config-input"
                  list={datalistId}
                  value={draft.llmModel}
                  onChange={e => set('llmModel', e.target.value)}
                  placeholder={
                    draft.llmProvider === 'ollama'
                      ? loadingModels ? 'Loading…' : 'e.g. qwen2.5:7b-instruct'
                      : modelSuggestions[0] ?? 'model name'
                  }
                  autoComplete="off"
                />
                {draft.llmProvider === 'ollama' && ollamaModels.length > 0 && (
                  <div className="settings-hint">
                    Click to pick from your installed models, or type any name
                  </div>
                )}
              </div>

              {/* Cloud API key */}
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
                      draft.llmProvider === 'openai' ? 'sk-...' :
                      draft.llmProvider === 'anthropic' ? 'sk-ant-...' :
                      'gsk_...'
                    }
                    autoComplete="off"
                  />
                  <div className="settings-hint">
                    Stored only in your browser — never sent to any server except the provider.
                  </div>
                </div>
              )}

              {/* Connection test */}
              <div className="settings-row settings-row--inline">
                <button className="test-btn" onClick={testConnection} disabled={status === 'checking'}>
                  {status === 'checking' ? (
                    <><div className="spinner" style={{ width: 12, height: 12 }} /> Testing...</>
                  ) : 'Test Connection'}
                </button>
                {status === 'ok' && (
                  <span className="test-result ok">✓ Connected</span>
                )}
                {status === 'error' && (
                  <span className="test-result error">
                    ✕ Unreachable
                    {!isCloud && (
                      <span className="test-hint"> — is {draft.llmProvider} running?</span>
                    )}
                  </span>
                )}
              </div>

            </div>
          )}

          {/* ── SEARCH TAB ── */}
          {activeTab === 'search' && (
            <div className="settings-section">

              <div className="settings-row">
                <label className="settings-label">Default location</label>
                <input
                  className="config-input"
                  value={draft.defaultLocation}
                  onChange={e => set('defaultLocation', e.target.value)}
                  placeholder="Remote, São Paulo, New York..."
                />
              </div>

              <div className="settings-row">
                <label className="settings-label">Results per search</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={5}
                    value={draft.resultsWanted}
                    onChange={e => set('resultsWanted', Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--gold)' }}
                  />
                  <span style={{ fontSize: 14, color: 'var(--gold)', fontFamily: 'Syne', fontWeight: 700, minWidth: 28 }}>
                    {draft.resultsWanted}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <label className="settings-label">Job boards</label>
                <div className="site-checkboxes">
                  {ALL_SITES.map(site => (
                    <label key={site} className="site-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.defaultSites.includes(site)}
                        onChange={() => toggleSite(site)}
                      />
                      <span>{site}</span>
                    </label>
                  ))}
                </div>
                <div className="settings-hint">At least one source must be selected.</div>
              </div>

            </div>
          )}
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
