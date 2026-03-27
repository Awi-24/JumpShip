import { useState, useEffect } from 'react';
import type { Settings } from '../hooks/useSettings';
import type { LLMProvider } from '../types';

const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  ollama:    ['llama3:8b', 'llama3:70b', 'mistral:7b', 'mixtral:8x7b', 'phi3:mini', 'gemma2:9b', 'deepseek-r1:7b'],
  openclaw:  ['openclaw-default'],
  lmstudio:  ['lmstudio-default'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
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

  // Keep draft in sync if settings change externally
  useEffect(() => { setDraft(initial); }, [initial]);

  if (!open) return null;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const handleProviderChange = (p: LLMProvider) => {
    setDraft(d => ({
      ...d,
      llmProvider: p,
      llmModel: PROVIDER_MODELS[p][0],
    }));
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

              <div className="settings-row">
                <label className="settings-label">Model</label>
                <select
                  className="config-select"
                  value={draft.llmModel}
                  onChange={e => set('llmModel', e.target.value)}
                >
                  {PROVIDER_MODELS[draft.llmProvider].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Local provider URL */}
              {!isCloud && (
                <div className="settings-row">
                  <label className="settings-label">Base URL</label>
                  <input
                    className="config-input"
                    value={draft.ollamaUrl}
                    onChange={e => set('ollamaUrl', e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                  <div className="settings-hint">
                    The address where {draft.llmProvider} is running
                  </div>
                </div>
              )}

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
                    Stored only in your browser (localStorage) — never sent to any server except the chosen provider.
                  </div>
                </div>
              )}

              {/* Connection test */}
              <div className="settings-row settings-row--inline">
                <button className="test-btn" onClick={testConnection} disabled={status === 'checking'}>
                  {status === 'checking' ? (
                    <><div className="spinner" style={{ width: 12, height: 12 }} /> Testing...</>
                  ) : (
                    'Test Connection'
                  )}
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
                <div className="settings-hint">
                  At least one source must be selected.
                </div>
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
