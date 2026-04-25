import { useState, useEffect } from 'react';
import { Settings2, X, Check, Microscope, Zap, Rocket, FileText } from 'lucide-react';
import CustomSelect from './CustomSelect';
import type { Settings } from '../hooks/useSettings';
import type { LLMProvider } from '../types';

const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  ollama:      [],
  lmstudio:    [],
  openai:      ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic:   ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  groq:        ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
  gemini:      ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'],
  mistral:     ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
  deepseek:    ['deepseek-chat', 'deepseek-reasoner'],
  huggingface: ['Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
  openrouter:  ['meta-llama/llama-3.2-3b-instruct:free', 'google/gemma-3-27b-it:free', 'mistralai/mistral-7b-instruct:free'],
  cohere:      ['command-r', 'command-r-plus'],
};

const LOCAL_PROVIDERS: LLMProvider[] = ['ollama', 'lmstudio'];

const PROVIDER_OPTIONS = [
  { value: 'ollama',      label: 'Ollama (local)',          group: 'Local' },
  { value: 'lmstudio',   label: 'LM Studio (local)',       group: 'Local' },
  { value: 'openai',     label: 'OpenAI',                  group: 'Cloud API' },
  { value: 'anthropic',  label: 'Anthropic (Claude)',      group: 'Cloud API' },
  { value: 'groq',       label: 'Groq (fast free tier)',   group: 'Cloud API' },
  { value: 'gemini',     label: 'Google Gemini',           group: 'Cloud API' },
  { value: 'mistral',    label: 'Mistral AI',              group: 'Cloud API' },
  { value: 'deepseek',   label: 'DeepSeek',                group: 'Cloud API' },
  { value: 'huggingface',label: 'Hugging Face',            group: 'Cloud API' },
  { value: 'openrouter', label: 'OpenRouter (free models)',group: 'Cloud API' },
  { value: 'cohere',     label: 'Cohere',                  group: 'Cloud API' },
];

const API_KEY_FIELD: Partial<Record<LLMProvider, keyof Settings>> = {
  openai:      'openaiKey',
  anthropic:   'anthropicKey',
  groq:        'groqKey',
  gemini:      'geminiKey',
  mistral:     'mistralKey',
  deepseek:    'deepseekKey',
  huggingface: 'huggingfaceKey',
  openrouter:  'openrouterKey',
  cohere:      'cohereKey',
};

const API_KEY_PLACEHOLDER: Partial<Record<LLMProvider, string>> = {
  openai:      'sk-…',
  anthropic:   'sk-ant-…',
  groq:        'gsk_…',
  gemini:      'AIza…',
  mistral:     'mi-…',
  deepseek:    'sk-…',
  huggingface: 'hf_…',
  openrouter:  'sk-or-…',
  cohere:      'co-…',
};

interface Props {
  open: boolean;
  initial: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsModal({ open, initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => { setDraft(initial); }, [initial]);

  useEffect(() => {
    if (!open) return;
    setLiveModels([]);

    if (LOCAL_PROVIDERS.includes(draft.llmProvider)) {
      setLoadingModels(true);
      const params = new URLSearchParams({ provider: draft.llmProvider });
      if (draft.ollamaUrl) params.set('base_url', draft.ollamaUrl);
      fetch(`/api/ollama/models?${params}`)
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
    setTestMessage('');
  };

  const isLocal = LOCAL_PROVIDERS.includes(draft.llmProvider);
  const isCloud = !isLocal;
  const apiKeyField = API_KEY_FIELD[draft.llmProvider];
  const apiKey = apiKeyField ? (draft[apiKeyField] as string) : '';
  const setApiKey = (val: string) => {
    if (apiKeyField) set(apiKeyField, val as never);
  };

  const testConnection = async () => {
    setStatus('checking');
    setTestMessage('');
    try {
      const res = await fetch('/api/test-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draft.llmProvider,
          base_url: draft.ollamaUrl || '',
          model: draft.llmModel || '',
          api_key: apiKey || '',
        }),
      });
      const data = await res.json();
      setStatus(data.ok ? 'ok' : 'error');
      setTestMessage(data.message || '');
      if (data.ok && data.resolved_url && data.resolved_url !== draft.ollamaUrl) {
        setDraft(d => ({ ...d, ollamaUrl: data.resolved_url }));
      }
    } catch {
      setStatus('error');
      setTestMessage('Could not reach backend.');
    }
  };

  const modelOptions = liveModels.length > 0 ? liveModels : PROVIDER_MODELS[draft.llmProvider];
  const hasModelList = modelOptions.length > 0;
  const isLocalUnreachable = isLocal && !loadingModels && liveModels.length === 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>

