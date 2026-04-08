import { useState, useCallback } from 'react';
import { FileText, CheckCircle, Bot } from 'lucide-react';
import type { ResumeProfile } from '../types';

interface ResumeUploadProps {
  profile: ResumeProfile | null;
  isLoading: boolean;
  isScouting?: boolean;
  onUpload: (file: File) => void;
  onScout?: () => void;
}

export default function ResumeUpload({ profile, isLoading, isScouting, onUpload, onScout }: ResumeUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');

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
          <span style={{ fontSize: 13 }}>Parsing resume with LLM...</span>
        </div>
      </div>
    );
  }

  if (profile) {
    return (
      <div className="resume-loaded">
        <div className="resume-name"><CheckCircle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{fileName || 'resume.pdf'}</div>
        <div
          className="resume-profile"
          style={{ marginBottom: 8, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}
        >
          {profile.title}
        </div>
        <div className="resume-profile" style={{ marginBottom: 10 }}>
          Profile identified · Keywords extracted
        </div>
        <div style={{ marginBottom: 12 }}>
          {profile.skills.map((s) => (
            <span key={s} className="profile-chip">{s}</span>
          ))}
        </div>
        {onScout && (
          <button
            className="btn-primary"
            onClick={onScout}
            disabled={isScouting}
            style={{ width: '100%', padding: '8px 0', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {isScouting ? (
              <><div className="spinner" style={{ width: 12, height: 12 }} /> Scouting...</>
            ) : (
              <><Bot size={14} /> Launch Scout Agent</>
            )}
          </button>
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
