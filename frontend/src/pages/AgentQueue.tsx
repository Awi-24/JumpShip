/**
 * JumpShip — Agent Queue panel.
 *
 * Connects to the backend SSE stream (/api/auto-apply/stream) and renders
 * live task cards with trace timelines. Includes model picker that
 * auto-discovers local providers.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Clock, Zap, CheckCircle, Eye, XCircle, Minus,
  Building2, Leaf, Settings2, Building, Calendar,
  Star, Briefcase, Globe, Bot, Play, Pause, X,
  Brain, Wrench, AlertTriangle, ChevronDown, Cpu,
  MessageSquare, Camera, MousePointer, FileUp,
} from 'lucide-react';
import type { DiscoverResponse, DiscoveredProvider, TraceEvent } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────────

interface AgentTask {
  id:          string;
  job_url:     string;
  job_title:   string;
  company:     string;
  platform:    string;
  dry_run:     boolean;
  status:      'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'needs_review';
  message:     string;
  error:       string;
  fields_count: number;
  queued_at:   string;
  started_at:  string | null;
  finished_at: string | null;
}

interface QueueState {
  paused:      boolean;
  running:     boolean;
  max_workers: number;
  active:      number;
  queued:      number;
  done:        number;
  failed:      number;
  tasks:       AgentTask[];
}

interface Props {
  onOpenProfile: () => void;
}

function LinkedInIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  queued:       '#888880',
  running:      '#F5A623',
  success:      '#4ade80',
  needs_review: '#60a5fa',
  failed:       '#f87171',
  cancelled:    '#555',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued:       <Clock size={14} />,
  running:      <Zap size={14} />,
  success:      <CheckCircle size={14} />,
  needs_review: <Eye size={14} />,
  failed:       <XCircle size={14} />,
  cancelled:    <Minus size={14} />,
};

const PLATFORM_ICON: Record<string, React.ReactNode> = {
  linkedin:       <LinkedInIcon size={13} />,
  indeed:         <Briefcase size={13} />,
  greenhouse:     <Leaf size={13} />,
  lever:          <Settings2 size={13} />,
  glassdoor:      <Building size={13} />,
  workday:        <Calendar size={13} />,
  smartrecruiters:<Star size={13} />,
  jobvite:        <Building2 size={13} />,
  generic:        <Globe size={13} />,
};

const TRACE_ICON: Record<string, React.ReactNode> = {
  thinking:     <Brain size={12} />,
  tool_call:    <Wrench size={12} />,
  tool_result:  <CheckCircle size={12} />,
  error:        <XCircle size={12} />,
  human_needed: <AlertTriangle size={12} />,
  status:       <MessageSquare size={12} />,
};

const TOOL_ICON: Record<string, React.ReactNode> = {
  read_page:          <Eye size={11} />,
  fill_field:         <Wrench size={11} />,
  click_button:       <MousePointer size={11} />,
  upload_file:        <FileUp size={11} />,
  select_option:      <ChevronDown size={11} />,
  generate_answer:    <Brain size={11} />,
  research_company:   <Globe size={11} />,
  take_screenshot:    <Camera size={11} />,
  wait_for_page:      <Clock size={11} />,
  request_human_help: <AlertTriangle size={11} />,
};

function elapsed(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ── Model Picker ──────────────────────────────────────────────────────────────────

type ReadyState = 'idle' | 'checking' | 'ready' | 'warning' | 'error';
interface ReadinessInfo { state: ReadyState; message: string; latency?: number }

function ModelPicker() {
  const [discovery, setDiscovery] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessInfo>({ state: 'idle', message: '' });
  const ref = useRef<HTMLDivElement>(null);

  const fetchModels = useCallback(() => {
    setLoading(true);
    fetch('/api/models/discover')
      .then(r => r.json())
      .then((data: DiscoverResponse) => {
        setDiscovery(data);
        if (data.active_provider) setActiveProvider(data.active_provider);
        if (data.active_model) setActiveModel(data.active_model);
      })
      .catch(() => setDiscovery(null))
      .finally(() => setLoading(false));
  }, []);

  const checkReadiness = useCallback(() => {
    setReadiness({ state: 'checking', message: 'Testing tool-calling…' });
    fetch('/api/models/check-ready')
      .then(r => r.json())
      .then(data => {
        if (data.ready && data.warning) {
          setReadiness({
            state: 'warning',
            message: data.warning,
            latency: data.latency_ms,
          });
        } else if (data.ready) {
          setReadiness({
            state: 'ready',
            message: `Ready (${data.latency_ms}ms)`,
            latency: data.latency_ms,
          });
        } else {
          setReadiness({
            state: 'error',
            message: data.error || 'Model not ready',
          });
        }
      })
      .catch(() => setReadiness({ state: 'error', message: 'Connection failed' }));
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectModel = (provider: DiscoveredProvider, modelId: string) => {
    setActiveProvider(provider.id);
    setActiveModel(modelId);
    setReadiness({ state: 'idle', message: '' });
    setOpen(false);
    fetch('/api/auto-apply/llm-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: provider.id,
        model: modelId,
        base_url: provider.base_url,
      }),
    }).then(() => {
      setReadiness({ state: 'checking', message: 'Testing tool-calling…' });
      return fetch('/api/models/check-ready');
    }).then(r => r.json()).then(data => {
      if (data.ready && data.warning) {
        setReadiness({ state: 'warning', message: data.warning, latency: data.latency_ms });
      } else if (data.ready) {
        setReadiness({ state: 'ready', message: `Ready (${data.latency_ms}ms)`, latency: data.latency_ms });
      } else {
        setReadiness({ state: 'error', message: data.error || 'Model not ready' });
      }
    }).catch(() => setReadiness({ state: 'error', message: 'Connection failed' }));
  };

  const reachableProviders = discovery?.providers.filter(p => p.reachable) ?? [];
  const hasModels = reachableProviders.some(p => p.models.length > 0);
  const displayName = activeModel
    ? `${activeModel}`
    : loading ? 'Scanning…' : 'No model';

  const readyDotClass = readiness.state === 'ready' ? 'reachable'
    : readiness.state === 'warning' ? 'warning'
    : readiness.state === 'error' ? 'error'
    : readiness.state === 'checking' ? 'checking'
    : hasModels ? 'reachable' : '';

  return (
    <div className="aq-model-picker" ref={ref}>
      <button
        className="aq-model-btn"
        onClick={() => setOpen(o => !o)}
        title={readiness.message || 'Select agent LLM model'}
      >
        <Cpu size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        <span className={`aq-model-dot ${readyDotClass}`} />
        <span className="aq-model-name">{displayName}</span>
        <ChevronDown size={10} style={{ marginLeft: 3, opacity: 0.5 }} />
      </button>

      {open && (
        <div className="aq-model-dropdown">
          <div className="aq-model-dropdown-header">
            <span>Agent Model</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {activeModel && (
                <button
                  className="aq-model-refresh"
                  onClick={checkReadiness}
                  title="Test model readiness"
                  disabled={readiness.state === 'checking'}
                >
                  {readiness.state === 'checking'
                    ? <span className="spinner" style={{ width: 10, height: 10 }} />
                    : '✓'}
                </button>
              )}
              <button className="aq-model-refresh" onClick={fetchModels} title="Re-scan">
                {loading ? <span className="spinner" style={{ width: 10, height: 10 }} /> : '↻'}
              </button>
            </div>
          </div>

          {readiness.state !== 'idle' && (
            <div className={`aq-model-readiness aq-readiness-${readiness.state}`}>
              {readiness.state === 'checking' && (
                <><span className="spinner" style={{ width: 10, height: 10, marginRight: 6 }} />Testing tool-calling…</>
              )}
              {readiness.state === 'ready' && (
                <><CheckCircle size={11} style={{ marginRight: 5, color: '#4ade80' }} />{readiness.message}</>
              )}
              {readiness.state === 'warning' && (
                <><AlertTriangle size={11} style={{ marginRight: 5, color: '#F5A623' }} />{readiness.message}</>
              )}
              {readiness.state === 'error' && (
                <><XCircle size={11} style={{ marginRight: 5, color: '#f87171' }} />{readiness.message}</>
              )}
            </div>
          )}

          {reachableProviders.length === 0 && !loading && (
            <div className="aq-model-empty">
              No local LLM providers found.<br />
              Start Ollama or LM Studio to use agents.
            </div>
          )}

          {reachableProviders.map(provider => (
            <div key={provider.id} className="aq-model-group">
              <div className="aq-model-group-label">
                <span className={`aq-model-dot ${provider.reachable ? 'reachable' : ''}`} />
                {provider.name}
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                  {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
                </span>
              </div>
              {provider.models.map(model => (
                <button
                  key={model.id}
                  className={`aq-model-option ${activeProvider === provider.id && activeModel === model.id ? 'active' : ''}`}
                  onClick={() => selectModel(provider, model.id)}
                >
                  <span className="aq-model-option-name">{model.name}</span>
                  {model.size_gb && (
                    <span className="aq-model-option-size">{model.size_gb} GB</span>
                  )}
                  {model.family && (
                    <span className="aq-model-option-family">{model.family}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────────

export default function AgentQueue({ onOpenProfile }: Props) {
  const [state, setState] = useState<QueueState>({
    paused: false, running: false, max_workers: 2,
    active: 0, queued: 0, done: 0, failed: 0, tasks: [],
  });
  const [connected, setConnected] = useState(false);
  const [workers, setWorkers] = useState(2);
  const [traceEvents, setTraceEvents] = useState<Record<string, TraceEvent[]>>({});
  const esRef = useRef<EventSource | null>(null);

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    const connect = () => {
      const es = new EventSource('/api/auto-apply/stream');
      esRef.current = es;

      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es.close();
        setTimeout(connect, 3000);
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'ping') return;

          if (event.type === 'init') {
            setState(event.state);
            setWorkers(event.state.max_workers);
            return;
          }

          if (event.type === 'cleared') {
            setState(prev => ({
              ...prev,
              tasks: prev.tasks.filter(t => t.status === 'running' || t.status === 'queued'),
            }));
            setTraceEvents(prev => {
              const next = { ...prev };
              for (const key of Object.keys(next)) {
                if (!state.tasks.some(t => t.id === key && (t.status === 'running' || t.status === 'queued'))) {
                  delete next[key];
                }
              }
              return next;
            });
            return;
          }

          if (event.type === 'paused') {
            setState(prev => ({ ...prev, paused: true }));
            return;
          }

          if (event.type === 'resumed') {
            setState(prev => ({ ...prev, paused: false }));
            return;
          }

          if (event.type === 'task_added' || event.type === 'task_update') {
            const task: AgentTask = event.task;
            setState(prev => {
              const existing = prev.tasks.findIndex(t => t.id === task.id);
              const tasks = existing >= 0
                ? prev.tasks.map(t => t.id === task.id ? task : t)
                : [task, ...prev.tasks];
              return {
                ...prev,
                tasks,
                active:  tasks.filter(t => t.status === 'running').length,
                queued:  tasks.filter(t => t.status === 'queued').length,
                done:    tasks.filter(t => t.status === 'success' || t.status === 'needs_review').length,
                failed:  tasks.filter(t => t.status === 'failed').length,
              };
            });
            return;
          }

          if (event.type === 'trace_event') {
            const traceEvt: TraceEvent = event.event;
            const taskId = event.task_id;
            setTraceEvents(prev => ({
              ...prev,
              [taskId]: [...(prev[taskId] || []), traceEvt],
            }));
            return;
          }
        } catch { /* ignore parse errors */ }
      };
    };

    connect();
    return () => { esRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controls ────────────────────────────────────────────────────────────────
  const post = useCallback((url: string, body?: object) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                 body: body ? JSON.stringify(body) : undefined }), []);

  const handlePause  = () => post('/api/auto-apply/pause');
  const handleResume = () => post('/api/auto-apply/resume');
  const handleClear  = () => post('/api/auto-apply/queue/clear');
  const handleCancel = (id: string) =>
    fetch(`/api/auto-apply/queue/${id}`, { method: 'DELETE' });
  const handleSetWorkers = (n: number) => {
    setWorkers(n);
    post('/api/auto-apply/workers', { count: n });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const { tasks, paused } = state;
  const hasCompleted = tasks.some(t =>
    ['success', 'failed', 'cancelled', 'needs_review'].includes(t.status));

  return (
    <div className="agent-queue">

      {/* Header bar */}
      <div className="agent-queue-header">
        <div className="agent-queue-title">
          <Bot size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />Agent Queue
          <span className={`sse-dot ${connected ? 'connected' : ''}`}
                title={connected ? 'Live' : 'Reconnecting…'} />
        </div>

        <div className="agent-queue-stats">
          {state.active > 0 && (
            <span className="aq-stat running"><Zap size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{state.active} running</span>
          )}
          {state.queued > 0 && (
            <span className="aq-stat queued"><Clock size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{state.queued} queued</span>
          )}
          {state.done > 0 && (
            <span className="aq-stat done"><CheckCircle size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{state.done} done</span>
          )}
          {state.failed > 0 && (
            <span className="aq-stat failed"><XCircle size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{state.failed} failed</span>
          )}
        </div>

        <div className="agent-queue-controls">
          <ModelPicker />

          <div className="aq-workers">
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Workers: {workers}
            </span>
            <input
              type="range" min={1} max={5} value={workers}
              onChange={e => handleSetWorkers(Number(e.target.value))}
              style={{ width: 80, accentColor: 'var(--gold)' }}
            />
          </div>

          {hasCompleted && (
            <button className="aq-btn" onClick={handleClear} title="Remove completed tasks">
              Clear done
            </button>
          )}

          {paused
            ? <button className="aq-btn aq-btn-gold" onClick={handleResume}><Play size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Resume</button>
            : <button className="aq-btn" onClick={handlePause} disabled={state.active === 0 && state.queued === 0}><Pause size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Pause</button>
          }
        </div>
      </div>

      {/* Empty state */}
      {tasks.length === 0 && (
        <div className="agent-queue-empty">
          <div style={{ marginBottom: 12, color: 'var(--text-muted)' }}><Bot size={36} strokeWidth={1.2} /></div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No agents running</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 340, lineHeight: 1.6 }}>
            Click <strong><Zap size={11} style={{ verticalAlign: 'middle' }} /> Auto Apply</strong> on any job card to add it to the queue.
            Agents will fill application forms automatically based on your{' '}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer',
                       padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}
              onClick={onOpenProfile}
            >
              Profile
            </button>.
          </div>
          <div className="agent-queue-tips">
            <div className="aq-tip"><Leaf size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Greenhouse and <Settings2 size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />Lever forms are filled automatically</div>
            <div className="aq-tip">
              <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><LinkedInIcon size={11} /></span>
              LinkedIn Easy Apply works when credentials are saved in Profile
            </div>
            <div className="aq-tip"><Eye size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Dry Run fills the form but doesn't submit — review before going live</div>
            <div className="aq-tip"><Zap size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Increase Workers (up to 5) to apply to multiple jobs in parallel</div>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length > 0 && (
        <div className="agent-task-list">
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              trace={traceEvents[task.id] || []}
              onCancel={() => handleCancel(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────────

function TaskCard({ task, trace, onCancel }: { task: AgentTask; trace: TraceEvent[]; onCancel: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLORS[task.status] ?? '#888';
  const icon  = STATUS_ICON[task.status]  ?? <Globe size={14} />;
  const pIcon = PLATFORM_ICON[task.platform] ?? <Globe size={13} />;
  const isActive = task.status === 'running';

  return (
    <div className={`agent-task-card ${task.status}`}
         style={{ borderLeftColor: color }}>

      {/* Card header */}
      <div className="atc-header" onClick={() => setExpanded(e => !e)}>
        <span className="atc-status-icon" style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>

        <div className="atc-info">
          <div className="atc-title" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{pIcon}</span>{task.job_title || task.company || task.job_url.slice(0, 50)}
          </div>
          {task.company && task.job_title && (
            <div className="atc-company">{task.company}</div>
          )}
          <div className="atc-message" style={{ color: isActive ? 'var(--gold)' : 'var(--text-muted)' }}>
            {isActive && <span className="spinner" style={{ width: 9, height: 9, marginRight: 5, display: 'inline-block' }} />}
            {task.message || task.status}
          </div>
        </div>

        <div className="atc-meta">
          {task.dry_run && <span className="aq-badge dry-run">dry run</span>}
          {trace.length > 0 && (
            <span className="aq-badge trace-badge">
              <Brain size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              {trace.length} steps
            </span>
          )}
          <span className="aq-elapsed">
            {task.started_at ? elapsed(task.started_at, task.finished_at) : ''}
          </span>
          {(task.status === 'queued' || task.status === 'running') && (
            <button className="aq-cancel-btn"
                    onClick={e => { e.stopPropagation(); onCancel(); }}
                    title={task.status === 'running' ? 'Stop agent' : 'Remove from queue'}>
              <X size={11} />
              {task.status === 'running' && <span style={{ fontSize: 9, marginLeft: 2 }}>Stop</span>}
            </button>
          )}
          <span className="atc-expand">{expanded ? '▴' : '▾'}</span>
        </div>
      </div>

      {/* Expanded details with trace timeline */}
      {expanded && (
        <div className="atc-body">
          <div className="atc-detail-row">
            <span className="atc-detail-label">URL</span>
            <a href={task.job_url} target="_blank" rel="noopener noreferrer"
               className="atc-detail-val link" style={{ fontSize: 11 }}>
              {task.job_url.slice(0, 80)}{task.job_url.length > 80 ? '…' : ''}
            </a>
          </div>
          <div className="atc-detail-row">
            <span className="atc-detail-label">Platform</span>
            <span className="atc-detail-val" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{pIcon} {task.platform}</span>
          </div>
          <div className="atc-detail-row">
            <span className="atc-detail-label">Status</span>
            <span className="atc-detail-val" style={{ color }}>{task.status}</span>
          </div>
          {task.fields_count > 0 && (
            <div className="atc-detail-row">
              <span className="atc-detail-label">Fields filled</span>
              <span className="atc-detail-val">{task.fields_count}</span>
            </div>
          )}
          {task.error && (
            <div className="atc-error">{task.error}</div>
          )}
          {task.started_at && (
            <div className="atc-detail-row">
              <span className="atc-detail-label">Duration</span>
              <span className="atc-detail-val">{elapsed(task.started_at, task.finished_at)}</span>
            </div>
          )}
          {task.status === 'needs_review' && (
            <div className="atc-review-hint">
              <Eye size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />Form was filled but not submitted — open the job URL to review and submit manually.
            </div>
          )}

          {/* Trace Timeline */}
          {trace.length > 0 && (
            <TraceTimeline events={trace} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Trace Timeline ───────────────────────────────────────────────────────────────

function TraceTimeline({ events }: { events: TraceEvent[] }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="trace-timeline">
      <div className="trace-timeline-header">
        <Brain size={12} style={{ marginRight: 5 }} />
        Agent Trace — {events.length} events
      </div>
      <div className="trace-timeline-list">
        {events.map((evt, i) => {
          const isExpanded = expandedSteps.has(evt.id || String(i));
          const evtIcon = TRACE_ICON[evt.event_type] ?? <MessageSquare size={12} />;
          const toolIcon = evt.content.tool ? (TOOL_ICON[evt.content.tool] ?? <Wrench size={11} />) : null;

          return (
            <div
              key={evt.id || i}
              className={`trace-event trace-event--${evt.event_type}`}
              onClick={() => toggle(evt.id || String(i))}
            >
              <div className="trace-event-header">
                <span className="trace-event-icon">{evtIcon}</span>
                <span className="trace-event-type">{evt.event_type.replace('_', ' ')}</span>
                {evt.content.tool && (
                  <span className="trace-event-tool">
                    {toolIcon}
                    <span>{evt.content.tool.replace('_', ' ')}</span>
                  </span>
                )}
                {evt.content.duration_ms != null && (
                  <span className="trace-event-duration">{evt.content.duration_ms}ms</span>
                )}
                <span className="trace-event-step">#{evt.step}</span>
              </div>

              {evt.content.summary && !isExpanded && (
                <div className="trace-event-summary">{evt.content.summary}</div>
              )}

              {isExpanded && (
                <div className="trace-event-detail">
                  {evt.content.reasoning && (
                    <div className="trace-thinking-bubble">
                      <Brain size={10} style={{ marginRight: 4, flexShrink: 0 }} />
                      <span>{evt.content.reasoning}</span>
                    </div>
                  )}
                  {evt.content.args && (
                    <div className="trace-args">
                      <span className="trace-args-label">Args:</span>
                      <code>{JSON.stringify(evt.content.args, null, 2)}</code>
                    </div>
                  )}
                  {evt.content.result && (
                    <div className="trace-result">
                      <span className="trace-result-label">Result:</span>
                      <span>{evt.content.result.slice(0, 300)}{evt.content.result.length > 300 ? '…' : ''}</span>
                    </div>
                  )}
                  {evt.content.error && (
                    <div className="trace-error-detail">{evt.content.error}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
