import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Clock,
  Eye,
  LifeBuoy,
  Plus,
  Square,
  X,
  Zap,
} from 'lucide-react';
import type { Agent, AgentLogEntry, AgentStatus, AgentInteraction, LLMProvider } from '../types';
import type { ApplicationRecord } from './JobTracker';
import { useSettings } from '../hooks/useSettings';

interface AgentsProps {
  onBack: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: AgentStatus): string {
  switch (status) {
    case 'running':          return 'var(--gold)';
    case 'completed':        return '#4caf50';
    case 'failed':           return '#f44336';
    case 'stopped':          return '#888';
    case 'review_requested': return '#a78bfa';
    case 'help_requested':   return '#fb923c';
    default:                 return 'var(--text-muted)';
  }
}

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const color = statusColor(status);
  const cfg: Record<AgentStatus, { Icon: typeof Clock; label: string }> = {
    pending: { Icon: Clock, label: 'Pending' },
    running: { Icon: Zap, label: 'Running' },
    completed: { Icon: Check, label: 'Completed' },
    failed: { Icon: X, label: 'Failed' },
    stopped: { Icon: Square, label: 'Stopped' },
    review_requested: { Icon: Eye, label: 'Review required' },
    help_requested: { Icon: LifeBuoy, label: 'Help requested' },
  };
  const { Icon, label } = cfg[status] ?? { Icon: Clock, label: status };
  return (
    <span className="agent-status-badge agent-status-badge--row" style={{ color }}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {label}
    </span>
  );
}

function LogEntry({ entry }: { entry: AgentLogEntry }) {
  const color = entry.level === 'error' ? '#f44' : entry.level === 'warn' ? '#f5a623' : '#aaa';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  return (
    <div className="agent-log-entry">
      <span className="agent-log-time">{time}</span>
      <span className="agent-log-msg" style={{ color }}>{entry.message}</span>
    </div>
  );
}

// ── Interaction Dialog ────────────────────────────────────────────────────────

