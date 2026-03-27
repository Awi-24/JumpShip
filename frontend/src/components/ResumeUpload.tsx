import { useState, useCallback } from 'react';
import type { ResumeProfile } from '../types';

interface ResumeUploadProps {
  profile: ResumeProfile | null;
  isLoading: boolean;
  onUpload: (file: File) => void;
}

export default function ResumeUpload({ profile, isLoading, onUpload }: ResumeUploadProps) {
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
        <div className="resume-name">{'\u2713'} {fileName || 'resume.pdf'}</div>
        <div
          className="resume-profile"
          style={{ marginBottom: 8, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}
        >
          {profile.title}
        </div>
        <div className="resume-profile" style={{ marginBottom: 10 }}>
          Profile identified · Keywords extracted
        </div>
        <div>
          {profile.skills.map((s) => (
            <span key={s} className="profile-chip">{s}</span>
          ))}
        </div>
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
      <span className="upload-icon">{'\uD83D\uDCC4'}</span>
      <div className="upload-title">Drop your resume</div>
      <div className="upload-sub">PDF or DOCX · Parsed locally</div>
    </div>
  );
}
