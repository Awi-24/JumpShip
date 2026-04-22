import { useState, useEffect, useCallback } from 'react';
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
import { ArrowLeft, ChevronDown, GripVertical, Plus, X } from 'lucide-react';

interface JobTrackerProps {
  onBack: () => void;
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
            placeholder="Any notes..." rows={3}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary" disabled={!jobTitle.trim()}
            onClick={() => { if (!jobTitle.trim()) return; onAdd({ job_title: jobTitle.trim(), company_name: company.trim(), job_url: jobUrl.trim(), status, notes: notes.trim(), site: '', is_easy_apply: false }); }}
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
  app, onStatusChange, onDelete, isDragging = false,
}: {
  app: ApplicationRecord;
  onStatusChange: (id: string, status: AppStatus) => void;
  onDelete: (id: string) => void;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: app.id });
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const date = app.applied_at || app.created_at;
  const dateStr = date ? new Date(date).toLocaleDateString() : '';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="tracker-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <button
          {...attributes} {...listeners}
          style={{ cursor: 'grab', background: 'none', border: 'none', padding: '2px 0', color: 'var(--text-muted)', flexShrink: 0 }}
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tracker-card-title">{app.job_title || 'Untitled Role'}</div>
          <div className="tracker-card-company" style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 6 }}>
            {app.company_name}
          </div>
          {app.notes && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>
              {app.notes.slice(0, 80)}{app.notes.length > 80 ? '…' : ''}
            </div>
          )}
          {dateStr && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{dateStr}</div>}
          <div className="tracker-card-actions">
            <div style={{ position: 'relative' }}>
              <button
                type="button" className="btn-secondary btn-with-icon"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setShowStatusMenu(v => !v)}
              >
                Move <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
              </button>
              {showStatusMenu && (
                <div
                  style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
                  onMouseLeave={() => setShowStatusMenu(false)}
                >
                  {STATUS_PIPELINE.map(s => (
                    <div
                      key={s}
                      style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: s === app.status ? 'var(--gold)' : 'var(--text)' }}
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
                href={app.job_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                Open listing
              </a>
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
      </div>
    </div>
  );
}

// ── Droppable Column ──────────────────────────────────────────────────────────

function KanbanColumn({
  status, apps, onStatusChange, onDelete, activeId,
}: {
  status: AppStatus;
  apps: ApplicationRecord[];
  onStatusChange: (id: string, s: AppStatus) => void;
  onDelete: (id: string) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className="pipeline-col"
      style={{ outline: isOver ? `2px solid ${STATUS_COLORS[status]}` : undefined, borderRadius: 'var(--radius)' }}
    >
      <div className="pipeline-col-title" style={{ color: STATUS_COLORS[status] }}>
        {STATUS_LABELS[status]}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>{apps.length}</span>
      </div>
      <SortableContext items={apps.map(a => a.id)} strategy={verticalListSortingStrategy}>
        {apps.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
            Drop here
          </div>
        )}
        {apps.map(app => (
          <DraggableCard
            key={app.id} app={app}
            onStatusChange={onStatusChange} onDelete={onDelete}
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

  // ── dnd-kit drag handlers ─────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const draggedApp = applications.find(a => a.id === active.id);
    if (!draggedApp) return;

    // over.id can be a column id (AppStatus) or a card id — resolve to a column
    const targetCol = STATUS_PIPELINE.includes(over.id as AppStatus)
      ? (over.id as AppStatus)
      : applications.find(a => a.id === over.id)?.status as AppStatus | undefined;

    if (targetCol && targetCol !== draggedApp.status) {
      await handleStatusChange(draggedApp.id, targetCol);
    }
  };

  const activeApp = applications.find(a => a.id === activeId);
  const stats = STATUS_PIPELINE.reduce<Record<string, number>>((acc, s) => {
    acc[s] = applications.filter(a => a.status === s).length;
    return acc;
  }, {});

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
              Drag cards between columns or use the Move menu
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary btn-with-icon" onClick={() => setShowAddModal(true)}>
          <Plus size={18} strokeWidth={1.75} aria-hidden />
          Add job
        </button>
      </header>

      <div className="tracker-stats">
        {STATUS_PIPELINE.map(s => (
          <div key={s} className="tracker-stat-item">
            <span style={{ fontSize: 18, fontWeight: 700, color: STATUS_COLORS[s] }}>{stats[s] || 0}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{STATUS_LABELS[s]}</span>
          </div>
        ))}
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
                activeId={activeId}
              />
            ))}
          </div>
          <DragOverlay>
            {activeApp ? (
              <div className="tracker-card" style={{ opacity: 0.9, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', cursor: 'grabbing' }}>
                <div className="tracker-card-title">{activeApp.job_title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{activeApp.company_name}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {showAddModal && (
        <AddJobModal onClose={() => setShowAddModal(false)} onAdd={handleAddJob} />
      )}
    </div>
  );
}
