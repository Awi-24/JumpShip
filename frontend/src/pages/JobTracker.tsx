import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ChevronDown, Plus, X } from 'lucide-react';
import type { Page } from '../App';

interface JobTrackerProps {
  onBack: () => void;
  onNavigate?: (page: Page) => void;
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
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
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
  applying: 'var(--gold)',
  applied: '#60a5fa',
  interviewing: '#a78bfa',
  offered: '#4ade80',
  rejected: '#f87171',
};

// ── Add Job Modal ─────────────────────────────────────────────────────────────

function AddJobModal({ onClose, onAdd }: { onClose: () => void; onAdd: (job: Partial<ApplicationRecord>) => void }) {
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [status, setStatus] = useState<AppStatus>('saved');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!jobTitle.trim()) return;
    onAdd({
      job_title: jobTitle.trim(),
      company_name: company.trim(),
      job_url: jobUrl.trim(),
      status,
      notes: notes.trim(),
      site: '',
      is_easy_apply: false,
    });
  };

  return (
    <div className="agent-detail-overlay" onClick={onClose}>
      <div className="agent-start-modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 20 }}>Add Job to Tracker</h2>
        <div className="profile-field">
          <label>Job Title *</label>
          <input
            type="text"
            value={jobTitle}
            onChange={e => setJobTitle(e.target.value)}
            placeholder="Software Engineer"
            autoFocus
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
            value={status}
            onChange={e => setStatus(e.target.value as AppStatus)}
            style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', width: '100%' }}
          >
            {STATUS_PIPELINE.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="profile-field">
          <label>Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any notes about this application..."
            rows={3}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!jobTitle.trim()}
            onClick={handleSubmit}
          >
            Add Job
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tracker Card ──────────────────────────────────────────────────────────────

function TrackerCard({
  app,
  onStatusChange,
  onDelete,
  onStartAgent,
}: {
  app: ApplicationRecord;
  onStatusChange: (id: string, status: AppStatus) => void;
  onDelete: (id: string) => void;
  onStartAgent: (app: ApplicationRecord) => void;
}) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const date = app.applied_at || app.created_at;
  const dateStr = date ? new Date(date).toLocaleDateString() : '';

  return (
    <div className="tracker-card">
      <div className="tracker-card-title">{app.job_title || 'Untitled Role'}</div>
      <div className="tracker-card-company" style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 6 }}>
        {app.company_name}
      </div>
      {app.notes && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>
          {app.notes.slice(0, 80)}{app.notes.length > 80 ? '…' : ''}
        </div>
      )}
      {dateStr && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{dateStr}</div>
      )}
      <div className="tracker-card-actions">
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn-secondary btn-with-icon"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setShowStatusMenu(v => !v)}
          >
            Move
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
          </button>
          {showStatusMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 10,
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                minWidth: 140,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}
              onMouseLeave={() => setShowStatusMenu(false)}
            >
              {STATUS_PIPELINE.map(s => (
                <div
                  key={s}
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    color: s === app.status ? 'var(--gold)' : 'var(--text)',
                  }}
                  onClick={() => {
                    onStatusChange(app.id, s);
                    setShowStatusMenu(false);
                  }}
                >
                  {STATUS_LABELS[s]}
                </div>
              ))}
            </div>
          )}
        </div>
        {app.job_url && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => onStartAgent(app)}
          >
            Start Agent
          </button>
        )}
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: '4px 10px', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
          onClick={() => onDelete(app.id)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function JobTracker({ onBack, onNavigate }: JobTrackerProps) {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

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

  const handleStartAgent = async (app: ApplicationRecord) => {
    try {
      await fetch('/api/agents/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_url: app.job_url,
          job_title: app.job_title,
          company: app.company_name,
          application_id: app.id,
        }),
      });
      if (onNavigate) onNavigate('agents');
    } catch {
      setError('Failed to start agent.');
    }
  };

  // Stats
  const stats = STATUS_PIPELINE.reduce<Record<string, number>>((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length;
    return acc;
  }, {});

  return (
    <div className="job-tracker-page">
      {/* Header */}
      <header className="tracker-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button type="button" className="btn-ghost btn-with-icon" onClick={onBack}>
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
            Back
          </button>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Job Tracker</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Track your job applications through the pipeline
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
      </div>

      {/* Error */}
      {error && (
        <div className="agents-error-banner">
          {error}
          <button type="button" className="btn-ghost btn-icon-btn" onClick={() => setError(null)} style={{ marginLeft: 12 }} aria-label="Dismiss">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      )}

      {/* Pipeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading applications…</div>
      ) : (
        <div className="tracker-pipeline">
          {STATUS_PIPELINE.map(col => {
            const colApps = applications.filter(a => a.status === col);
            return (
              <div key={col} className="pipeline-col">
                <div className="pipeline-col-title" style={{ color: STATUS_COLORS[col] }}>
                  {STATUS_LABELS[col]}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>
                    {colApps.length}
                  </span>
                </div>
                {colApps.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                    No jobs
                  </div>
                )}
                {colApps.map(app => (
                  <TrackerCard
                    key={app.id}
                    app={app}
                    onStatusChange={handleStatusChange}
                    onDelete={handleDelete}
                    onStartAgent={handleStartAgent}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddJobModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddJob}
        />
      )}
    </div>
  );
}
