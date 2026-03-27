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

/** Lightweight markdown → HTML (no external dep needed). */
function md(text: string): string {
  let out = text
    // fenced code blocks
    .replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).replace(/^[a-z]*\n/, '')}</code></pre>`)
    // headings
    .replace(/^#{4,} (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    // bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // unordered lists
    .replace(/((?:^[-*] .+$\n?)+)/gm, block =>
      '<ul>' + block.replace(/^[-*] (.+)$/gm, '<li>$1</li>') + '</ul>')
    // horizontal rules
    .replace(/^[-*]{3,}$/gm, '<hr />');

  // wrap bare paragraphs
  out = out.split(/\n{2,}/).map(para => {
    para = para.trim();
    if (!para) return '';
    if (/^<(h[1-6]|ul|ol|pre|hr|li)/.test(para)) return para;
    return `<p>${para.replace(/\n/g, '<br />')}</p>`;
  }).join('\n');

  return out;
}

export default function JobCard({ job, resumeProfile, llmConfig }: JobCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<JobAssessment | null>(null);
  const [assessError, setAssessError] = useState('');

  const triggerAssess = async () => {
    if (assessment || assessing || !resumeProfile) return;
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: JobAssessment = await res.json();
      setAssessment(data);
    } catch (err) {
      setAssessError('Assessment failed. Check your LLM settings and try again.');
      console.error('assess error', err);
    } finally {
      setAssessing(false);
    }
  };

  const handleExpand = () => {
    const opening = !expanded;
    setExpanded(opening);
    if (opening) triggerAssess();
  };

  const score = assessment?.match_score ?? job.match_score;
  const locationType =
    job.location?.toLowerCase().includes('remote') ? 'remote' :
    job.location?.toLowerCase().includes('hybrid') ? 'hybrid' : '';

  return (
    <div className={`job-card ${expanded ? 'expanded' : ''}`}>

      {/* ── Header (always visible) ── */}
      <div className="job-card-header" onClick={handleExpand} style={{ cursor: 'pointer' }}>
        <div className="company-logo">
          {job.company_url ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(job.company_url)}&sz=64`}
              alt={job.company}
              className="company-favicon"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex'; }}
            />
          ) : null}
          <span className="company-initials" style={{ display: job.company_url ? 'none' : 'flex' }}>
            {job.company?.charAt(0)?.toUpperCase() || '?'}
          </span>
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
          >▾</button>
        </div>
      </div>

      {/* ── Expanded body (conditionally mounted) ── */}
      {expanded && (
        <div className="job-expanded-body">

          {/* Two-column: description | assessment */}
          <div className="job-expanded-grid">

            {/* Left — description with markdown */}
            <div className="job-expanded-col">
              <div className="exp-section-title">📋 Description</div>
              <div
                className="job-description markdown-body"
                dangerouslySetInnerHTML={{ __html: md(job.description || 'No description available.') }}
              />
            </div>

            {/* Right — LLM assessment */}
            <div className="job-expanded-col">
              <div className="exp-section-title">🤖 LLM Assessment</div>
              <div className="assessment-box">

                {!resumeProfile && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Upload your résumé to get an AI-powered match analysis.
                  </p>
                )}

                {resumeProfile && assessing && (
                  <div className="assessment-loading">
                    <div className="spinner" />
                    Analyzing with {llmConfig?.model ?? 'LLM'}…
                  </div>
                )}

                {resumeProfile && assessError && (
                  <p style={{ fontSize: 12, color: '#f87171' }}>{assessError}</p>
                )}

                {resumeProfile && assessment && (
                  <>
                    <div className="assessment-score-row">
                      <ScoreRing score={assessment.match_score} />
                      <span className="assessment-score-label">match score</span>
                    </div>

                    {assessment.summary && (
                      <div className="assessment-text">{assessment.summary}</div>
                    )}

                    {assessment.strong_points.length > 0 && (
                      <div className="assessment-pros">
                        <div className="assessment-pros-title">✓ Strong Points</div>
                        {assessment.strong_points.map((p, i) => (
                          <div key={i} className="assessment-item">{p}</div>
                        ))}
                      </div>
                    )}

                    {assessment.gaps.length > 0 && (
                      <div className="assessment-gaps">
                        <div className="assessment-gaps-title">⚠ Gaps</div>
                        {assessment.gaps.map((g, i) => (
                          <div key={i} className="assessment-item">{g}</div>
                        ))}
                      </div>
                    )}

                    {(assessment.career_suggestions?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div className="assessment-pros-title" style={{ color: 'var(--gold)' }}>
                          ✦ Suggestions
                        </div>
                        {assessment.career_suggestions.map((s, i) => (
                          <div key={i} className="suggestion-item">{s}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

          </div>

          {/* Actions bar */}
          <div className="job-expanded-actions">
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
                onClick={() => { setAssessment(null); setAssessError(''); triggerAssess(); }}
              >
                Re-assess
              </button>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
