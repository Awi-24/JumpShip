import { useEffect, useState } from 'react';
import type { LLMProvider } from '../types';

const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  ollama: ['llama3:8b', 'llama3:70b', 'mistral:7b', 'mixtral:8x7b', 'phi3:mini', 'gemma2:9b'],
  openclaw: ['openclaw-default'],
  lmstudio: ['lmstudio-default'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
  groq: ['llama3-70b-8192', 'mixtral-8x7b-32768'],
};

const LOCAL_PROVIDERS: LLMProvider[] = ['ollama', 'openclaw', 'lmstudio'];

interface LLMConfigProps {
  provider: LLMProvider;
  model: string;
  onProviderChange: (p: LLMProvider) => void;
  onModelChange: (m: string) => void;
}

export default function LLMConfigPanel({
  provider,
  model,
  onProviderChange,
  onModelChange,
}: LLMConfigProps) {
  const [status, setStatus] = useState<'green' | 'yellow' | 'red'>('yellow');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/health');
        const data = await res.json();
        setStatus(data.llm_available ? 'green' : 'yellow');
      } catch {
        setStatus('red');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [provider]);

  const models = PROVIDER_MODELS[provider] || [];
  const isCloud = !LOCAL_PROVIDERS.includes(provider);

  return (
    <div className="llm-config">
      <div className="filter-label">Provider</div>
      <select
        className="config-select"
        value={provider}
        onChange={(e) => {
          const p = e.target.value as LLMProvider;
          onProviderChange(p);
          onModelChange(PROVIDER_MODELS[p][0]);
        }}
      >
        <option value="ollama">Ollama (local)</option>
        <option value="openclaw">OpenClaw (local)</option>
        <option value="lmstudio">LM Studio (local)</option>
        <option value="openai">OpenAI API</option>
        <option value="anthropic">Anthropic API</option>
        <option value="groq">Groq API</option>
      </select>

      <div className="filter-label">Model</div>
      <select
        className="config-select"
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {isCloud && (
        <input
          className="config-input"
          placeholder={provider === 'openai' ? 'sk-...' : 'API key...'}
          type="password"
        />
      )}

      <div className="llm-status">
        <span className={`status-dot ${status}`} />
        {status === 'green'
          ? `Connected · ${provider} running`
          : status === 'yellow'
          ? 'Connecting...'
          : 'Disconnected'}
      </div>
    </div>
  );
}
