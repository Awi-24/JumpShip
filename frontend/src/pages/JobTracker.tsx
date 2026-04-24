import { useState, useEffect, useCallback, useRef, useId } from 'react';
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
  MessageSquare, ChevronRight, ExternalLink, Send, Loader2,
  FileDown, Upload, Sparkles,
} from 'lucide-react';

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

const STATUS_PIPELINE = ['saved', 'applying', 'applied', 'interviewing', 'offered', 'rejected'] as const;
type AppStatus = typeof STATUS_PIPELINE[number];

const STATUS_LABELS: Record<AppStatus, string> = {
  saved: 'Saved',
  applying: 'Applying',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offered: 'Offered',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<AppStatus, string> = {
  saved: 'var(--text-muted)',
  applying: '#f59e0b',
  applied: '#60a5fa',
  interviewing: '#a78bfa',
  offered: '#4ade80',
  rejected: '#f87171',
};

function scoreColor(score: number | null): string {
  if (score === null) return '#666';
  if (score >= 70) return '#4ade80';
  if (score >= 50) return '#fbbf24';
  return '#f87171';
}

// ── Score Badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color = scoreColor(score);
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      border: `2px solid ${color}`, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 11, fontWeight: 700, color,
      background: `${color}18`,
    }}>
      {score}
    </div>
  );
}

// ── Interview Modal ───────────────────────────────────────────────────────────

