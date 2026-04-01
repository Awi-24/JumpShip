import { useState, useEffect, useCallback } from 'react';
import type { UserProfile, WorkExperience, Education, CustomQA } from '../types';

interface ProfileProps {
  onBack: () => void;
}

const EMPTY_PROFILE: UserProfile = {
  name: '', email: '', phone: '', address: '', city: '', state: '', country: '', zip_code: '',
  linkedin_url: '', github_url: '', portfolio_url: '',
  professional_summary: '', current_title: '', years_experience: 0, skills: [],
  work_experience: [], education: [],
  expected_salary: '', work_authorization: '', willing_to_relocate: false, remote_preference: '',
  cover_letter_template: '', custom_answers: [],
};

const EMPTY_EXP: WorkExperience = {
  company: '', title: '', start_date: '', end_date: '', current: false, description: '', location: '',
};

const EMPTY_EDU: Education = {
  institution: '', degree: '', field: '', start_date: '', end_date: '', gpa: '',
};

const EMPTY_QA: CustomQA = { question: '', answer: '' };

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = 'text', placeholder = '', rows,
}: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; rows?: number;
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="profile-field">
      <label htmlFor={id}>{label}</label>
      {rows ? (
        <textarea
          id={id}
          rows={rows}
          value={String(value)}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={String(value)}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Profile({ onBack }: ProfileProps) {
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [skillInput, setSkillInput] = useState('');

  // Load profile
  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        setProfile({ ...EMPTY_PROFILE, ...data });
        setSkillInput((data.skills || []).join(', '));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = useCallback(<K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setProfile(p => ({ ...p, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Parse skills from comma-separated input
      const skills = skillInput.split(',').map(s => s.trim()).filter(Boolean);
      const payload = { ...profile, skills };
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaved(true);
        setProfile(p => ({ ...p, skills }));
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (e) {
      alert('Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  // ── Work experience helpers ──────────────────────────────────────────────

  const addExp = () => set('work_experience', [...profile.work_experience, { ...EMPTY_EXP }]);
  const removeExp = (i: number) => set('work_experience', profile.work_experience.filter((_, idx) => idx !== i));
  const updateExp = (i: number, key: keyof WorkExperience, val: string | boolean) => {
    const updated = profile.work_experience.map((e, idx) => idx === i ? { ...e, [key]: val } : e);
    set('work_experience', updated);
  };

  // ── Education helpers ────────────────────────────────────────────────────

  const addEdu = () => set('education', [...profile.education, { ...EMPTY_EDU }]);
  const removeEdu = (i: number) => set('education', profile.education.filter((_, idx) => idx !== i));
  const updateEdu = (i: number, key: keyof Education, val: string) => {
    const updated = profile.education.map((e, idx) => idx === i ? { ...e, [key]: val } : e);
    set('education', updated);
  };

  // ── Custom Q&A helpers ───────────────────────────────────────────────────

  const addQA = () => set('custom_answers', [...profile.custom_answers, { ...EMPTY_QA }]);
  const removeQA = (i: number) => set('custom_answers', profile.custom_answers.filter((_, idx) => idx !== i));
  const updateQA = (i: number, key: keyof CustomQA, val: string) => {
    const updated = profile.custom_answers.map((q, idx) => idx === i ? { ...q, [key]: val } : q);
    set('custom_answers', updated);
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-loading">Loading profile…</div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      {/* ── Header ── */}
      <header className="profile-header">
        <div className="profile-header-left">
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <div>
            <h1 className="profile-title">My Profile</h1>
            <p className="profile-subtitle">Agents use this data to auto-fill job applications</p>
          </div>
        </div>
        <button className="btn-primary profile-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Profile'}
        </button>
      </header>

      <div className="profile-body">

        {/* ── Personal Information ── */}
        <section className="profile-section">
          <h2 className="profile-section-title">Personal Information</h2>
          <div className="profile-grid-2">
            <Field label="Full Name" value={profile.name} onChange={v => set('name', v)} placeholder="Jane Doe" />
            <Field label="Email" value={profile.email} onChange={v => set('email', v)} type="email" placeholder="jane@example.com" />
            <Field label="Phone" value={profile.phone} onChange={v => set('phone', v)} type="tel" placeholder="+1 555-000-0000" />
            <Field label="Street Address" value={profile.address} onChange={v => set('address', v)} placeholder="123 Main St" />
            <Field label="City" value={profile.city} onChange={v => set('city', v)} placeholder="San Francisco" />
            <Field label="State / Province" value={profile.state} onChange={v => set('state', v)} placeholder="CA" />
            <Field label="Country" value={profile.country} onChange={v => set('country', v)} placeholder="United States" />
            <Field label="ZIP / Postal Code" value={profile.zip_code} onChange={v => set('zip_code', v)} placeholder="94102" />
          </div>
        </section>

        {/* ── Professional Links ── */}
        <section className="profile-section">
          <h2 className="profile-section-title">Professional Links</h2>
          <div className="profile-grid-2">
            <Field label="LinkedIn URL" value={profile.linkedin_url} onChange={v => set('linkedin_url', v)} placeholder="https://linkedin.com/in/jane" />
            <Field label="GitHub URL" value={profile.github_url} onChange={v => set('github_url', v)} placeholder="https://github.com/jane" />
            <Field label="Portfolio / Website" value={profile.portfolio_url} onChange={v => set('portfolio_url', v)} placeholder="https://jane.dev" />
          </div>
        </section>

        {/* ── Professional Info ── */}
        <section className="profile-section">
          <h2 className="profile-section-title">Professional Info</h2>
          <div className="profile-grid-2">
            <Field label="Current Job Title" value={profile.current_title} onChange={v => set('current_title', v)} placeholder="Senior Software Engineer" />
            <Field label="Years of Experience" value={profile.years_experience} onChange={v => set('years_experience', parseInt(v) || 0)} type="number" />
            <Field label="Expected Salary" value={profile.expected_salary} onChange={v => set('expected_salary', v)} placeholder="$120,000 / year" />
            <div className="profile-field">
              <label htmlFor="work-auth">Work Authorization</label>
              <select
                id="work-auth"
                value={profile.work_authorization}
                onChange={e => set('work_authorization', e.target.value)}
              >
                <option value="">Select…</option>
                <option value="Authorized to work">Authorized to work</option>
                <option value="US Citizen">US Citizen</option>
                <option value="Permanent Resident">Permanent Resident</option>
                <option value="Require Visa Sponsorship">Require Visa Sponsorship</option>
                <option value="EU Citizen">EU Citizen</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="profile-field">
              <label htmlFor="remote-pref">Work Preference</label>
              <select
                id="remote-pref"
                value={profile.remote_preference}
                onChange={e => set('remote_preference', e.target.value)}
              >
                <option value="">Select…</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
                <option value="any">Any</option>
              </select>
            </div>
            <div className="profile-field profile-checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={profile.willing_to_relocate}
                  onChange={e => set('willing_to_relocate', e.target.checked)}
                />
                Willing to relocate
              </label>
            </div>
          </div>
          <div className="profile-field" style={{ marginTop: 16 }}>
            <label>Professional Summary</label>
            <textarea
              rows={4}
              value={profile.professional_summary}
              onChange={e => set('professional_summary', e.target.value)}
              placeholder="Brief professional summary used in application cover letters and questions…"
            />
          </div>
          <div className="profile-field" style={{ marginTop: 16 }}>
            <label>Skills <span className="profile-hint">(comma-separated)</span></label>
            <input
              type="text"
              value={skillInput}
              onChange={e => setSkillInput(e.target.value)}
              placeholder="React, TypeScript, Python, FastAPI, SQL…"
            />
          </div>
        </section>

        {/* ── Work Experience ── */}
        <section className="profile-section">
          <div className="profile-section-header">
            <h2 className="profile-section-title">Work Experience</h2>
            <button className="btn-add" onClick={addExp}>+ Add</button>
          </div>
          {profile.work_experience.length === 0 && (
            <p className="profile-empty">No work experience added yet.</p>
          )}
          {profile.work_experience.map((exp, i) => (
            <div key={i} className="profile-card">
              <button className="profile-card-remove" onClick={() => removeExp(i)} title="Remove">×</button>
              <div className="profile-grid-2">
                <Field label="Company" value={exp.company} onChange={v => updateExp(i, 'company', v)} />
                <Field label="Job Title" value={exp.title} onChange={v => updateExp(i, 'title', v)} />
                <Field label="Start Date" value={exp.start_date} onChange={v => updateExp(i, 'start_date', v)} placeholder="Jan 2020" />
                <div className="profile-field">
                  <label>End Date</label>
                  <input
                    type="text"
                    value={exp.end_date}
                    onChange={e => updateExp(i, 'end_date', e.target.value)}
                    placeholder="Dec 2023"
                    disabled={exp.current}
                  />
                </div>
                <Field label="Location" value={exp.location} onChange={v => updateExp(i, 'location', v)} placeholder="Remote / San Francisco" />
                <div className="profile-field profile-checkbox-field" style={{ marginTop: 24 }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={exp.current}
                      onChange={e => updateExp(i, 'current', e.target.checked)}
                    />
                    Currently working here
                  </label>
                </div>
              </div>
              <div className="profile-field">
                <label>Description / Achievements</label>
                <textarea
                  rows={3}
                  value={exp.description}
                  onChange={e => updateExp(i, 'description', e.target.value)}
                  placeholder="Key responsibilities and achievements…"
                />
              </div>
            </div>
          ))}
        </section>

        {/* ── Education ── */}
        <section className="profile-section">
          <div className="profile-section-header">
            <h2 className="profile-section-title">Education</h2>
            <button className="btn-add" onClick={addEdu}>+ Add</button>
          </div>
          {profile.education.length === 0 && (
            <p className="profile-empty">No education added yet.</p>
          )}
          {profile.education.map((edu, i) => (
            <div key={i} className="profile-card">
              <button className="profile-card-remove" onClick={() => removeEdu(i)} title="Remove">×</button>
              <div className="profile-grid-2">
                <Field label="Institution" value={edu.institution} onChange={v => updateEdu(i, 'institution', v)} placeholder="MIT" />
                <Field label="Degree" value={edu.degree} onChange={v => updateEdu(i, 'degree', v)} placeholder="Bachelor of Science" />
                <Field label="Field of Study" value={edu.field} onChange={v => updateEdu(i, 'field', v)} placeholder="Computer Science" />
                <Field label="GPA" value={edu.gpa} onChange={v => updateEdu(i, 'gpa', v)} placeholder="3.8 / 4.0" />
                <Field label="Start Date" value={edu.start_date} onChange={v => updateEdu(i, 'start_date', v)} placeholder="Sep 2016" />
                <Field label="End Date" value={edu.end_date} onChange={v => updateEdu(i, 'end_date', v)} placeholder="Jun 2020" />
              </div>
            </div>
          ))}
        </section>

        {/* ── Cover Letter Template ── */}
        <section className="profile-section">
          <h2 className="profile-section-title">Cover Letter Template</h2>
          <p className="profile-hint" style={{ marginBottom: 12 }}>
            Used by agents when a cover letter field is detected. You can reference
            the job title and company in it.
          </p>
          <textarea
            rows={8}
            value={profile.cover_letter_template}
            onChange={e => set('cover_letter_template', e.target.value)}
            placeholder="Dear Hiring Manager,&#10;&#10;I am excited to apply for the [Job Title] role at [Company]…"
          />
        </section>

        {/* ── Custom Q&A ── */}
        <section className="profile-section">
          <div className="profile-section-header">
            <h2 className="profile-section-title">Custom Q&amp;A</h2>
            <button className="btn-add" onClick={addQA}>+ Add</button>
          </div>
          <p className="profile-hint" style={{ marginBottom: 12 }}>
            Pre-define answers to common application questions so agents can fill them automatically.
          </p>
          {profile.custom_answers.length === 0 && (
            <p className="profile-empty">No custom answers yet.</p>
          )}
          {profile.custom_answers.map((qa, i) => (
            <div key={i} className="profile-card">
              <button className="profile-card-remove" onClick={() => removeQA(i)} title="Remove">×</button>
              <div className="profile-field">
                <label>Question</label>
                <input
                  type="text"
                  value={qa.question}
                  onChange={e => updateQA(i, 'question', e.target.value)}
                  placeholder="Why do you want to work here?"
                />
              </div>
              <div className="profile-field">
                <label>Answer</label>
                <textarea
                  rows={3}
                  value={qa.answer}
                  onChange={e => updateQA(i, 'answer', e.target.value)}
                  placeholder="Your prepared answer…"
                />
              </div>
            </div>
          ))}
        </section>

        {/* ── Save button (bottom) ── */}
        <div className="profile-footer">
          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 160 }}>
            {saving ? 'Saving…' : saved ? '✓ Profile Saved' : 'Save Profile'}
          </button>
        </div>

      </div>
    </div>
  );
}
