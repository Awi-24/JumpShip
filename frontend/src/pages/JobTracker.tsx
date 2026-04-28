import { useState, useEffect, useCallback, useRef, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, ChevronDown, GripVertical, Plus, X,
  MessageSquare, ExternalLink, Send, Loader2,
  FileDown, Upload, Sparkles,
  Building2, Calendar, BarChart2, FileText, StickyNote,
  Trash2, Bookmark, CheckCircle2, Users, Trophy, XCircle,
  TrendingUp, MoreHorizontal, ArrowRightLeft,
} from 'lucide-react';
import { useSettings } from '../hooks/useSettings';

const RESUME_CACHE_KEY = 'jumpship_resume_cache';

interface JobTrackerProps {
  onBack: () => void;
}

interface AssessmentData {
  match_score: number;
  summary: string;
  strong_points: string[];
  gaps: string[];
  career_suggestions: string[];
  company_insights: string;
  income_range: string;
  is_relevant: boolean;
  job_tags: string[];
  keywords_matched: string[];
  keywords_missing: string[];
  hire_recommendation?: 'strong_yes' | 'yes' | 'borderline' | 'no' | 'strong_no';
}

export interface ApplicationRecord {
  id: string;
  job_id: string | null;
  job_title: string;
  company_name: string;
  job_url: string;
  site: string;
  status: string;
  is_easy_apply: boolean;
  notes: string;
  analysis_id: string | null;
  assessment_data: AssessmentData | null;
  match_score: number | null;
  job_description: string | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STATUS_PIPELINE = ['saved', 'applied', 'interviewing', 'offered', 'rejected'] as const;
type AppStatus = typeof STATUS_PIPELINE[number];

const STATUS_LABELS: Record<AppStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offered: 'Offered',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<AppStatus, string> = {
  saved: '#888888',
  applied: '#60a5fa',
  interviewing: '#a78bfa',
  offered: '#4ade80',
  rejected: '#f87171',
};

const STATUS_ICONS: Record<AppStatus, React.ReactNode> = {
  saved: <Bookmark size={13} />,
  applied: <CheckCircle2 size={13} />,
  interviewing: <Users size={13} />,
  offered: <Trophy size={13} />,
  rejected: <XCircle size={13} />,
};

function scoreColor(score: number | null): string {
  if (score === null) return '#666';
  if (score >= 70) return '#4ade80';
  if (score >= 50) return '#fbbf24';
  return '#f87171';
}

function getCachedResumeText(): string {
  try {
    const raw = localStorage.getItem(RESUME_CACHE_KEY);
    if (!raw) return '';
    return JSON.parse(raw)?.profile?.raw_text ?? '';
  } catch { return ''; }
}

// ── Tracker Score Ring ────────────────────────────────────────────────────────

function TrackerScoreRing({ score, size = 38 }: { score: number | null; size?: number }) {
  const r = (size / 2) - 4;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = score !== null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
      {score !== null && (
        <circle
          cx={cx} cy={cx} r={r} fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }}
        />
      )}
      {score !== null && (
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize={size < 38 ? "7" : "9"} fontWeight="700">
          {score}
        </text>
      )}
    </svg>
  );
}

// ── PortalMenu — anchored dropdown rendered at body level (escapes any clipping) ──

interface PortalMenuProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
}