        <div className="modal-header">
          <div className="modal-title">
            <Settings2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Settings
          </div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ padding: '24px 28px' }}>
          <div className="settings-section">

            {/* Provider */}
            <div className="settings-row">
              <label className="settings-label">LLM Provider</label>
              <CustomSelect
                value={draft.llmProvider}
                onChange={v => handleProviderChange(v as LLMProvider)}
                options={PROVIDER_OPTIONS}
              />
            </div>

            {/* Local base URL */}
            {isLocal && (
              <div className="settings-row">
                <label className="settings-label">Base URL</label>
                <input
                  className="config-input"
                  value={draft.ollamaUrl}
                  onChange={e => set('ollamaUrl', e.target.value)}
                  placeholder={draft.llmProvider === 'lmstudio' ? 'http://localhost:1234/v1/' : 'http://localhost:11434'}
                />
                <div className="settings-hint">
                  {draft.llmProvider === 'lmstudio'
                    ? 'LM Studio default: http://localhost:1234/v1/. Start "Local Server" in LM Studio first.'
                    : 'Leave blank to use backend default. Linux: try http://127.0.0.1:11434 if localhost fails.'}
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
                    {liveModels.length} available
                  </span>
                )}
                {isLocalUnreachable && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#f87171' }}>
                    unreachable; type manually
                  </span>
                )}
              </label>
              {hasModelList ? (
                <CustomSelect
                  value={draft.llmModel}
                  onChange={v => set('llmModel', v)}
                  options={modelOptions.map(m => ({ value: m, label: m }))}
                />
              ) : (
                <input
                  className="config-input"
                  value={draft.llmModel}
                  onChange={e => set('llmModel', e.target.value)}
                  placeholder={draft.llmProvider === 'lmstudio' ? 'loaded model name' : 'e.g. qwen2.5:7b-instruct'}
                  autoComplete="off"
                />
              )}
            </div>

            {/* API Key — cloud providers */}
            {isCloud && apiKeyField && (
              <div className="settings-row">
                <label className="settings-label">
                  API Key <span className="settings-required">required</span>
                </label>
                <input
                  className="config-input"
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={API_KEY_PLACEHOLDER[draft.llmProvider] ?? 'API key…'}
                  autoComplete="off"
                />
                <div className="settings-hint">
                  Stored only in your browser, and sent only to the provider's API via the backend.
                </div>
              </div>
            )}

            {/* Per-step model overrides */}
            {hasModelList && (
              <div className="settings-row" style={{ marginTop: 4 }}>
                <label className="settings-label" style={{ marginBottom: 8 }}>Per-step model overrides</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(
                    [
                      { key: 'evaluatorLlmModel', label: 'Evaluator' },
                      { key: 'resumeGenLlmModel', label: 'Resume Gen' },
                      { key: 'interviewLlmModel', label: 'Interview' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>{label}</span>
                      <div style={{ flex: 1 }}>
                        <CustomSelect
                          value={draft[key]}
                          onChange={v => set(key, v)}
                          options={[
                            { value: '', label: 'Same as above' },
                            ...modelOptions.map(m => ({ value: m, label: m })),
                          ]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="settings-hint">Leave blank to use the model selected above.</div>
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
                      {mode === 'careful' ? <Microscope size={16} strokeWidth={1.5} /> : mode === 'balanced' ? <Zap size={16} strokeWidth={1.5} /> : <Rocket size={16} strokeWidth={1.5} />}
                    </span>
                    <span className="speed-mode-label">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                    <span className="speed-mode-desc">
                      {mode === 'careful' ? '1 at a time' : mode === 'balanced' ? '3 parallel' : '6 parallel'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Resume Generation Threshold */}
            <div className="settings-row" style={{ marginTop: 8 }}>
              <label className="settings-label">
                <FileText size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                Resume Gen Threshold
                <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--gold)' }}>{draft.resumeGenThreshold}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={draft.resumeGenThreshold}
                onChange={e => set('resumeGenThreshold', Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold)' }}
              />
              <div className="settings-hint">
                Jobs scoring ≥ {draft.resumeGenThreshold}% will show a highlighted "Download Resume" button.
                Set higher to be more selective.
              </div>
            </div>

            {/* Connection test */}
            <div style={{ marginTop: 20 }}>
              <div className="settings-row settings-row--inline">
                <button className="test-btn" onClick={testConnection} disabled={status === 'checking'}>
                  {status === 'checking'
                    ? <><div className="spinner" style={{ width: 12, height: 12 }} /> Testing…</>
                    : 'Test Connection'}
                </button>
                {status === 'ok'    && <span className="test-result ok"><Check size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />Connected</span>}
                {status === 'error' && <span className="test-result error"><X size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />Failed</span>}
              </div>
              {testMessage && (
                <div style={{
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  background: status === 'ok' ? 'rgba(74,222,128,0.06)' : 'rgba(248,113,113,0.06)',
                  border: `1px solid ${status === 'ok' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                  color: status === 'ok' ? '#4ade80' : '#f87171',
                }}>
                  {testMessage}
                </div>
              )}
            </div>

          </div>
        </div>

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