function InterviewModal({
  app,
  onClose,
}: {
  app: ApplicationRecord;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (isLoading) return;

    const userMessages = overrideText === '' ? messages : [...messages, { role: 'user' as const, content: text }];
    if (overrideText !== '') {
      setMessages(userMessages);
      setInput('');
    }
    setIsLoading(true);

    try {
      const res = await fetch('/api/interview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_title: app.job_title,
          company_name: app.company_name,
          job_description: app.job_description || app.assessment_data?.summary || '',
          resume_summary: app.assessment_data
            ? `Match score: ${app.assessment_data.match_score}. Strong points: ${app.assessment_data.strong_points.slice(0, 3).join('; ')}.`
            : '',
          messages: messages,
          message: overrideText !== undefined ? '' : text,
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error — please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, messages, isLoading, app]);

  const startInterview = useCallback(async () => {
    setStarted(true);
    await sendMessage('');
  }, [sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim()) sendMessage();
    }
  };

  return (
    <div className="agent-detail-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="agent-start-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 620, width: '95vw', height: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <MessageSquare size={18} style={{ color: '#a78bfa' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Mock Interview</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              {app.job_title}{app.company_name ? ` · ${app.company_name}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!started && messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <MessageSquare size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ marginBottom: 8, fontSize: 14, color: 'var(--text)' }}>Ready for your mock interview?</p>
              <p style={{ fontSize: 13, marginBottom: 20 }}>
                An AI interviewer will simulate a real interview using the job description
                {app.company_name ? ` and public data about ${app.company_name}` : ''}.
              </p>
              <button className="btn-primary" onClick={startInterview} style={{ gap: 8 }}>
                Start Interview
              </button>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: msg.role === 'user' ? '#a78bfa22' : 'var(--bg3)',
                border: `1px solid ${msg.role === 'user' ? '#a78bfa44' : 'var(--border)'}`,
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--text)',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.role === 'assistant' && (
                  <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600, marginBottom: 4 }}>
                    Interviewer
                  </div>
                )}
                {msg.content}
              </div>
            </div>
          ))}

          {isLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ padding: '10px 14px', borderRadius: '14px 14px 14px 4px', background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {(started || messages.length > 0) && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, flexShrink: 0 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer… (Enter to send, Shift+Enter for new line)"
              rows={2}
              style={{
                flex: 1, resize: 'none', background: 'var(--bg3)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px',
                fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5,
              }}
            />
            <button
              className="btn-primary"
              disabled={!input.trim() || isLoading}
              onClick={() => sendMessage()}
              style={{ alignSelf: 'flex-end', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Resume Generator Modal ────────────────────────────────────────────────────

function ResumeGeneratorModal({
  app,
  onClose,
}: {
  app: ApplicationRecord;
  onClose: () => void;
}) {
  const fileInputId = useId();

  // Load cached resume text
  const cachedResumeText = (() => {
    try {
      const raw = localStorage.getItem(RESUME_CACHE_KEY);
      if (!raw) return '';
      const cache = JSON.parse(raw);
      return cache?.profile?.raw_text ?? '';
    } catch { return ''; }
  })();

  const [resumeText, setResumeText] = useState(cachedResumeText);
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
    if (!hasJobDescription) { setError('This application has no job description. Cannot generate tailored resume.'); return; }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/resume/generate-for-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: app.id,
          resume_text: resumeText,
          custom_instructions: customInstructions.trim() || null,
          extra_context: extraContext.trim() || null,
        }),
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

  const textareaStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg3)', color: 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '8px 12px', fontSize: 12, fontFamily: 'inherit',
    lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box',
  };

  return (
    <div className="agent-detail-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="agent-start-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 680, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <FileDown size={18} style={{ color: '#60a5fa' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Generate Tailored Resume</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              {app.job_title}{app.company_name ? ` · ${app.company_name}` : ''}
              {!hasJobDescription && <span style={{ color: '#f87171', marginLeft: 8 }}>⚠ No job description</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Resume section */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Resume Text
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {resumeText ? `${resumeText.length} chars` : 'none'}
                </span>
              </label>
              <label
                htmlFor={fileInputId}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                  fontSize: 12, color: '#60a5fa', padding: '4px 10px',
                  border: '1px solid rgba(96,165,250,0.3)', borderRadius: 'var(--radius)',
                  opacity: uploadingFile ? 0.5 : 1,
                }}
              >
                {uploadingFile
                  ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Upload size={12} />
                }
                {uploadingFile ? 'Parsing…' : 'Upload PDF/DOCX'}
              </label>
              <input
                id={fileInputId}
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                disabled={uploadingFile}
              />
            </div>
            <textarea
              value={resumeText}
              onChange={e => setResumeText(e.target.value)}
              placeholder="Paste your resume text here, or upload a file above…"
              rows={8}
              style={textareaStyle}
            />
            {!resumeText && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                No cached resume found. Upload a file or paste your resume text.
              </div>
            )}
          </div>

          {/* Custom Instructions */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              <Sparkles size={13} style={{ verticalAlign: 'middle', marginRight: 5, color: '#a78bfa' }} />
              Custom Instructions
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>optional</span>
            </label>
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              placeholder={
                'Tell the AI how to tailor this resume. Examples:\n' +
                '• "Emphasize my Python and ML experience"\n' +
                '• "Move the certifications section to the top"\n' +
                '• "Rewrite bullets to use active verbs and metrics"'
              }
              rows={4}
              style={textareaStyle}
            />
          </div>

          {/* Extra Context */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              Additional Information
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>optional — new projects, certs, skills to include</span>
            </label>
            <textarea
              value={extraContext}
              onChange={e => setExtraContext(e.target.value)}
              placeholder={
                'Add context not in your resume. Examples:\n' +
                '• "I recently completed AWS Solutions Architect certification"\n' +
                '• "I led a migration to Kubernetes in 2024 (not on resume yet)"\n' +
                '• "My GitHub has public contributions to React ecosystem"'
              }
              rows={4}
              style={textareaStyle}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 'var(--radius)', color: 'var(--error-text)', fontSize: 13, marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn-secondary" onClick={onClose} disabled={isLoading}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={isLoading || !resumeText.trim() || !hasJobDescription}
            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160, justifyContent: 'center' }}
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

// ── Assessment Panel ──────────────────────────────────────────────────────────

function AssessmentPanel({ data }: { data: AssessmentData }) {
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 12 }}>
      {data.summary && (
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 6 }}>
          {data.summary}
        </p>
      )}
      {data.strong_points.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#4ade80', fontWeight: 600 }}>Strong: </span>
          <span style={{ color: 'var(--text-muted)' }}>{data.strong_points.slice(0, 2).join(' · ')}</span>
        </div>
      )}
      {data.gaps.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#f87171', fontWeight: 600 }}>Gaps: </span>
          <span style={{ color: 'var(--text-muted)' }}>{data.gaps.slice(0, 2).join(' · ')}</span>
        </div>
      )}
      {data.income_range && (
        <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          💰 {data.income_range}
        </div>
      )}
      {data.job_tags && data.job_tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {data.job_tags.slice(0, 4).map(tag => (
            <span key={tag} style={{
              fontSize: 10, padding: '2px 6px', borderRadius: 4,
              background: 'var(--bg3)', color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}
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

  return (
    <div className="agent-detail-overlay" onClick={onClose}>
      <div className="agent-start-modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 20 }}>Add Job to Tracker</h2>
        <div className="profile-field">
          <label>Job Title *</label>
          <input
            type="text" value={jobTitle}
            onChange={e => setJobTitle(e.target.value)}
            placeholder="Software Engineer" autoFocus
          />
        </div>
        <div className="profile-field">
          <label>Company</label>
          <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Acme Inc." />
        </div>
        <div className="profile-field">
          <label>Job URL</label>
          <input type="url" value={jobUrl} onChange={e => setJobUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="profile-field">
          <label>Status</label>
          <select
            value={status} onChange={e => setStatus(e.target.value as AppStatus)}
            style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', width: '100%' }}
          >
            {STATUS_PIPELINE.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="profile-field">
          <label>Notes</label>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Any notes…" rows={3}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary" disabled={!jobTitle.trim()}
            onClick={() => {
              if (!jobTitle.trim()) return;
              onAdd({ job_title: jobTitle.trim(), company_name: company.trim(), job_url: jobUrl.trim(), status, notes: notes.trim(), site: '', is_easy_apply: false });
            }}
          >
            Add Job
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Draggable Card ────────────────────────────────────────────────────────────

function DraggableCard({
  app, onStatusChange, onDelete, onInterview, onGenerateResume, isDragging,
}: {
  app: ApplicationRecord;
  onStatusChange: (id: string, status: AppStatus) => void;
  onDelete: (id: string) => void;
  onInterview: (app: ApplicationRecord) => void;
  onGenerateResume: (app: ApplicationRecord) => void;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: app.id });
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showAssessment, setShowAssessment] = useState(false);

  const appliedDate = app.applied_at
    ? new Date(app.applied_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const savedDate = app.created_at
    ? new Date(app.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const hasAssessment = !!app.assessment_data;
  const scoreVal = app.match_score ?? app.assessment_data?.match_score ?? null;

  return (
    <div ref={setNodeRef} style={style} className="tracker-card">
      {/* Top row: drag handle + score badge + title */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <button
          {...attributes} {...listeners}
          style={{ cursor: 'grab', background: 'none', border: 'none', padding: '4px 0', color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title + score */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tracker-card-title" style={{ lineHeight: 1.3 }}>
                {app.job_title || 'Untitled Role'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                {app.company_name}
                {app.site && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.6 }}>· {app.site}</span>}
              </div>
            </div>
            <ScoreBadge score={scoreVal} />
          </div>

          {/* Tags */}
          {app.assessment_data?.job_tags && app.assessment_data.job_tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
              {app.assessment_data.job_tags.slice(0, 3).map(tag => (
                <span key={tag} style={{
                  fontSize: 10, padding: '1px 5px', borderRadius: 3,
                  background: 'var(--bg3)', color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Notes */}
          {app.notes && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5, lineHeight: 1.4 }}>
              {app.notes.slice(0, 90)}{app.notes.length > 90 ? '…' : ''}
            </div>
          )}

          {/* Dates */}
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            {appliedDate && (
              <span>Applied <strong style={{ color: 'var(--text)' }}>{appliedDate}</strong></span>
            )}
            {!appliedDate && savedDate && (
              <span>Saved {savedDate}</span>
            )}
            {app.is_easy_apply && (
              <span style={{ color: '#60a5fa' }}>Easy Apply</span>
            )}
          </div>

          {/* Assessment expandable */}
          {hasAssessment && (
            <button
              onClick={() => setShowAssessment(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, marginBottom: 6 }}
            >
              <ChevronRight size={12} style={{ transform: showAssessment ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
              Assessment details
            </button>
          )}
          {showAssessment && app.assessment_data && (
            <AssessmentPanel data={app.assessment_data} />
          )}

          {/* Actions */}
          <div className="tracker-card-actions" style={{ marginTop: 6 }}>
            {/* Move dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                type="button" className="btn-secondary btn-with-icon"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setShowStatusMenu(v => !v)}
              >
                Move <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
              </button>
              {showStatusMenu && (
                <div
                  style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', marginTop: 2 }}
                  onMouseLeave={() => setShowStatusMenu(false)}
                >
                  {STATUS_PIPELINE.map(s => (
                    <div
                      key={s}
                      style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: s === app.status ? STATUS_COLORS[s] : 'var(--text)' }}
                      onClick={() => { onStatusChange(app.id, s); setShowStatusMenu(false); }}
                    >
                      {STATUS_LABELS[s]}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {app.job_url && (
              <a
                href={app.job_url} target="_blank" rel="noopener noreferrer"
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <ExternalLink size={11} /> Open
              </a>
            )}

            {/* Interview button */}
            {(app.job_description || app.assessment_data) && (
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.3)' }}
                onClick={() => onInterview(app)}
              >
                <MessageSquare size={11} /> Interview
              </button>
            )}

            {/* Generate resume button */}
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4, color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)' }}
              onClick={() => onGenerateResume(app)}
              title={app.job_description ? 'Generate tailored resume' : 'No job description — resume can still be generated with custom instructions'}
            >
              <FileDown size={11} /> Resume
            </button>

            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px', color: '#f87171', borderColor: 'rgba(248,113,113,0.25)' }}
              onClick={() => onDelete(app.id)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Droppable Column ──────────────────────────────────────────────────────────

function KanbanColumn({
  status, apps, onStatusChange, onDelete, onInterview, onGenerateResume, activeId,
}: {
  status: AppStatus;
  apps: ApplicationRecord[];
  onStatusChange: (id: string, s: AppStatus) => void;
  onDelete: (id: string) => void;
  onInterview: (app: ApplicationRecord) => void;
  onGenerateResume: (app: ApplicationRecord) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const color = STATUS_COLORS[status];

  return (
    <div
      ref={setNodeRef}
      className="pipeline-col"
      style={{
        outline: isOver ? `2px solid ${color}` : undefined,
        borderRadius: 'var(--radius)',
        transition: 'outline 0.1s',
      }}
    >
      <div className="pipeline-col-title" style={{ color }}>
        {STATUS_LABELS[status]}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>
          {apps.length}
        </span>
      </div>
      <SortableContext items={apps.map(a => a.id)} strategy={verticalListSortingStrategy}>
        {apps.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', opacity: 0.5 }}>
            Drop here
          </div>
        )}
        {apps.map(app => (
          <DraggableCard
            key={app.id} app={app}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onInterview={onInterview}
            onGenerateResume={onGenerateResume}
            isDragging={activeId === app.id}
          />
        ))}
      </SortableContext>
    </div>
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

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
      await fetch(`/api/applications/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setApplications(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    } catch {
      setError('Failed to update status.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/applications/${id}`, { method: 'DELETE' });
      setApplications(prev => prev.filter(a => a.id !== id));
    } catch {
      setError('Failed to delete application.');
    }
  };

  const handleAddJob = async (job: Partial<ApplicationRecord>) => {
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowAddModal(false);
      await fetchApplications();
    } catch {
      setError('Failed to add job.');
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
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

    if (targetCol && targetCol !== draggedApp.status) {
      await handleStatusChange(draggedApp.id, targetCol);
    }
  };

  const activeApp = applications.find(a => a.id === activeId);

  // Stats
  const stats = STATUS_PIPELINE.reduce<Record<string, number>>((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length;
    return acc;
  }, {});
  const avgScore = (() => {
    const scored = applications.filter(a => (a.match_score ?? a.assessment_data?.match_score) !== undefined && (a.match_score ?? a.assessment_data?.match_score) !== null);
    if (!scored.length) return null;
    const sum = scored.reduce((s, a) => s + (a.match_score ?? a.assessment_data?.match_score ?? 0), 0);
    return Math.round(sum / scored.length);
  })();

  return (
    <div className="job-tracker-page">
      <header className="tracker-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button type="button" className="btn-ghost btn-with-icon" onClick={onBack}>
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
            Back
          </button>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Job Tracker</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Drag cards between columns · click a card for assessment details · start a mock interview
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary btn-with-icon" onClick={() => setShowAddModal(true)}>
          <Plus size={18} strokeWidth={1.75} aria-hidden />
          Add job
        </button>
      </header>

      {/* Stats bar */}
      <div className="tracker-stats">
        {STATUS_PIPELINE.map(s => (
          <div key={s} className="tracker-stat-item">
            <span style={{ fontSize: 18, fontWeight: 700, color: STATUS_COLORS[s] }}>{stats[s] || 0}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{STATUS_LABELS[s]}</span>
          </div>
        ))}
        {avgScore !== null && (
          <div className="tracker-stat-item" style={{ borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor(avgScore) }}>{avgScore}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Avg Score</span>
          </div>
        )}
      </div>

      {error && (
        <div className="tracker-error-banner">
          {error}
          <button type="button" className="btn-ghost btn-icon-btn" onClick={() => setError(null)} style={{ marginLeft: 12 }} aria-label="Dismiss">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading applications…</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="tracker-pipeline">
            {STATUS_PIPELINE.map(col => (
              <KanbanColumn
                key={col} status={col}
                apps={applications.filter(a => a.status === col)}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onInterview={setInterviewApp}
                onGenerateResume={setResumeApp}
                activeId={activeId}
              />
            ))}
          </div>
          <DragOverlay>
            {activeApp ? (
              <div className="tracker-card" style={{ opacity: 0.9, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', cursor: 'grabbing' }}>
                <div className="tracker-card-title">{activeApp.job_title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{activeApp.company_name}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {showAddModal && (
        <AddJobModal onClose={() => setShowAddModal(false)} onAdd={handleAddJob} />
      )}

      {interviewApp && (
        <InterviewModal app={interviewApp} onClose={() => setInterviewApp(null)} />
      )}

      {resumeApp && (
        <ResumeGeneratorModal app={resumeApp} onClose={() => setResumeApp(null)} />
      )}
    </div>
  );
}
