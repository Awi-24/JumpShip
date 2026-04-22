import { useState, useCallback } from 'react';
import { FileText, CheckCircle, ChevronDown, ChevronUp, Search, Briefcase, Tag } from 'lucide-react';
import type { ResumeProfile } from '../types';

interface ResumeUploadProps {
  profile: ResumeProfile | null;
  isLoading: boolean;
  onUpload: (file: File) => void;
  fileName?: string;
  cached?: boolean;
}

export default function ResumeUpload({ profile, isLoading, onUpload, fileName: externalFileName, cached }: ResumeUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(externalFileName ?? '');
  const [expanded, setExpanded] = useState(false);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setFileName(file.name);
      onUpload(file);
    },
    [onUpload]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  if (isLoading) {
    return (
      <div className="resume-loaded">
        <div className="assessment-loading">
          <div className="spinner" />
          <span style={{ fontSize: 13 }}>Parsing resume…</span>
        </div>
      </div>
    );
  }

  if (profile) {
    const hasKeywords = profile.suggested_keywords?.length > 0;
    const hasTitles = profile.suggested_titles?.length > 0;
    const hasData = hasKeywords || hasTitles || profile.skills?.length > 0;

    return (
      <div className="resume-loaded">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div className="resume-name" style={{ flex: 1, marginBottom: 0 }}>
            <CheckCircle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {externalFileName || fileName || 'resume.pdf'}
            {cached && (
              <span style={{
                marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.3)',
                color: 'var(--gold)', verticalAlign: 'middle', letterSpacing: '0.04em',
              }}>cached</span>
            )}
          </div>
          {hasData && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 11, padding: '2px 4px'
              }}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'hide' : 'inspect'}
            </button>
          )}
        </div>

        <div className="resume-profile" style={{ marginBottom: 4, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}>
          {profile.title || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Title not detected</span>}
        </div>

        {profile.experience_years > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {profile.experience_years}y experience
            {profile.domains?.length > 0 && ` · ${profile.domains.slice(0, 2).join(', ')}`}
          </div>
        )}

        {/* Skills */}
        {profile.skills?.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {profile.skills.map((s) => (
              <span key={s} className="profile-chip">{s}</span>
            ))}
          </div>
        )}

        {/* Expandable detail panel */}
        {expanded && (
          <div style={{
            marginTop: 8,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8,
            fontSize: 12,
          }}>
            {/* Suggested keywords → go into search bar */}
            {hasKeywords && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, color: 'var(--text-muted)', fontSize: 11 }}>
                  <Search size={11} />
                  <span>Search keywords ({profile.suggested_keywords.length})</span>
                </div>
                <div>
                  {profile.suggested_keywords.map(k => (
                    <span key={k} style={{
                      display: 'inline-block', marginRight: 4, marginBottom: 3,
                      padding: '2px 7px', borderRadius: 4,
                      background: 'rgba(74,222,128,0.08)',
                      border: '1px solid rgba(74,222,128,0.2)',
                      color: '#4ade80', fontSize: 11,
                    }}>{k}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested job titles */}
            {hasTitles && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, color: 'var(--text-muted)', fontSize: 11 }}>
                  <Briefcase size={11} />
                  <span>Target job titles</span>
                </div>
                <div>
                  {profile.suggested_titles.map(t => (
                    <span key={t} style={{
                      display: 'inline-block', marginRight: 4, marginBottom: 3,
                      padding: '2px 7px', borderRadius: 4,
                      background: 'rgba(168,85,247,0.08)',
                      border: '1px solid rgba(168,85,247,0.2)',
                      color: '#a855f7', fontSize: 11,
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* If nothing was extracted */}
            {!hasKeywords && !hasTitles && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Tag size={11} />
                No keywords extracted. LLM may have returned invalid JSON. Check backend logs.
              </div>
            )}
          </div>
        )}

        {/* Hint about what feeds the search */}
        {hasKeywords && !expanded && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {profile.suggested_keywords.length} search keywords ready · click <em>inspect</em> to verify
          </div>
        )}
        {!hasKeywords && (
          <div style={{ fontSize: 10, color: '#f87171', marginTop: 2 }}>
            ⚠ No keywords extracted. LLM parsing may have failed
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`upload-zone ${dragging ? 'dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
    >
      <input
        type="file"
        accept=".pdf,.docx"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <span className="upload-icon"><FileText size={28} strokeWidth={1.5} /></span>
      <div className="upload-title">Drop your resume</div>
      <div className="upload-sub">PDF or DOCX · Parsed locally</div>
    </div>
  );
}