function PortalMenu({ open, anchorRef, align = 'left', onClose, children }: PortalMenuProps) {
  const [pos, setPos] = useState<{ top: number; left: number; right?: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }
    const r = anchorRef.current.getBoundingClientRect();
    setPos(
      align === 'right'
        ? { top: r.bottom + 4, left: 0, right: window.innerWidth - r.right }
        : { top: r.bottom + 4, left: r.left }
    );
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', handle);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handle);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="portal-menu"
      style={{
        position: 'fixed',
        top: pos.top,
        ...(align === 'right' ? { right: pos.right } : { left: pos.left }),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Interview Panel ───────────────────────────────────────────────────────────

type InterviewStage = 'prep' | 'persona' | 'chat' | 'report';

interface SessionData {
  session_id?: string | null;
  session_context: string;
  persona_name: string;
  persona_bio: string;
  interview_track?: string;
  messages?: ChatMessage[];
  completed?: boolean;
}

interface InterviewReport {
  score: number;
  strengths: string[];
  improvements: string[];
  technical_gaps: string[];
  study_tips: string[];
  next_steps: string[];
}

function InterviewPanel({ app, onClose }: { app: ApplicationRecord; onClose: () => void }) {
  const { settings } = useSettings();

  const getLlmFields = (featureModel?: string) => {
    const keyMap: Record<string, string> = {
      openai: settings.openaiKey, anthropic: settings.anthropicKey,
      groq: settings.groqKey, gemini: settings.geminiKey,
      mistral: settings.mistralKey, deepseek: settings.deepseekKey,
      huggingface: settings.huggingfaceKey, openrouter: settings.openrouterKey,
      cohere: settings.cohereKey,
    };
    return {
      llm_provider: settings.llmProvider,
      llm_model: featureModel || settings.llmModel || undefined,
      llm_api_key: keyMap[settings.llmProvider] || undefined,
      llm_base_url: settings.ollamaUrl || undefined,
    };
  };

  const [stage, setStage] = useState<InterviewStage>('prep');
  const [session, setSession] = useState<SessionData | null>(null);
  const [prepStatus, setPrepStatus] = useState('Researching company and interview process…');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch('/api/interview/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_title: app.job_title,
            company_name: app.company_name,
            job_description: app.job_description || '',
            resume_text: getCachedResumeText(),
            application_id: app.id,
            ...getLlmFields(settings.interviewLlmModel),
          }),
        });
        if (!res.ok) throw new Error(`Init failed: ${res.statusText}`);
        const data: SessionData = await res.json();
        if (!cancelled) {
          setPrepStatus('Building your interviewer persona…');
          await new Promise(r => setTimeout(r, 400));
          setSession(data);
          // Resume path: server returned existing messages
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
            setStage(data.completed ? 'persona' : 'chat');
            // Auto-load existing report if interview was completed
            if (data.completed && data.session_id) {
              try {
                const r = await fetch(`/api/interview/by-application/${app.id}`);
                const d = await r.json();
                if (d.report && !cancelled) setReport(d.report);
              } catch { /* noop */ }
            }
          } else {
            setStage('persona');
          }
        }
      } catch (err) {
        if (!cancelled) setPrepStatus(`Failed to initialize: ${String(err)}`);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [app]);

  const startChat = useCallback(async () => {
    if (!session) return;
    setStage('chat');
    if (messages.length > 0) return;  // Resumed: skip auto-greeting
    setIsLoading(true);
    try {
      const res = await fetch('/api/interview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.session_id, session_context: session.session_context, persona_name: session.persona_name, messages: [], message: '', ...getLlmFields(settings.interviewLlmModel) }),
      });
      const data = await res.json();
      setMessages([{ role: 'assistant', content: data.content }]);
    } catch {
      setMessages([{ role: 'assistant', content: 'Hello! Ready to begin the interview?' }]);
    } finally {
      setIsLoading(false);
    }
  }, [session, messages.length]);

  const sendMessage = useCallback(async () => {
    if (!session || !input.trim() || isLoading) return;
    const text = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/interview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.session_id, session_context: session.session_context, persona_name: session.persona_name, messages, message: text, ...getLlmFields(settings.interviewLlmModel) }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error — please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  }, [session, input, messages, isLoading]);

  const generateReport = useCallback(async () => {
    if (!session?.session_id || messages.length < 4) return;
    setReportLoading(true);
    setStage('report');
    try {
      const res = await fetch('/api/interview/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.session_id, ...getLlmFields(settings.interviewLlmModel) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Report failed: ${res.statusText}`);
      }
      const data = await res.json();
      setReport(data.report);
    } catch (err) {
      setReport({
        score: 0,
        strengths: [],
        improvements: [`Failed to generate report: ${String(err)}`],
        technical_gaps: [],
        study_tips: [],
        next_steps: [],
      });
    } finally {
      setReportLoading(false);
    }
  }, [session, messages.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: 680, maxWidth: '95vw', height: '82vh', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="modal-header" style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageSquare size={17} style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <div className="modal-title" style={{ fontSize: 16 }}>Mock Interview</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                {app.job_title}{app.company_name ? ` · ${app.company_name}` : ''}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Prep */}
        {stage === 'prep' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 40, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Preparing Your Interview</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 340, lineHeight: 1.6 }}>{prepStatus}</div>
          </div>
        )}

        {/* Persona reveal */}
        {stage === 'persona' && session && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '32px 40px', textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: 'var(--btn-on-accent)', boxShadow: '0 8px 24px rgba(245,166,35,0.3)' }}>
              {session.persona_name[0]}
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>{session.persona_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Senior Engineering Manager · {app.company_name || 'the company'}</div>
            </div>
            <div style={{ maxWidth: 460, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px', textAlign: 'left' }}>
              {session.persona_bio}
            </div>
            <button onClick={startChat} className="btn btn-primary">
              <MessageSquare size={15} /> Begin Interview
            </button>
          </div>
        )}

        {/* Chat */}
        {stage === 'chat' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.role === 'assistant' && session && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4, paddingLeft: 2 }}>{session.persona_name}</div>
                  )}
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    background: msg.role === 'user' ? 'var(--gold)' : 'var(--bg3)',
                    border: `1px solid ${msg.role === 'user' ? 'transparent' : 'var(--border)'}`,
                    color: msg.role === 'user' ? 'var(--btn-on-accent)' : 'var(--text)',
                    fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    fontWeight: msg.role === 'user' ? 500 : 400,
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '14px 14px 14px 4px', alignSelf: 'flex-start' }}>
                  {[0, 0.2, 0.4].map((delay, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-muted)', animation: `bounce 1.2s ${delay}s infinite` }} />
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, flexShrink: 0, alignItems: 'flex-end' }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer… (Enter to send, Shift+Enter for new line)"
                rows={2}
                style={{ flex: 1, resize: 'none', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="btn btn-primary btn-icon"
                aria-label="Send message"
              >
                <Send size={15} />
              </button>
              <button
                onClick={generateReport}
                disabled={messages.length < 4 || isLoading}
                className="btn btn-secondary"
                title="End interview and generate performance report"
                aria-label="End interview and generate report"
              >
                <Trophy size={14} /> End & Report
              </button>
            </div>
          </>
        )}

        {/* Report */}
        {stage === 'report' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            {reportLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <Loader2 size={28} className="spin" style={{ color: 'var(--gold)' }} />
                <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Analyzing your interview…</div>
              </div>
            )}
            {report && !reportLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: report.score >= 70 ? '#4ade80' : report.score >= 50 ? '#fbbf24' : '#f87171', color: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800 }}>
                    {report.score}
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Performance Report</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{app.job_title} · {app.company_name}</div>
                  </div>
                </div>

                <ReportSection title="Strengths" color="#4ade80" items={report.strengths} />
                <ReportSection title="Improvements" color="#f87171" items={report.improvements} />
                {report.technical_gaps.length > 0 && (
                  <ReportSection title="Technical Gaps" color="#fbbf24" items={report.technical_gaps} />
                )}
                <ReportSection title="Study Tips" color="#60a5fa" items={report.study_tips} />
                <ReportSection title="Next Steps" color="#a78bfa" items={report.next_steps} />

                <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
                  <button onClick={() => setStage('chat')} className="btn btn-secondary">
                    <MessageSquare size={14} /> Back to Transcript
                  </button>
                  <button onClick={onClose} className="btn btn-primary">
                    <CheckCircle2 size={14} /> Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportSection({ title, color, items }: { title: string; color: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}>
        {items.map((it, i) => (<li key={i} style={{ marginBottom: 4 }}>{it}</li>))}
      </ul>
    </div>
  );
}

