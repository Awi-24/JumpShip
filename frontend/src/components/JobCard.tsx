import { useState } from 'react';
import ScoreRing from './ScoreRing';
import type { JobResult, JobAssessment, ResumeProfile } from '../types';

interface LLMConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

interface JobCardProps {
  job: JobResult;
  resumeProfile: ResumeProfile | null;
  llmConfig?: LLMConfig;
}

export default function JobCard({ job, resumeProfile, llmConfig }: JobCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<JobAssessment | null>(null);
  const [assessError, setAssessError] = useState('');

  const handleExpand = async () => {
    const wasExpanded = expanded;
    setExpanded(e => !e);

    if (!wasExpanded && !assessment && !assessing && resumeProfile) {
      setAssessing(true);
      setAssessError('');
      try {
        const res = await fetch('/api/jobs/assess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job,
            resume_profile: resumeProfile,
            llm_provider: llmConfig?.provider,
            llm_model: llmConfig?.model,
            llm_api_key: llmConfig?.apiKey,
            llm_base_url: llmConfig?.baseUrl,
          }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data: JobAssessment = await res.json();
        setAssessment(data);
      } catch {
        setAssessError('Assessment failed. Check your LLM settings and try again.');
      } finally {
        setAssessing(false);
      }
    }
  };

  const score = assessment?.match_score ?? job.match_score;
  const locationType =
    job.location?.toLowerCase().includes('remote') ? 'remote' :
    job.location?.toLowerCase().includes('hybrid') ? 'hybrid' : '';

  return (
    <div className={`job-card ${expanded ? 'expanded' : ''}`}>
      <div className="job-card-header" onClick={handleExpand}>
        <div className="company-logo">
          {job.company?.charAt(0)?.toUpperCase() || '?'}
        </div>

        <div className="job-info">
          <div className="job-title">{job.title}</div>
          <div className="job-company">
            {job.company} · {job.location}
            {job.salary_range ? ` · ${job.salary_range}` : ''}
          </div>
          <div className="job-tags">
            {locationType && <span className={`tag ${locationType}`}>{locationType}</span>}
            {job.site && <span className="tag">{job.site}</span>}
            {job.posted_date && <span className="tag">{job.posted_date}</span>}
          </div>
        </div>

        <div className="job-right">
          {score != null && <ScoreRing score={score} />}
          <button
            className={`expand-btn ${expanded ? 'open' : ''}`}
            onClick={e => { e.stopPropagation(); handleExpand(); }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            ▾
          </button>
        </div>
      </div>

      <div className={`job-expanded ${expanded ? 'open' : ''}`}>
        <div className="job-expanded-inner">

          {/* Description */}
          <div>
            <div className="exp-section-title">📋 Description</div>
            <div className="job-description">
              {job.description?.slice(0, 1500) || 'No description available.'}
            </div>
          </div>

          {/* LLM Assessment */}
          <div>
            <div className="exp-section-title">🤖 LLM Assessment</div>
            <div className="assessment-box">
              {!resumeProfile && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Upload your résumé to get an AI-powered match analysis.
                </div>
              )}
              {resumeProfile && assessing && (
                <div className="assessment-loading">
                  <div className="spinner" />
                  Analyzing fit with {llmConfig?.provider ?? 'LLM'}...
                </div>
              )}
              {resumeProfile && assessError && (
                <div style={{ fontSize: 12, color: '#f87171' }}>{assessError}</div>
              )}
              {resumeProfile && assessment && (
                <>
                  {assessment.summary && (
                    <div className="assessment-text">{assessment.summary}</div>
                  )}
                  <div className="assessment-pros">
                    <div className="assessment-pros-title">✓ Strong Points</div>
                    {assessment.strong_points.map((p, i) => (
                      <div key={i} className="assessment-item">{p}</div>
                    ))}
                  </div>
                  <div className="assessment-gaps">
                    <div className="assessment-gaps-title">⚠ Gaps</div>
                    {assessment.gaps.map((g, i) => (
                      <div key={i} className="assessment-item">{g}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Career Suggestions */}
          {assessment && (assessment.career_suggestions?.length ?? 0) > 0 && (
            <div className="suggestions-box">
              <div className="exp-section-title">✦ Career Suggestions</div>
              {assessment.career_suggestions.map((s, i) => (
                <div key={i} className="suggestion-item">{s}</div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, gridColumn: '1 / -1' }}>
            <a
              href={job.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="apply-btn"
              style={{ textDecoration: 'none', opacity: job.url ? 1 : 0.4 }}
            >
              Apply Now →
            </a>
            {assessment && (
              <button
                className="apply-btn"
                style={{ background: 'transparent', border: '1px solid var(--border-bright)', color: 'var(--gold)' }}
                onClick={e => { e.stopPropagation(); setAssessment(null); }}
              >
                Re-assess
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
