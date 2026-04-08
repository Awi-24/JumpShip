/**
 * JumpShip — User Profile setup page.
 * Data is stored locally (SQLite via backend) and used by the auto-apply agent.
 */
import { useState, useEffect } from 'react';
import { User, Briefcase, GraduationCap, Banknote, Link, PenLine, X, Check, Globe } from 'lucide-react';

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
  linkedin_email?: string;
  linkedin_password?: string;
  custom_answers?: Record<string, string>;
}

interface Props {
  onClose: () => void;
}

const WORK_AUTH_OPTIONS = ['Citizen', 'Permanent Resident', 'Visa Holder', 'Need Sponsorship'];
const WORK_MODE_OPTIONS = ['any', 'remote', 'hybrid', 'on-site'];
const DEGREE_OPTIONS = ["None", "Associate's", "Bachelor's", "Master's", "PhD", "Other"];
const CURRENCY_OPTIONS = ['USD', 'BRL', 'EUR', 'GBP', 'CAD'];

const COMMON_QUESTIONS = [
  'cover_letter',
  'why_this_company',
  'biggest_achievement',
  'where_do_you_see_yourself',
  'notice_period',
  'references',
];

export default function Profile({ onClose }: Props) {
  const [data, setData] = useState<ProfileData>({});
  const [inbox, setInbox] = useState({
    imap_host: '',
    imap_port: 993,
    username: '',
    password: '',
    use_ssl: true,
    active: false,
    poll_minutes: 15,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('identity');

  useEffect(() => {
    Promise.all([
      fetch('/api/profile').then(r => r.ok ? r.json() : null),
      fetch('/api/inbox/config').then(r => r.ok ? r.json() : null),
    ])
      .then(([profile, inboxCfg]) => {
        if (profile) setData(profile);
        if (inboxCfg) {
          setInbox({
            ...inboxCfg,
            password: '', // never returned by backend anyway
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof ProfileData>(key: K, val: ProfileData[K]) =>
    setData(d => ({ ...d, [key]: val }));

  const setAnswer = (key: string, val: string) =>
    setData(d => ({ ...d, custom_answers: { ...(d.custom_answers || {}), [key]: val } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }),
        fetch('/api/inbox/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inbox),
        }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const SECTIONS = [
    { id: 'identity',  label: 'Identity',      Icon: User },
    { id: 'work',      label: 'Work Prefs',    Icon: Briefcase },
    { id: 'education', label: 'Education',     Icon: GraduationCap },
    { id: 'salary',    label: 'Salary',        Icon: Banknote },
    { id: 'linkedin',  label: 'LinkedIn',      Icon: Link },
    { id: 'inbox',     label: 'Email Inbox',   Icon: Globe }, // Reusing Globe icon or finding another
    { id: 'answers',   label: 'Custom Q&A',   Icon: PenLine },
  ];

  if (loading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading profile…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel profile-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>

        <div className="modal-header">
          <div className="modal-title"><User size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />Your Profile</div>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                flex: 1,
                padding: '10px 4px',
                background: 'none',
                border: 'none',
                borderBottom: activeSection === s.id ? '2px solid var(--gold)' : '2px solid transparent',
                color: activeSection === s.id ? 'var(--gold)' : 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <s.Icon size={12} strokeWidth={1.5} />{s.label}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ padding: '24px 28px', maxHeight: '60vh', overflowY: 'auto' }}>

          {/* Identity */}
          {activeSection === 'identity' && (
            <div className="profile-section">
              <Row label="Full Name">
                <input className="config-input" value={data.full_name || ''} onChange={e => set('full_name', e.target.value)} placeholder="Jane Doe" />
              </Row>
              <Row label="Email">
                <input className="config-input" type="email" value={data.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" />
              </Row>
              <Row label="Phone">
                <input className="config-input" value={data.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+55 11 91234-5678" />
              </Row>
              <Row label="LinkedIn URL">
                <input className="config-input" value={data.linkedin_url || ''} onChange={e => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/janedoe" />
              </Row>
              <Row label="GitHub URL">
                <input className="config-input" value={data.github_url || ''} onChange={e => set('github_url', e.target.value)} placeholder="https://github.com/janedoe" />
              </Row>
              <Row label="Portfolio / Website">
                <input className="config-input" value={data.portfolio_url || ''} onChange={e => set('portfolio_url', e.target.value)} placeholder="https://janedoe.dev" />
              </Row>
              <Row label="City">
                <input className="config-input" value={data.location_city || ''} onChange={e => set('location_city', e.target.value)} placeholder="São Paulo" />
              </Row>
              <Row label="State / Province">
                <input className="config-input" value={data.location_state || ''} onChange={e => set('location_state', e.target.value)} placeholder="SP" />
              </Row>
              <Row label="Country">
                <input className="config-input" value={data.location_country || ''} onChange={e => set('location_country', e.target.value)} placeholder="Brazil" />
              </Row>
            </div>
          )}

          {/* Work */}
          {activeSection === 'work' && (
            <div className="profile-section">
              <Row label="Work Authorization">
                <select className="config-input" value={data.work_authorization || ''} onChange={e => set('work_authorization', e.target.value)}>
                  <option value="">— Select —</option>
                  {WORK_AUTH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Willing to Relocate">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={!!data.willing_to_relocate} onChange={e => set('willing_to_relocate', e.target.checked)} />
                  Yes
                </label>
              </Row>
              <Row label="Preferred Work Mode">
                <select className="config-input" value={data.preferred_work_mode || 'any'} onChange={e => set('preferred_work_mode', e.target.value)}>
                  {WORK_MODE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Years of Experience">
                <input className="config-input" type="number" min={0} max={50} value={data.years_experience ?? ''} onChange={e => set('years_experience', Number(e.target.value))} placeholder="5" />
              </Row>
            </div>
          )}

          {/* Education */}
          {activeSection === 'education' && (
            <div className="profile-section">
              <Row label="Highest Degree">
                <select className="config-input" value={data.highest_degree || ''} onChange={e => set('highest_degree', e.target.value)}>
                  <option value="">— Select —</option>
                  {DEGREE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="University / Institution">
                <input className="config-input" value={data.university || ''} onChange={e => set('university', e.target.value)} placeholder="University of São Paulo" />
              </Row>
              <Row label="Graduation Year">
                <input className="config-input" type="number" min={1970} max={2030} value={data.graduation_year ?? ''} onChange={e => set('graduation_year', Number(e.target.value))} placeholder="2022" />
              </Row>
            </div>
          )}

          {/* Salary */}
          {activeSection === 'salary' && (
            <div className="profile-section">
              <Row label="Currency">
                <select className="config-input" value={data.salary_currency || 'USD'} onChange={e => set('salary_currency', e.target.value)}>
                  {CURRENCY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </Row>
              <Row label="Minimum Expected">
                <input className="config-input" type="number" value={data.salary_min ?? ''} onChange={e => set('salary_min', Number(e.target.value))} placeholder="80000" />
              </Row>
              <Row label="Maximum Expected">
                <input className="config-input" type="number" value={data.salary_max ?? ''} onChange={e => set('salary_max', Number(e.target.value))} placeholder="120000" />
              </Row>
            </div>
          )}

          {/* LinkedIn login */}
          {activeSection === 'linkedin' && (
            <div className="profile-section">
              <div className="settings-hint" style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(245,166,35,0.06)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
                ⚠ Credentials are stored only in your local SQLite database and are never sent to any cloud service.
                The auto-apply agent uses them to log into LinkedIn on your machine.
              </div>
              <Row label="LinkedIn Email">
                <input className="config-input" type="email" value={data.linkedin_email || ''} onChange={e => set('linkedin_email', e.target.value)} placeholder="jane@example.com" autoComplete="off" />
              </Row>
              <Row label="LinkedIn Password">
                <input className="config-input" type="password" value={data.linkedin_password || ''} onChange={e => set('linkedin_password', e.target.value)} autoComplete="new-password" />
              </Row>
            </div>
          )}

          {/* Inbox section */}
          {activeSection === 'inbox' && (
            <div className="profile-section">
              <div className="settings-hint" style={{ marginBottom: 16, fontSize: 12 }}>
                Configure your email inbox to allow the AI to track job applications, rejections, and interview requests.
              </div>
              <Row label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={inbox.active} onChange={e => setInbox(i => ({ ...i, active: e.target.checked }))} />
                  Enable automatic background polling
                </label>
              </Row>
              <Row label="IMAP Host">
                <input className="config-input" value={inbox.imap_host} onChange={e => setInbox(i => ({ ...i, imap_host: e.target.value }))} placeholder="imap.gmail.com" />
              </Row>
              <Row label="IMAP Port">
                <input className="config-input" type="number" value={inbox.imap_port} onChange={e => setInbox(i => ({ ...i, imap_port: Number(e.target.value) }))} />
              </Row>
              <Row label="Username / Email">
                <input className="config-input" value={inbox.username} onChange={e => setInbox(i => ({ ...i, username: e.target.value }))} placeholder="user@gmail.com" />
              </Row>
              <Row label="Password / App Key">
                <input className="config-input" type="password" value={inbox.password} onChange={e => setInbox(i => ({ ...i, password: e.target.value }))} placeholder="••••••••••••••••" />
                <div className="settings-hint">Use an "App Password" if you use 2FA (recommended).</div>
              </Row>
              <Row label="Poll Interval (min)">
                <input className="config-input" type="number" min={1} value={inbox.poll_minutes} onChange={e => setInbox(i => ({ ...i, poll_minutes: Number(e.target.value) }))} />
              </Row>
            </div>
          )}

          {/* Custom answers */}
          {activeSection === 'answers' && (
            <div className="profile-section">
              <div className="settings-hint" style={{ marginBottom: 16, fontSize: 12 }}>
                Pre-written answers for common free-text questions. The agent will use these when it encounters matching form fields.
              </div>
              {COMMON_QUESTIONS.map(key => (
                <Row key={key} label={key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}>
                  <textarea
                    className="config-input"
                    style={{ minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
                    value={data.custom_answers?.[key] || ''}
                    onChange={e => setAnswer(key, e.target.value)}
                    placeholder={`Your answer for "${key.replace(/_/g, ' ')}"…`}
                  />
                </Row>
              ))}
            </div>
          )}

        </div>

        <div className="modal-footer">
          <button className="btn-secondary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? <><Check size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Saved</> : 'Save Profile'}
          </button>
        </div>

      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row" style={{ marginBottom: 12 }}>
      <label className="settings-label" style={{ minWidth: 160, fontSize: 12 }}>{label}</label>
      {children}
    </div>
  );
}