// ── Resume Generator Modal ────────────────────────────────────────────────────

function ResumeGeneratorModal({ app, onClose }: { app: ApplicationRecord; onClose: () => void }) {
  const { settings } = useSettings();
  const fileInputId = useId();
  const [resumeText, setResumeText] = useState(getCachedResumeText);

  const getLlmFields = (featureModel?: string) => {
    const keyMap: Record<string, string> = {
      openai: settings.openaiKey, anthropic: settings.anthropicKey,
      groq: settings.groqKey, gemini: settings.geminiKey,
      mistral: settings.mistralKey, deepseek: settings.deepseekKey,
      huggingface: settings.huggingfaceKey, openrouter: settings.openrouterKey,
      cohere: settings.cohereKey,
    };
    return {
      llm_provider: settings.llmProvider,
      llm_model: featureModel || settings.llmModel || undefined,
      llm_api_key: keyMap[settings.llmProvider] || undefined,
      llm_base_url: settings.ollamaUrl || undefined,
    };
  };
  const [customInstructions, setCustomInstructions] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const hasJobDescription = !!app.job_description;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/resume/parse', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Parse failed: ${res.statusText}`);
      const data = await res.json();
      const text = data.raw_text ?? data.profile?.raw_text ?? '';
      if (text) setResumeText(text);
      else setError('Could not extract text from file.');
    } catch (err) {
      setError(String(err));
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!resumeText.trim()) { setError('Resume text is required.'); return; }
    if (!hasJobDescription) { setError('No job description — cannot generate tailored resume.'); return; }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/resume/generate-for-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: app.id, resume_text: resumeText, custom_instructions: customInstructions.trim() || null, extra_context: extraContext.trim() || null, ...getLlmFields(settings.resumeGenLlmModel) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume_${app.company_name}_${app.job_title}.pdf`.replace(/[^\w.-]/g, '_');
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const ta: React.CSSProperties = {
    width: '100%', background: 'var(--bg3)', color: 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '10px 12px', fontSize: 13, fontFamily: 'inherit',
    lineHeight: 1.55, resize: 'vertical', boxSizing: 'border-box',
  };

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 600,
    color: 'var(--text)', marginBottom: 8,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: 660, maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="modal-header" style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileDown size={17} style={{ color: '#60a5fa' }} />
            </div>
            <div>
              <div className="modal-title" style={{ fontSize: 16 }}>Generate Tailored Resume</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                {app.job_title}{app.company_name ? ` · ${app.company_name}` : ''}
                {!hasJobDescription && <span style={{ color: '#f87171', marginLeft: 8 }}>⚠ No job description</span>}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Resume text */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={fieldLabel}>
                Resume Text
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {resumeText ? `${resumeText.length.toLocaleString()} chars` : 'none loaded'}
                </span>
              </label>
              <label
                htmlFor={fileInputId}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: '#60a5fa', padding: '5px 12px', border: '1px solid rgba(96,165,250,0.35)', borderRadius: 8, background: 'rgba(96,165,250,0.06)', opacity: uploadingFile ? 0.5 : 1, transition: 'background 0.15s' }}
              >
                {uploadingFile ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={12} />}
                {uploadingFile ? 'Parsing…' : 'Upload PDF / DOCX'}
              </label>
              <input id={fileInputId} type="file" accept=".pdf,.docx,.doc,.txt" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploadingFile} />
            </div>
            <textarea value={resumeText} onChange={e => setResumeText(e.target.value)} placeholder="Paste your resume text here, or upload a file above…" rows={7} style={ta} />
          </div>

          {/* Custom instructions */}
          <div>
            <label style={fieldLabel}>
              <Sparkles size={13} style={{ verticalAlign: 'middle', marginRight: 6, color: '#a78bfa' }} />
              Custom Instructions
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>optional</span>
            </label>
            <textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder={'e.g. "Emphasize Python and ML experience" · "Move certifications to the top" · "Use stronger action verbs"'} rows={3} style={ta} />
          </div>

          {/* Extra context */}
          <div>
            <label style={fieldLabel}>
              Additional Information
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>optional — new projects, certs, skills not yet on resume</span>
            </label>
            <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)} placeholder={'e.g. "Completed AWS Solutions Architect cert in March 2025" · "Led Kubernetes migration at previous role"'} rows={3} style={ta} />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 'var(--radius)', color: 'var(--error-text)', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isLoading}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={isLoading || !resumeText.trim() || !hasJobDescription}
            style={{ minWidth: 160 }}
          >
            {isLoading
              ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />Generating…</>
              : <><FileDown size={15} />Generate PDF</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Job Modal ─────────────────────────────────────────────────────────────

function AddJobModal({ onClose, onAdd }: { onClose: () => void; onAdd: (job: Partial<ApplicationRecord>) => void }) {
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [status, setStatus] = useState<AppStatus>('saved');
  const [notes, setNotes] = useState('');

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '95vw' }}>
        <div className="modal-header" style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={17} style={{ color: 'var(--gold)' }} />
            </div>
            <div className="modal-title" style={{ fontSize: 16 }}>Add Job to Tracker</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="profile-field"><label>Job Title *</label><input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Software Engineer" autoFocus style={inputStyle} /></div>
          <div className="profile-field"><label>Company</label><input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." style={inputStyle} /></div>
          <div className="profile-field"><label>Job URL</label><input type="url" value={jobUrl} onChange={e => setJobUrl(e.target.value)} placeholder="https://..." style={inputStyle} /></div>
          <div className="profile-field">
            <label>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as AppStatus)} style={{ ...inputStyle }}>
              {STATUS_PIPELINE.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="profile-field">
            <label>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!jobTitle.trim()} onClick={() => { if (jobTitle.trim()) onAdd({ job_title: jobTitle.trim(), company_name: company.trim(), job_url: jobUrl.trim(), status, notes: notes.trim(), site: '', is_easy_apply: false }); }}>
            Add Job
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Draggable Card ────────────────────────────────────────────────────────────

function DraggableCard({
  app, isExpanded, onExpand, onStatusChange, onDelete, onInterview, onGenerateResume, onNotesChange, isDragging,
}: {
  app: ApplicationRecord;
  isExpanded: boolean;
  onExpand: (id: string | null) => void;
  onStatusChange: (id: string, status: AppStatus) => void;
  onDelete: (id: string) => void;
  onInterview: (app: ApplicationRecord) => void;
  onGenerateResume: (app: ApplicationRecord) => void;
  onNotesChange: (id: string, notes: string) => void;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: app.id });
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  const [localNotes, setLocalNotes] = useState(app.notes || '');

  const scoreVal = app.match_score ?? app.assessment_data?.match_score ?? null;
  const color = STATUS_COLORS[app.status as AppStatus] ?? '#888';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const savedDate = app.created_at
    ? new Date(app.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  const handleNotesSave = () => {
    if (localNotes !== app.notes) onNotesChange(app.id, localNotes);
  };

  const toggleExpand = () => onExpand(isExpanded ? null : app.id);

  return (
    <div ref={setNodeRef} style={style} className={`tracker-card${isExpanded ? ' expanded' : ''}`}>
      {/* Colored accent bar */}
      <div style={{ height: 3, background: color }} />

      {/* Card inner */}
      <div className="tracker-card-inner">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button {...attributes} {...listeners} style={{ cursor: 'grab', background: 'none', border: 'none', padding: '2px 0', color: 'var(--text-muted)', flexShrink: 0, marginTop: 9 }} aria-label="Drag">
            <GripVertical size={14} />
          </button>

          <div style={{ flexShrink: 0, marginTop: 2 }}>
            <TrackerScoreRing score={scoreVal} size={isExpanded ? 44 : 38} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tracker-card-title" style={{ fontSize: isExpanded ? 16 : 14 }}>{app.job_title || 'Untitled Role'}</div>
            <div className="tracker-card-company" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Building2 size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
              {app.company_name}
              {app.site && <span style={{ opacity: 0.5 }}>· {app.site}</span>}
            </div>
            {savedDate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', marginTop: 3, opacity: 0.65 }}>
                <Calendar size={10} />
                Saved {savedDate}
              </div>
            )}
          </div>

          <button className={`tracker-card-expand-btn${isExpanded ? ' open' : ''}`} onClick={toggleExpand} style={{ marginTop: 4 }} aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            <ChevronDown size={15} />
          </button>
        </div>

        {/* Tags */}
        {app.assessment_data?.job_tags && app.assessment_data.job_tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {app.assessment_data.job_tags.slice(0, isExpanded ? 8 : 4).map(tag => (
              <span key={tag} className="tracker-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Action row — hierarchy: Apply > Resume > Interview > Move > overflow (Delete) */}
      <div className="tracker-card-actions">
        {app.job_url ? (
          <a
            href={app.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="tracker-action-btn primary"
            style={{ textDecoration: 'none' }}
            aria-label="Open job posting"
          >
            <ExternalLink size={13} /> Apply
          </a>
        ) : null}

        <button className="tracker-action-btn resume" onClick={() => onGenerateResume(app)} aria-label="Generate tailored resume">
          <FileDown size={13} /> Resume
        </button>

        <button className="tracker-action-btn interview" onClick={() => onInterview(app)} aria-label="Start mock interview">
          <MessageSquare size={13} /> Interview
        </button>

        <button
          ref={moveBtnRef}
          type="button"
          className="tracker-action-btn"
          onClick={() => setShowStatusMenu(v => !v)}
          aria-label="Change status"
        >
          <ArrowRightLeft size={12} /> Move <ChevronDown size={12} strokeWidth={1.75} />
        </button>

        <button
          ref={overflowBtnRef}
          type="button"
          className="tracker-action-btn"
          onClick={() => setShowOverflow(v => !v)}
          aria-label="More actions"
          style={{ marginLeft: 'auto' }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      <PortalMenu open={showStatusMenu} anchorRef={moveBtnRef} align="left" onClose={() => setShowStatusMenu(false)}>
        {STATUS_PIPELINE.map(s => (
          <div key={s} className="portal-menu-item" style={{ color: s === app.status ? STATUS_COLORS[s] : 'var(--text)', fontWeight: s === app.status ? 600 : 400 }} onClick={() => { onStatusChange(app.id, s); setShowStatusMenu(false); }}>
            <span style={{ color: STATUS_COLORS[s], display: 'inline-flex' }}>{STATUS_ICONS[s]}</span>
            {STATUS_LABELS[s]}
          </div>
        ))}
      </PortalMenu>

      <PortalMenu open={showOverflow} anchorRef={overflowBtnRef} align="right" onClose={() => setShowOverflow(false)}>
        <div className="portal-menu-item" style={{ color: '#f87171' }} onClick={() => { setShowOverflow(false); onDelete(app.id); }}>
          <Trash2 size={13} /> Delete
        </div>
      </PortalMenu>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            className="tracker-card-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 35 }}
          >
            {/* Scrollable inner — content never overflows the card */}
            <div style={{ maxHeight: '54vh', overflowY: 'auto', padding: '0 14px 14px' }}>
            {/* Assessment */}
            {app.assessment_data && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                  <BarChart2 size={12} style={{ color: '#a78bfa' }} /> Assessment
                </div>
                <div className="tracker-assessment-section">
                  {app.assessment_data.summary && <p style={{ marginBottom: 8, lineHeight: 1.65 }}>{app.assessment_data.summary}</p>}
                  {app.assessment_data.strong_points.length > 0 && (
                    <div style={{ marginBottom: 6, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ color: '#4ade80', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Strong:</span>
                      <span>{app.assessment_data.strong_points.join(' · ')}</span>
                    </div>
                  )}
                  {app.assessment_data.gaps.length > 0 && (
                    <div style={{ marginBottom: 6, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }}>✗ Gaps:</span>
                      <span>{app.assessment_data.gaps.join(' · ')}</span>
                    </div>
                  )}
                  {app.assessment_data.income_range && (
                    <div style={{ marginTop: 6, color: '#fbbf24', fontWeight: 600, fontSize: 12 }}>
                      💰 {app.assessment_data.income_range}
                    </div>
                  )}
                  {app.assessment_data.keywords_matched?.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Keywords matched:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {app.assessment_data.keywords_matched.slice(0, 10).map(k => (
                          <span key={k} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}>{k}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {app.assessment_data.keywords_missing?.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Keywords missing:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {app.assessment_data.keywords_missing.slice(0, 10).map(k => (
                          <span key={k} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>{k}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Job description */}
            {app.job_description && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                  <FileText size={12} style={{ color: '#60a5fa' }} /> Job Description
                </div>
                <div className="tracker-jd-scroll" style={{ maxHeight: 200 }}>{app.job_description}</div>
              </div>
            )}

            {/* Notes */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                <StickyNote size={12} style={{ color: '#fbbf24' }} /> Notes
              </div>
              <textarea
                className="tracker-notes-field"
                value={localNotes}
                onChange={e => setLocalNotes(e.target.value)}
                onBlur={handleNotesSave}
                placeholder="Add notes about this application…"
              />
            </div>
            </div>{/* end scrollable inner */}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  status, apps, expandedCardId, onExpand, onStatusChange, onDelete, onInterview, onGenerateResume, onNotesChange, activeId, colWidth,
}: {
  status: AppStatus;
  apps: ApplicationRecord[];
  expandedCardId: string | null;
  onExpand: (id: string | null) => void;
  onStatusChange: (id: string, s: AppStatus) => void;
  onDelete: (id: string) => void;
  onInterview: (app: ApplicationRecord) => void;
  onGenerateResume: (app: ApplicationRecord) => void;
  onNotesChange: (id: string, notes: string) => void;
  activeId: string | null;
  colWidth: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const color = STATUS_COLORS[status];
  const isThisColumnExpanded = apps.some(a => a.id === expandedCardId);

  return (
    <motion.div
      animate={{ width: colWidth }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }}
      style={{ flexShrink: 0, overflow: 'visible' }}
    >
      <div
        ref={setNodeRef}
        className="pipeline-col"
        style={{
          outline: isOver ? `2px solid ${color}` : undefined,
          transition: 'outline 0.1s',
          width: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Colored top accent */}
        <div style={{ height: 3, background: color, flexShrink: 0 }} />

        {/* Collapsed — slim header, mini card bars */}
        {!isThisColumnExpanded && expandedCardId !== null ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', cursor: 'pointer' }} onClick={() => onExpand(null)} title={`${STATUS_LABELS[status]} — click to restore`}>
            <div className="pipeline-col-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span style={{ color, flexShrink: 0 }}>{STATUS_ICONS[status]}</span>
                <span className="pipeline-col-label" style={{ color, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1, fontSize: 10 }}>{STATUS_LABELS[status]}</span>
                <span className="pipeline-col-badge" style={{ flexShrink: 0 }}>{apps.length}</span>
              </div>
            </div>
            {apps.length > 0 && (
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {apps.map(a => (
                  <div key={a.id} style={{ height: 5, borderRadius: 3, background: color, opacity: 0.35, flexShrink: 0 }} title={a.job_title} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Column header */}
            <div className="pipeline-col-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color }}>{STATUS_ICONS[status]}</span>
                  <span className="pipeline-col-label" style={{ color }}>{STATUS_LABELS[status]}</span>
                </div>
                <span className="pipeline-col-badge">{apps.length}</span>
              </div>
            </div>

            {/* Cards scrollable area */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SortableContext items={apps.map(a => a.id)} strategy={verticalListSortingStrategy}>
                {apps.length === 0 && <div className="pipeline-col-empty">Drop here</div>}
                {apps.map(app => (
                  <DraggableCard
                    key={app.id} app={app}
                    isExpanded={expandedCardId === app.id}
                    onExpand={onExpand}
                    onStatusChange={onStatusChange}
                    onDelete={onDelete}
                    onInterview={onInterview}
                    onGenerateResume={onGenerateResume}
                    onNotesChange={onNotesChange}
                    isDragging={activeId === app.id}
                  />
                ))}
              </SortableContext>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function JobTracker({ onBack }: JobTrackerProps) {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [interviewApp, setInterviewApp] = useState<ApplicationRecord | null>(null);
  const [resumeApp, setResumeApp] = useState<ApplicationRecord | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const fetchApplications = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/applications');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApplications(data.applications || data || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchApplications(); }, [fetchApplications]);

  const handleStatusChange = async (id: string, status: AppStatus) => {
    try {
      await fetch(`/api/applications/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      setApplications(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    } catch { setError('Failed to update status.'); }
  };

  const handleNotesChange = async (id: string, notes: string) => {
    try {
      const app = applications.find(a => a.id === id);
      if (!app) return;
      await fetch(`/api/applications/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: app.status, notes }) });
      setApplications(prev => prev.map(a => a.id === id ? { ...a, notes } : a));
    } catch { setError('Failed to save notes.'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/applications/${id}`, { method: 'DELETE' });
      setApplications(prev => prev.filter(a => a.id !== id));
      if (expandedCardId === id) setExpandedCardId(null);
    } catch { setError('Failed to delete application.'); }
  };

  const handleAddJob = async (job: Partial<ApplicationRecord>) => {
    try {
      const res = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowAddModal(false);
      await fetchApplications();
    } catch { setError('Failed to add job.'); }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setExpandedCardId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const draggedApp = applications.find(a => a.id === active.id);
    if (!draggedApp) return;
    const targetCol = STATUS_PIPELINE.includes(over.id as AppStatus)
      ? (over.id as AppStatus)
      : applications.find(a => a.id === over.id)?.status as AppStatus | undefined;
    if (targetCol && targetCol !== draggedApp.status) await handleStatusChange(draggedApp.id, targetCol);
  };

  const pipelineRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => Math.max(window.innerWidth - 40, 600));

  useEffect(() => {
    const el = pipelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const N = STATUS_PIPELINE.length;
  const COL_GAP = 15;
  const MIN_COLLAPSED = 88;

  const { normalWidth, expandedWidth, collapsedWidth } = useMemo(() => {
    const cw = containerWidth > 0 ? containerWidth : 1400;
    const nw = (cw - (N - 1) * COL_GAP) / N;
    const ew = Math.min(620, cw * 0.48);
    const remaining = cw - ew - (N - 1) * COL_GAP;
    const coll = Math.max(MIN_COLLAPSED, remaining / (N - 1));
    return { normalWidth: nw, expandedWidth: ew, collapsedWidth: coll };
  }, [containerWidth]);

  const activeApp = applications.find(a => a.id === activeId);
  const anyExpanded = expandedCardId !== null;

  const stats = STATUS_PIPELINE.reduce<Record<string, number>>((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length;
    return acc;
  }, {});

  const avgScore = (() => {
    const scored = applications.filter(a => (a.match_score ?? a.assessment_data?.match_score) != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, a) => s + (a.match_score ?? a.assessment_data?.match_score ?? 0), 0) / scored.length);
  })();

  return (
    <div className="job-tracker-page">
      <header className="tracker-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={onBack} className="btn btn-secondary btn-sm">
            <ArrowLeft size={15} strokeWidth={1.75} /> Back
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>
              Job <span style={{ color: 'var(--gold)' }}>Tracker</span>
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              {applications.length} application{applications.length !== 1 ? 's' : ''} · click cards to expand details
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary btn-sm">
          <Plus size={15} strokeWidth={2} /> Add Job
        </button>
      </header>

      {/* Stats bar */}
      <div className="tracker-stats" style={{ flexWrap: 'wrap', gap: 8 }}>
        {STATUS_PIPELINE.map(s => (
          <div key={s} className="tracker-stat-pill" style={{ borderColor: stats[s] > 0 ? `${STATUS_COLORS[s]}33` : undefined }}>
            <span style={{ color: STATUS_COLORS[s] }}>{STATUS_ICONS[s]}</span>
            <span className="pill-count" style={{ color: stats[s] > 0 ? STATUS_COLORS[s] : 'var(--text-muted)' }}>{stats[s]}</span>
            <span>{STATUS_LABELS[s]}</span>
          </div>
        ))}
        {avgScore !== null && (
          <div className="tracker-avg-score" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={13} />
            {avgScore} avg score
          </div>
        )}
      </div>

      {error && (
        <div className="tracker-error-banner">
          {error}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setError(null)} style={{ marginLeft: 12 }} aria-label="Dismiss">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', opacity: 0.4 }} />
          Loading applications…
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="tracker-pipeline" ref={pipelineRef} style={{ gap: COL_GAP }}>
            {STATUS_PIPELINE.map(col => {
              const isThisColExpanded = applications.some(a => a.id === expandedCardId && a.status === col);
              const colWidth = anyExpanded
                ? (isThisColExpanded ? expandedWidth : collapsedWidth)
                : normalWidth;
              return (
                <KanbanColumn
                  key={col} status={col}
                  apps={applications.filter(a => a.status === col)}
                  expandedCardId={expandedCardId}
                  onExpand={setExpandedCardId}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onInterview={setInterviewApp}
                  onGenerateResume={setResumeApp}
                  onNotesChange={handleNotesChange}
                  activeId={activeId}
                  colWidth={colWidth}
                />
              );
            })}
          </div>
          <DragOverlay>
            {activeApp ? (
              <div className="tracker-card" style={{ opacity: 0.9, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', cursor: 'grabbing', width: 300 }}>
                <div style={{ height: 3, background: STATUS_COLORS[activeApp.status as AppStatus] ?? '#888' }} />
                <div className="tracker-card-inner">
                  <div className="tracker-card-title">{activeApp.job_title}</div>
                  <div className="tracker-card-company">{activeApp.company_name}</div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {showAddModal && <AddJobModal onClose={() => setShowAddModal(false)} onAdd={handleAddJob} />}
      {interviewApp && <InterviewPanel app={interviewApp} onClose={() => setInterviewApp(null)} />}
      {resumeApp && <ResumeGeneratorModal app={resumeApp} onClose={() => setResumeApp(null)} />}
    </div>
  );
}

