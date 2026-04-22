import { useState, useEffect } from 'react';
import { User, Briefcase, GraduationCap, Banknote, FileText, X, Check, Trash2 } from 'lucide-react';
import { useResumeCache } from '../hooks/useResumeCache';

interface ProfileData {
  full_name?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  github_url?: string;
  portfolio_url?: string;
  location_city?: string;
  location_state?: string;
  location_country?: string;
  work_authorization?: string;
  willing_to_relocate?: boolean;
  preferred_work_mode?: string;
  years_experience?: number;
  highest_degree?: string;
  university?: string;
  graduation_year?: number;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
}

interface Props { onClose: () => void; }

const WORK_AUTH_OPTIONS = ['Citizen', 'Permanent Resident', 'Visa Holder', 'Need Sponsorship'];
const WORK_MODE_OPTIONS = ['any', 'remote', 'hybrid', 'on-site'];
const DEGREE_OPTIONS = ["None", "Associate's", "Bachelor's", "Master's", "PhD", "Other"];
const CURRENCY_OPTIONS = ['BRL', 'USD', 'EUR', 'GBP'];

export default function Profile({ onClose }: Props) {
  const [data, setData] = useState<ProfileData>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('identity');
  const { cache, clearResume } = useResumeCache();

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(p => { if (p) setData(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof ProfileData>(key: K, val: ProfileData[K]) =>
    setData(d => ({ ...d, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const SECTIONS = [
    { id: 'resume',    label: 'Resume',      Icon: FileText },
    { id: 'identity',  label: 'Identity',    Icon: User },
    { id: 'work',      label: 'Work Prefs',  Icon: Briefcase },
    { id: 'education', label: 'Education',   Icon: GraduationCap },
    { id: 'salary',    label: 'Salary',      Icon: Banknote },
  ];

  if (loading) return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>

        <div className="modal-header">
          <div className="modal-title"><User size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />Profile</div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
              flex: 1, padding: '10px 4px', background: 'none', border: 'none',
              borderBottom: activeSection === s.id ? '2px solid var(--gold)' : '2px solid transparent',
              color: activeSection === s.id ? 'var(--gold)' : 'var(--text-muted)',
              fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 4, whiteSpace: 'nowrap',
            }}>
              <s.Icon size={12} strokeWidth={1.5} />{s.label}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ padding: '24px 28px', maxHeight: '60vh', overflowY: 'auto' }}>

          {/* ── Resume cache ── */}
          {activeSection === 'resume' && (
            <div className="profile-section">
              {cache ? (
                <>
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, marginBottom: 16,
                    background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                          <FileText size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                          {cache.fileName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                          Saved {new Date(cache.savedAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                        </div>
                        {cache.profile.title && (
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                            {cache.profile.title}
                          </div>
                        )}
                        {cache.profile.experience_years > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                            {cache.profile.experience_years}y exp
                            {cache.profile.domains?.length ? ` · ${cache.profile.domains.slice(0,2).join(', ')}` : ''}
                          </div>
                        )}
                        <div style={{ marginBottom: 8 }}>
                          {cache.profile.skills?.slice(0, 10).map(s => (
                            <span key={s} className="profile-chip">{s}</span>
                          ))}
                        </div>
                        {cache.keywords.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {cache.keywords.length} keywords saved · auto-filled on next visit
                          </div>
                        )}
                      </div>
                      <button
                        onClick={clearResume}
                        title="Clear cached resume"
                        style={{
                          background: 'none', border: '1px solid rgba(248,113,113,0.3)',
                          borderRadius: 6, color: '#f87171', cursor: 'pointer',
                          padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <Trash2 size={11} />Clear
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Your resume data is stored locally in the browser. Keywords and profile are restored automatically when you open JumpShip, with no re-upload needed.
                    <br /><br />
                    To update: drop a new PDF in the résumé section. It will replace this cache.
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  <FileText size={32} strokeWidth={1} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <div style={{ marginBottom: 8 }}>No resume cached yet</div>
                  <div style={{ fontSize: 11 }}>Upload a PDF or DOCX in the main search panel; it will be saved automatically.</div>
                </div>
              )}
            </div>
          )}

          {/* ── Identity ── */}
          {activeSection === 'identity' && (
            <div className="profile-section">
              <Row label="Full Name"><input className="config-input" value={data.full_name || ''} onChange={e => set('full_name', e.target.value)} placeholder="Jane Doe" /></Row>
              <Row label="Email"><input className="config-input" type="email" value={data.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" /></Row>
              <Row label="Phone"><input className="config-input" value={data.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+55 11 91234-5678" /></Row>
              <Row label="LinkedIn"><input className="config-input" value={data.linkedin_url || ''} onChange={e => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/janedoe" /></Row>
              <Row label="GitHub"><input className="config-input" value={data.github_url || ''} onChange={e => set('github_url', e.target.value)} placeholder="https://github.com/janedoe" /></Row>
              <Row label="Portfolio"><input className="config-input" value={data.portfolio_url || ''} onChange={e => set('portfolio_url', e.target.value)} placeholder="https://janedoe.dev" /></Row>
              <Row label="City"><input className="config-input" value={data.location_city || ''} onChange={e => set('location_city', e.target.value)} placeholder="São Paulo" /></Row>
              <Row label="State"><input className="config-input" value={data.location_state || ''} onChange={e => set('location_state', e.target.value)} placeholder="SP" /></Row>
              <Row label="Country"><input className="config-input" value={data.location_country || ''} onChange={e => set('location_country', e.target.value)} placeholder="Brasil" /></Row>
            </div>
          )}

          {/* ── Work prefs ── */}
          {activeSection === 'work' && (
            <div className="profile-section">
              <Row label="Work Authorization">
                <select className="config-input" value={data.work_authorization || ''} onChange={e => set('work_authorization', e.target.value)}>
                  <option value="">Select…</option>
                  {WORK_AUTH_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Willing to Relocate">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={!!data.willing_to_relocate} onChange={e => set('willing_to_relocate', e.target.checked)} />Yes
                </label>
              </Row>
              <Row label="Preferred Mode">
                <select className="config-input" value={data.preferred_work_mode || 'any'} onChange={e => set('preferred_work_mode', e.target.value)}>
                  {WORK_MODE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Years of Experience">
                <input className="config-input" type="number" min={0} max={50} value={data.years_experience ?? ''} onChange={e => set('years_experience', Number(e.target.value))} placeholder="5" />
              </Row>
            </div>
          )}

          {/* ── Education ── */}
          {activeSection === 'education' && (
            <div className="profile-section">
              <Row label="Highest Degree">
                <select className="config-input" value={data.highest_degree || ''} onChange={e => set('highest_degree', e.target.value)}>
                  <option value="">Select…</option>
                  {DEGREE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Institution"><input className="config-input" value={data.university || ''} onChange={e => set('university', e.target.value)} placeholder="USP, Unicamp…" /></Row>
              <Row label="Grad Year"><input className="config-input" type="number" min={1970} max={2030} value={data.graduation_year ?? ''} onChange={e => set('graduation_year', Number(e.target.value))} placeholder="2022" /></Row>
            </div>
          )}

          {/* ── Salary ── */}
          {activeSection === 'salary' && (
            <div className="profile-section">
              <Row label="Currency">
                <select className="config-input" value={data.salary_currency || 'BRL'} onChange={e => set('salary_currency', e.target.value)}>
                  {CURRENCY_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Minimum"><input className="config-input" type="number" value={data.salary_min ?? ''} onChange={e => set('salary_min', Number(e.target.value))} placeholder="8000" /></Row>
              <Row label="Maximum"><input className="config-input" type="number" value={data.salary_max ?? ''} onChange={e => set('salary_max', Number(e.target.value))} placeholder="15000" /></Row>
            </div>
          )}

        </div>

        <div className="modal-footer">
          <button className="btn-secondary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={onClose}>Cancel</button>
          {activeSection !== 'resume' && (
            <button className="btn-primary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : saved ? <><Check size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Saved</> : 'Save Profile'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row" style={{ marginBottom: 12 }}>
      <label className="settings-label" style={{ minWidth: 140, fontSize: 12 }}>{label}</label>
      {children}
    </div>
  );
}
