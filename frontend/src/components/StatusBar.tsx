import { useQuery } from '@tanstack/react-query';
import { useSettings } from '../hooks/useSettings';

const LOCAL = new Set(['ollama', 'lmstudio', 'openclaw']);
const NAMES: Record<string, string> = {
  ollama: 'Ollama', lmstudio: 'LM Studio', openai: 'OpenAI', anthropic: 'Anthropic', groq: 'Groq', gemini: 'Gemini',
  mistral: 'Mistral', deepseek: 'DeepSeek', huggingface: 'Hugging Face', openrouter: 'OpenRouter', cohere: 'Cohere',
};

/** Desktop status bar: which model assesses jobs and whether the backend reaches it. */
export default function StatusBar() {
  const { settings } = useSettings();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await fetch('/api/health')).json() as Promise<{ llm_available?: boolean }>,
    refetchInterval: 15_000,
  });
  const local = LOCAL.has(settings.llmProvider);
  const state = health.isError ? 'red' : health.data?.llm_available || !local ? 'green' : 'yellow';
  const note = health.isError ? 'app server not responding' : local && !health.data?.llm_available ? 'not reachable' : '';

  return (
    <footer className="statusbar">
      <span className="statusbar-item">
        <span className={`status-dot ${state}`} />
        {NAMES[settings.llmProvider] ?? settings.llmProvider}
        {settings.llmModel ? ` · ${settings.llmModel}` : ''}
        {note && ` — ${note}`}
      </span>
      <span className="statusbar-item">{local ? 'Runs on this computer' : 'Cloud model'}</span>
    </footer>
  );
}