function InteractionDialog({
  agentId,
  interaction,
  screenshot,
  onRespond,
}: {
  agentId: string;
  interaction: AgentInteraction;
  screenshot: string | null;
  onRespond: (agentId: string, response: string) => void;
}) {
  const isReview = interaction.type === 'review';
  const title = isReview ? 'Review Before Submitting' : 'Agent Needs Help';
  const body = isReview
    ? (interaction.message || 'Application form is filled. Please review before submitting.')
    : (interaction.reason || 'The agent encountered an issue and needs your guidance.');

  const formatOption = (opt: string) => {
    switch (opt) {
      case 'approve_submit':    return 'Approve & Submit';
      case 'cancel':            return 'Cancel';
      case 'skip_and_continue': return 'Skip & Continue';
      case 'retry':             return 'Retry';
      default:                  return opt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  };

  const optionColor = (opt: string) => {
    if (opt === 'approve_submit') return 'var(--gold)';
    if (opt === 'cancel') return '#f87171';
    return 'var(--text)';
  };

  return (
    <div className="agent-detail-overlay">
      <div className="interaction-dialog" onClick={e => e.stopPropagation()}>
        <div className="interaction-dialog-title-row">
          {isReview ? (
            <Eye size={22} strokeWidth={1.75} className="interaction-dialog-icon" aria-hidden />
          ) : (
            <LifeBuoy size={22} strokeWidth={1.75} className="interaction-dialog-icon" aria-hidden />
          )}
          <h2 className="interaction-dialog-title">{title}</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>{body}</p>

        {screenshot && (
          <div className="interaction-screenshot">
            <img
              src={`data:image/jpeg;base64,${screenshot}`}
              alt="Browser state"
              style={{ width: '100%', borderRadius: 8, display: 'block' }}
            />
          </div>
        )}

        <div className="interaction-options">
          {interaction.options.map(opt => (
            <button
              key={opt}
              className="interaction-btn"
              style={{ color: optionColor(opt), borderColor: optionColor(opt) === 'var(--text)' ? 'var(--border)' : optionColor(opt) }}
              onClick={() => onRespond(agentId, opt)}
            >
              {formatOption(opt)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Model Check Badge ─────────────────────────────────────────────────────────

function ModelCheckBadge({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <span
      className="model-check-badge model-check-badge--row"
      style={{ background: value ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', color: value ? 'var(--success)' : 'var(--danger)' }}
    >
      {value ? <Check size={13} strokeWidth={2} aria-hidden /> : <X size={13} strokeWidth={2} aria-hidden />}
      {label}
    </span>
  );
}

// ── Agent Card (compact view) ─────────────────────────────────────────────────

function AgentCard({
  agent,
  onSelect,
  onStop,
  onDelete,
  onRespond,
}: {
  agent: Agent;
  onSelect: () => void;
  onStop: () => void;
  onDelete: () => void;
  onRespond: (agentId: string, response: string) => void;
}) {
  const needsInteraction = agent.status === 'review_requested' || agent.status === 'help_requested';
  return (
    <div className="agent-card" onClick={onSelect} style={{ outline: needsInteraction ? '2px solid var(--gold)' : undefined }}>
      {/* Status indicator */}
      <div className="agent-card-status-bar" style={{ background: statusColor(agent.status) }} />

      <div className="agent-card-body">
        <div className="agent-card-top">
          <div>
            <div className="agent-card-title">{agent.job_title || 'Unknown Role'}</div>
            <div className="agent-card-company">{agent.company || new URL(agent.job_url || 'http://x').hostname}</div>
          </div>
          <AgentStatusBadge status={agent.status} />
        </div>

        {/* Thumbnail screenshot */}
        {agent.screenshot_b64 && (
          <div className="agent-screenshot-thumb">
            <img
              src={`data:image/jpeg;base64,${agent.screenshot_b64}`}
              alt="Browser screenshot"
            />
          </div>
        )}
        {!agent.screenshot_b64 && agent.status === 'running' && (
          <div className="agent-screenshot-placeholder">
            <div className="agent-spinner" />
            <span>Waiting for screenshot…</span>
          </div>
        )}

        {/* Current action */}
        <div className="agent-card-action">{agent.current_action}</div>

        {/* Error */}
        {agent.error && (
          <div className="agent-card-error">{agent.error}</div>
        )}

        {/* Interaction inline prompt */}
        {needsInteraction && agent.interaction_pending && (
          <div
            style={{
              background: 'rgba(245,166,35,0.08)',
              border: '1px solid var(--border-bright)',
              borderRadius: 8,
              padding: '10px 12px',
              marginTop: 8,
              fontSize: 13,
              color: 'var(--gold)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="agent-interaction-heading">
              {agent.status === 'review_requested' ? (
                <>
                  <Eye size={16} strokeWidth={1.75} aria-hidden />
                  Review required
                </>
              ) : (
                <>
                  <LifeBuoy size={16} strokeWidth={1.75} aria-hidden />
                  Help requested
                </>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)', marginBottom: 10, fontSize: 12 }}>
              {agent.interaction_pending.message || agent.interaction_pending.reason}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {agent.interaction_pending.options.map(opt => (
                <button
                  key={opt}
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => onRespond(agent.id, opt)}
                >
                  {opt.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="agent-card-actions" onClick={e => e.stopPropagation()}>
          {agent.status === 'running' && (
            <button className="btn-agent-stop" onClick={onStop}>Stop</button>
          )}
          {agent.status !== 'running' && agent.status !== 'pending'
            && agent.status !== 'review_requested' && agent.status !== 'help_requested' && (
            <button className="btn-agent-delete" onClick={onDelete}>Remove</button>
          )}
          <button type="button" className="btn-agent-view btn-with-icon" onClick={onSelect}>
            View
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agent Detail Panel ────────────────────────────────────────────────────────

function AgentDetailPanel({
  agent,
  onClose,
  onStop,
  onRespond,
}: {
  agent: Agent;
  onClose: () => void;
  onStop: () => void;
  onRespond: (agentId: string, response: string) => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [liveAgent, setLiveAgent] = useState<Agent>(agent);

  // Connect to per-agent WebSocket for live screenshot stream
  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/api/agents/ws/${agent.id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const type = msg.type;
        const data = msg.data;

        if (type === 'snapshot') {
          setLiveAgent(data as Agent);
        } else if (type === 'screenshot') {
          setLiveAgent(prev => ({ ...prev, screenshot_b64: data as string }));
        } else if (type === 'log') {
          setLiveAgent(prev => ({
            ...prev,
            log: [...prev.log, data as AgentLogEntry].slice(-200),
            current_action: (data as AgentLogEntry).message,
          }));
        } else if (type === 'status') {
          setLiveAgent(prev => ({ ...prev, ...data }));
        } else if (type === 'interaction_required') {
          setLiveAgent(prev => ({
            ...prev,
            interaction_pending: data as AgentInteraction,
          }));
        }
      } catch { /* ignore */ }
    };

    // Keep-alive ping
    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 15_000);

    return () => {
      clearInterval(ping);
      ws.close();
    };
  }, [agent.id]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveAgent.log]);

  const needsInteraction = liveAgent.status === 'review_requested' || liveAgent.status === 'help_requested';

  return (
    <div className="agent-detail-overlay" onClick={onClose}>
      <div className="agent-detail-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="agent-detail-header">
          <div>
            <h2 className="agent-detail-title">{liveAgent.job_title || 'Application Agent'}</h2>
            <div className="agent-detail-company">
              {liveAgent.company} ·{' '}
              <a href={liveAgent.job_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
                {new URL(liveAgent.job_url || 'http://x').hostname}
              </a>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 15 }}>
              <AgentStatusBadge status={liveAgent.status} />
            </span>
            {liveAgent.status === 'running' && (
              <button className="btn-agent-stop" onClick={onStop}>Stop Agent</button>
            )}
            <button type="button" className="btn-ghost btn-icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>

        <div className="agent-detail-body">
          {/* Screenshot */}
          <div className="agent-detail-screenshot">
            {liveAgent.screenshot_b64 ? (
              <img
                src={`data:image/jpeg;base64,${liveAgent.screenshot_b64}`}
                alt="Live browser view"
                style={{ width: '100%', borderRadius: 8, display: 'block' }}
              />
            ) : (
              <div className="agent-screenshot-placeholder" style={{ minHeight: 300 }}>
                {liveAgent.status === 'running' ? (
                  <>
                    <div className="agent-spinner" />
                    <span>Loading browser view…</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>No screenshot available</span>
                )}
              </div>
            )}
            {/* Current action overlay */}
            {liveAgent.status === 'running' && (
              <div className="agent-action-overlay">{liveAgent.current_action}</div>
            )}
          </div>

          {/* Log */}
          <div className="agent-detail-log">
            <div className="agent-log-header">Activity Log</div>
            <div className="agent-log-body" ref={logRef}>
              {liveAgent.log.length === 0 && (
                <div className="agent-log-empty">No log entries yet…</div>
              )}
              {liveAgent.log.map((entry, i) => (
                <LogEntry key={i} entry={entry} />
              ))}
            </div>
          </div>
        </div>

        {liveAgent.error && (
          <div className="agent-detail-error">{liveAgent.error}</div>
        )}

        {/* Interaction panel in detail view */}
        {needsInteraction && liveAgent.interaction_pending && (
          <div
            style={{
              margin: '12px 0 0',
              background: 'rgba(245,166,35,0.06)',
              border: '1px solid var(--border-bright)',
              borderRadius: 'var(--radius)',
              padding: '16px 20px',
            }}
          >
            <div className="agent-interaction-heading agent-interaction-heading--detail">
              {liveAgent.status === 'review_requested' ? (
                <>
                  <Eye size={18} strokeWidth={1.75} aria-hidden />
                  Review required
                </>
              ) : (
                <>
                  <LifeBuoy size={18} strokeWidth={1.75} aria-hidden />
                  Help requested
                </>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
              {liveAgent.interaction_pending.message || liveAgent.interaction_pending.reason}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {liveAgent.interaction_pending.options.map(opt => (
                <button
                  key={opt}
                  className="btn-primary"
                  style={{ fontSize: 13 }}
                  onClick={() => onRespond(liveAgent.id, opt)}
                >
                  {opt.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Start Agent Modal ─────────────────────────────────────────────────────────

/** Local inference providers — same base URL field in Settings as Ollama-compatible servers. */
const LOCAL_AGENT_PROVIDERS: LLMProvider[] = ['ollama', 'openclaw', 'lmstudio'];

const LLM_PROVIDERS = ['', 'ollama', 'openclaw', 'lmstudio', 'anthropic', 'openai', 'groq'] as const;
const LLM_PROVIDER_LABELS: Record<string, string> = {
  '': 'Use global settings',
  ollama: 'Ollama (local)',
  openclaw: 'OpenClaw (local)',
  lmstudio: 'LM Studio (local)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  groq: 'Groq',
};

interface ModelCapabilities {
  available: boolean;
  vision: boolean;
  tools: boolean;
  error: string | null;
}

/** Tracker rows suitable for automation: have a URL and are not past the apply step yet. */
function eligibleForAgentFromTracker(apps: ApplicationRecord[]): ApplicationRecord[] {
  return apps.filter(
    a =>
      Boolean(a.job_url?.trim()) &&
      (a.status === 'saved' || a.status === 'applying'),
  );
}

function StartAgentModal({
  onClose,
  onStart,
  savedApplications,
}: {
  onClose: () => void;
  onStart: (
    url: string,
    title: string,
    company: string,
    llmConfig: Record<string, string>,
    applicationId: string | null,
  ) => void;
  savedApplications: ApplicationRecord[];
}) {
  const { settings } = useSettings();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [pickedSavedId, setPickedSavedId] = useState('');
  const [llmProvider, setLlmProvider] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [caps, setCaps] = useState<ModelCapabilities | null>(null);
  const [checkingCaps, setCheckingCaps] = useState(false);

  const globalUsesLocal = LOCAL_AGENT_PROVIDERS.includes(settings.llmProvider);
  const pickingLocal =
    Boolean(llmProvider) && LOCAL_AGENT_PROVIDERS.includes(llmProvider as LLMProvider);
  const replicateLocalFromSettings = pickingLocal && globalUsesLocal;
  const isLocal = pickingLocal;
  const needsApiKey = llmProvider === 'anthropic' || llmProvider === 'openai' || llmProvider === 'groq';

  /** Effective LLM fields sent to the API (local + global local → copy from Settings). */
  const effectiveLlm = (): { provider: string; model: string; api_key: string; base_url: string } => {
    if (!llmProvider) {
      return { provider: '', model: '', api_key: '', base_url: '' };
    }
    if (LOCAL_AGENT_PROVIDERS.includes(llmProvider as LLMProvider)) {
      if (globalUsesLocal) {
        return {
          provider: settings.llmProvider,
          model: settings.llmModel,
          api_key: '',
          base_url: settings.ollamaUrl,
        };
      }
      return {
        provider: llmProvider,
        model: llmModel,
        api_key: '',
        base_url: llmBaseUrl,
      };
    }
    return {
      provider: llmProvider,
      model: llmModel,
      api_key: llmApiKey,
      base_url: '',
    };
  };

  // When overriding with a local provider while global is cloud, default base URL from Settings.
  useEffect(() => {
    if (!pickingLocal || globalUsesLocal) return;
    setLlmBaseUrl(prev => (prev.trim() ? prev : settings.ollamaUrl));
  }, [pickingLocal, globalUsesLocal, llmProvider, settings.ollamaUrl]);

  const checkCaps = async () => {
    const eff = effectiveLlm();
    if (!eff.provider || !eff.model) return;
    setCheckingCaps(true);
    setCaps(null);
    try {
      const params = new URLSearchParams({ provider: eff.provider, model: eff.model });
      if (eff.api_key) params.set('api_key', eff.api_key);
      if (eff.base_url) params.set('base_url', eff.base_url);
      const res = await fetch(`/api/agents/models/check?${params}`);
      const data = await res.json();
      setCaps(data.capabilities as ModelCapabilities);
    } catch {
      setCaps({ available: false, vision: false, tools: false, error: 'Check failed' });
    } finally {
      setCheckingCaps(false);
    }
  };

  const applySavedPick = (id: string) => {
    setPickedSavedId(id);
    if (!id) return;
    const app = savedApplications.find(a => a.id === id);
    if (!app) return;
    setUrl(app.job_url?.trim() || '');
    setTitle(app.job_title?.trim() || '');
    setCompany(app.company_name?.trim() || '');
  };

  const resolvedApplicationId = (): string | null => {
    if (!pickedSavedId) return null;
    const app = savedApplications.find(a => a.id === pickedSavedId);
    if (!app) return null;
    if (url.trim() !== (app.job_url || '').trim()) return null;
    if (title.trim() !== (app.job_title || '').trim()) return null;
    if (company.trim() !== (app.company_name || '').trim()) return null;
    return app.id;
  };

  return (
    <div className="agent-detail-overlay" onClick={onClose}>
      <div className="agent-start-modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 20 }}>Start New Application Agent</h2>

        {savedApplications.length > 0 && (
          <div className="profile-field">
            <label>From saved jobs (Job Tracker)</label>
            <select
              className="config-select"
              value={pickedSavedId}
              onChange={e => applySavedPick(e.target.value)}
              aria-label="Choose a saved job from the tracker"
            >
              <option value="">— Enter manually or pick a saved job —</option>
              {savedApplications.map(app => (
                <option key={app.id} value={app.id}>
                  {app.job_title || 'Untitled'} · {app.company_name || '—'}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
              Jobs in <strong>Saved</strong> or <strong>Applying</strong> with a link appear here.
            </p>
          </div>
        )}

        {/* Job fields */}
        <div className="profile-field">
          <label>Job URL *</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://linkedin.com/jobs/view/..."
            autoFocus
          />
        </div>
        <div className="profile-field">
          <label>Job Title</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Software Engineer" />
        </div>
        <div className="profile-field">
          <label>Company</label>
          <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." />
        </div>

        {/* LLM Config */}
        <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0', paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
            LLM CONFIGURATION (optional)
          </div>
          <div className="profile-field">
            <label>LLM Provider</label>
            <select
              className="config-select"
              value={llmProvider}
              onChange={e => { setLlmProvider(e.target.value); setCaps(null); }}
            >
              {LLM_PROVIDERS.map(p => (
                <option key={p} value={p}>{LLM_PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </div>
          {llmProvider && (
            <>
              {replicateLocalFromSettings && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
                  Local model and base URL match <strong>Settings</strong> ({LLM_PROVIDER_LABELS[settings.llmProvider] ?? settings.llmProvider}).
                  Change provider, model, or URL there to update agents.
                </p>
              )}
              <div className="profile-field">
                <label>Model Name</label>
                {replicateLocalFromSettings ? (
                  <input
                    type="text"
                    value={settings.llmModel}
                    readOnly
                    style={{ opacity: 0.92, cursor: 'default', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                  />
                ) : (
                  <input
                    type="text"
                    value={llmModel}
                    onChange={e => { setLlmModel(e.target.value); setCaps(null); }}
                    placeholder={isLocal ? 'llava:latest' : 'gpt-4o'}
                  />
                )}
              </div>
              {needsApiKey && (
                <div className="profile-field">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={e => setLlmApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
              )}
              {isLocal && !replicateLocalFromSettings && (
                <div className="profile-field">
                  <label>Base URL</label>
                  <input
                    type="url"
                    value={llmBaseUrl}
                    onChange={e => { setLlmBaseUrl(e.target.value); setCaps(null); }}
                    placeholder="http://localhost:11434"
                  />
                </div>
              )}
              {isLocal && replicateLocalFromSettings && (
                <div className="profile-field">
                  <label>Base URL</label>
                  <input
                    type="url"
                    value={settings.ollamaUrl}
                    readOnly
                    placeholder="Empty in Settings — server default URL is used"
                    style={{ opacity: 0.92, cursor: 'default', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                  />
                </div>
              )}
              {(replicateLocalFromSettings ? settings.llmModel : llmModel) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 8 }}>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '4px 12px' }}
                    onClick={checkCaps}
                    disabled={checkingCaps}
                  >
                    {checkingCaps ? 'Checking…' : 'Check Capabilities'}
                  </button>
                  {caps && (
                    <>
                      <ModelCheckBadge label="Vision" value={caps.vision} />
                      <ModelCheckBadge label="Tools" value={caps.tools} />
                      {caps.error && <span style={{ fontSize: 12, color: '#f87171' }}>{caps.error}</span>}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary btn-with-icon"
            disabled={!url.trim()}
            onClick={() => url.trim() && onStart(url.trim(), title, company, (() => {
              const e = effectiveLlm();
              return { provider: e.provider, model: e.model, api_key: e.api_key, base_url: e.base_url };
            })(), resolvedApplicationId())}
          >
            Launch agent
            <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Agents({ onBack }: AgentsProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [savedApplications, setSavedApplications] = useState<ApplicationRecord[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Active interaction dialog (shown globally over any agent needing attention)
  const interactingAgent = agents.find(
    a => (a.status === 'review_requested' || a.status === 'help_requested')
      && a.interaction_pending
  ) || null;

  // ── Fetch initial agent list ─────────────────────────────────────────────

  const fetchAgents = useCallback(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    if (!showStartModal) return;
    fetch('/api/applications')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { applications?: ApplicationRecord[] } | ApplicationRecord[]) => {
        const raw = Array.isArray(d) ? d : (d.applications ?? []);
        setSavedApplications(eligibleForAgentFromTracker(raw));
      })
      .catch(() => setSavedApplications([]));
  }, [showStartModal]);

  // ── Global WebSocket ─────────────────────────────────────────────────────

  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/api/agents/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const { type, data, agent_id } = msg;

        if (type === 'snapshot') {
          setAgents(data as Agent[]);
        } else if (type === 'agent_update') {
          setAgents(prev =>
            prev.map(a => a.id === (data as Agent).id ? { ...a, ...(data as Agent) } : a)
          );
        } else if (type === 'log' && agent_id) {
          setAgents(prev =>
            prev.map(a => a.id === agent_id ? {
              ...a,
              log: [...a.log, data as AgentLogEntry].slice(-200),
              current_action: (data as AgentLogEntry).message,
            } : a)
          );
        } else if (type === 'status' && agent_id) {
          setAgents(prev =>
            prev.map(a => a.id === agent_id ? { ...a, ...data } : a)
          );
        } else if (type === 'interaction_required' && agent_id) {
          setAgents(prev =>
            prev.map(a => a.id === agent_id ? { ...a, interaction_pending: data as AgentInteraction } : a)
          );
        }
      } catch { /* ignore */ }
    };

    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 15_000);

    return () => {
      clearInterval(ping);
      ws.close();
    };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleStart = async (
    url: string,
    title: string,
    company: string,
    llmConfig: Record<string, string>,
    applicationId: string | null,
  ) => {
    setShowStartModal(false);
    setError(null);
    try {
      const res = await fetch('/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_url: url,
          job_title: title,
          company,
          application_id: applicationId ?? undefined,
          llm_provider: llmConfig.provider || '',
          llm_model: llmConfig.model || '',
          llm_api_key: llmConfig.api_key || '',
          llm_base_url: llmConfig.base_url || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || 'Failed to start agent.');
        return;
      }
      setTimeout(fetchAgents, 500);
    } catch {
      setError('Could not connect to backend.');
    }
  };

  const handleStop = async (agentId: string) => {
    await fetch(`/api/agents/${agentId}/stop`, { method: 'POST' });
  };

  const handleDelete = async (agentId: string) => {
    await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    setAgents(prev => prev.filter(a => a.id !== agentId));
    if (selected?.id === agentId) setSelected(null);
  };

  const handleRespond = async (agentId: string, response: string) => {
    try {
      await fetch(`/api/agents/${agentId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      // Clear interaction_pending locally
      setAgents(prev =>
        prev.map(a => a.id === agentId ? { ...a, interaction_pending: null } : a)
      );
    } catch {
      setError('Failed to deliver response to agent.');
    }
  };

  // Stats
  const running   = agents.filter(a => a.status === 'running').length;
  const completed = agents.filter(a => a.status === 'completed').length;
  const failed    = agents.filter(a => a.status === 'failed').length;
  const waiting   = agents.filter(a => a.status === 'review_requested' || a.status === 'help_requested').length;

  return (
    <div className="agents-page">
      {/* ── Header ── */}
      <header className="agents-header">
        <div className="agents-header-left">
          <button type="button" className="btn-ghost btn-with-icon" onClick={onBack}>
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
            Back
          </button>
          <div>
            <h1 className="agents-title">Agent Monitor</h1>
            <p className="agents-subtitle">Real-time view of all application agents</p>
          </div>
        </div>
        <div className="agents-header-right">
          <div className="agents-stats">
            <span className="agent-stat running agent-stat--row">
              <Zap size={14} strokeWidth={1.75} aria-hidden />
              {running} running
            </span>
            <span className="agent-stat completed agent-stat--row">
              <Check size={14} strokeWidth={2} aria-hidden />
              {completed} done
            </span>
            <span className="agent-stat failed agent-stat--row">
              <X size={14} strokeWidth={2} aria-hidden />
              {failed} failed
            </span>
            {waiting > 0 && (
              <span className="agent-stat agent-stat--row agent-stat--wait">
                <Eye size={14} strokeWidth={1.75} aria-hidden />
                {waiting} waiting
              </span>
            )}
          </div>
          <div className={`ws-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
            {wsConnected ? '● Live' : '○ Offline'}
          </div>
          <button type="button" className="btn-primary btn-with-icon" onClick={() => setShowStartModal(true)}>
            <Plus size={18} strokeWidth={1.75} aria-hidden />
            New agent
          </button>
        </div>
      </header>

      {/* ── Error banner ── */}
      {error && (
        <div className="agents-error-banner">
          {error}
          <button type="button" className="btn-ghost btn-icon-btn" onClick={() => setError(null)} style={{ marginLeft: 12 }} aria-label="Dismiss">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      )}

      {/* ── Content ── */}
      {agents.length === 0 ? (
        <div className="agents-empty">
          <div className="agents-empty-icon" aria-hidden>
            <Bot />
          </div>
          <h2>No agents running</h2>
          <p>Start an agent to automatically apply to a job using your saved profile.</p>
          <button type="button" className="btn-primary btn-with-icon" onClick={() => setShowStartModal(true)} style={{ marginTop: 20 }}>
            <Plus size={18} strokeWidth={1.75} aria-hidden />
            Start your first agent
          </button>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={() => setSelected(agent)}
              onStop={() => handleStop(agent.id)}
              onDelete={() => handleDelete(agent.id)}
              onRespond={handleRespond}
            />
          ))}
        </div>
      )}

      {/* ── Detail Panel ── */}
      {selected && (
        <AgentDetailPanel
          agent={selected}
          onClose={() => setSelected(null)}
          onStop={() => handleStop(selected.id)}
          onRespond={handleRespond}
        />
      )}

      {/* ── Global Interaction Dialog (full-screen when no detail panel is open) ── */}
      {!selected && interactingAgent && interactingAgent.interaction_pending && (
        <InteractionDialog
          agentId={interactingAgent.id}
          interaction={interactingAgent.interaction_pending}
          screenshot={
            interactingAgent.interaction_pending.screenshot
              || interactingAgent.screenshot_b64
              || null
          }
          onRespond={handleRespond}
        />
      )}

      {/* ── Start Modal ── */}
      {showStartModal && (
        <StartAgentModal
          onClose={() => setShowStartModal(false)}
          onStart={handleStart}
          savedApplications={savedApplications}
        />
      )}
    </div>
  );
}
