import { useState } from 'react';
import ScoreRing from './ScoreRing';
import type { JobResult, JobAssessment, ResumeProfile, BookmarkStatus } from '../types';

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
  keywords?: string[];
  // Assessment state owned by parent (Search.tsx)
  assessment?: JobAssessment;
  assessing?: boolean;
  onReassess?: () => void;
  bookmarkStatus?: BookmarkStatus;
  onBookmark?: (status: BookmarkStatus | null) => void;
}

/** Lightweight markdown → HTML (no external dep needed). */
function md(text: string): string {
  let out = text
    .replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).replace(/^[a-z]*\n/, '')}</code></pre>`)
    .replace(/^#{4,} (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/((?:^[-*] .+$\n?)+)/gm, block =>
      '<ul>' + block.replace(/^[-*] (.+)$/gm, '<li>$1</li>') + '</ul>')
    .replace(/^[-*]{3,}$/gm, '<hr />');

  out = out.split(/\n{2,}/).map(para => {
    para = para.trim();
    if (!para) return '';
    if (/^<(h[1-6]|ul|ol|pre|hr|li)/.test(para)) return para;
    return `<p>${para.replace(/\n/g, '<br />')}</p>`;
  }).join('\n');

  return out;
}

/** Returns which of the given keywords appear in the job text (case-insensitive). */
function matchedKeywords(job: JobResult, keywords: string[]): string[] {
  const haystack = `${job.title} ${job.company} ${(job.description || '').slice(0, 1000)}`.toLowerCase();
  return keywords.filter(kw => haystack.includes(kw.toLowerCase()));
}

export default function JobCard({
  job,
  resumeProfile,
  llmConfig,
  keywords = [],
  assessment,
  assessing,
  onReassess,
  bookmarkStatus,
  onBookmark,
}: JobCardProps) {
  const [expanded, setExpanded] = useState(false);

  const score = assessment?.match_score ?? job.match_score;

  const locLower = (job.location || '').toLowerCase();
  const workStyle = (() => {
    if (locLower.includes('híbrido') || locLower.includes('hibrido') || locLower.includes('hybrid')) {
      return { cls: 'hybrid' as const, label: 'Hybrid' };
    }
    if (
      locLower.includes('remote') ||
      locLower.includes('remoto') ||
      locLower.includes('home office') ||
      locLower.includes('anywhere') ||
      locLower.includes('wfh') ||
      locLower.includes('teletrabalho') ||
      locLower.includes('trabalho remoto') ||
      locLower.includes('distributed')
    ) {
      const label =
        (locLower.includes('remoto') || locLower.includes('teletrabalho')) && !locLower.includes('remote')
          ? 'Remoto'
          : 'Remote';
      return { cls: 'remote' as const, label };
    }
    return { cls: '' as const, label: '' };
  })();

  const hits = matchedKeywords(job, keywords);

  // Failed parse detection — show re-assess prompt instead of bad data
  const parseFailed =
    assessment &&
    assessment.summary.toLowerCase().includes('could not parse');

  return (
    <div className={`job-card ${expanded ? 'expanded' : ''}`}>

      {/* ── Header (always visible) ── */}
      <div className="job-card-header" onClick={() => setExpanded(e => !e)} style={{ cursor: 'pointer' }}>
        <div className="company-logo">
          {job.company_url ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(job.company_url)}&sz=64`}
              alt={job.company}
              className="company-favicon"
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex';
              }}
            />
          ) : null}
          <span className="company-initials" style={{ display: job.company_url ? 'none' : 'flex' }}>
            {job.company?.charAt(0)?.toUpperCase() || '?'}
          </span>
        </div>

        <div className="job-info">
          <div className="job-title">{job.title}</div>
          <div className="job-company">{job.company} · {job.location}</div>
          <div className="job-tags">
            {workStyle.cls && <span className={`tag ${workStyle.cls}`}>{workStyle.label}</span>}
            {job.site && <span className="tag">{job.site}</span>}
            {job.posted_date && <span className="tag">{job.posted_date}</span>}
            {/* Salary — green tag when available */}
            {job.salary_range && (
              <span className="tag salary">💰 {job.salary_range}</span>
            )}
            {/* Matched keywords — gold highlight chips */}
            {hits.map(kw => (
              <span key={kw} className="tag kw-match">{kw}</span>
            ))}
            {/* Description quality indicator */}
            {(!job.description || job.description.length < 100) && (
              <span className="tag desc-warn" title="Short or missing description — AI assessment may be less accurate">⚠ Low detail</span>
            )}
          </div>
        </div>

        <div className="job-right">
          {assessing && !assessment && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>analyzing</span>
            </div>
          )}
          {bookmarkStatus && (
            <span className="bookmark-badge" title={bookmarkStatus}>
              {bookmarkStatus === 'saved' ? '☆' : bookmarkStatus === 'applied' ? '📨' : bookmarkStatus === 'interview' ? '🎯' : bookmarkStatus === 'rejected' ? '✕' : '🎉'}
            </span>
          )}
          {score != null && !parseFailed && <ScoreRing score={score} />}
          <button
            className={`expand-btn ${expanded ? 'open' : ''}`}
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >▾</button>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="job-expanded-body">
          <div className="job-expanded-grid">

            {/* Left — description */}
            <div className="job-expanded-col-outer">
              <div className="exp-section-title">📋 Description</div>
              <div className="job-expanded-col">
                <div
                  className="job-description markdown-body"
                  dangerouslySetInnerHTML={{ __html: md(job.description || 'No description available.') }}
                />
              </div>
            </div>

            {/* Right — LLM assessment */}
            <div className="job-expanded-col-outer">
              <div className="exp-section-title">🤖 LLM Assessment</div>
              <div className="job-expanded-col">
                <div className="assessment-box">

                  {!resumeProfile && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Upload your résumé to get an AI-powered match analysis.
                    </p>
                  )}

                  {resumeProfile && assessing && !assessment && (
                    <div className="assessment-loading">
                      <div className="spinner" />
                      Analyzing with {llmConfig?.model ?? 'LLM'}…
                    </div>
                  )}

                  {/* Parse-failed state — show retry prompt */}
                  {resumeProfile && parseFailed && (
                    <div style={{ textAlign: 'center', padding: '16px 0' }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                        Assessment could not be completed.
                      </div>
                      {onReassess && (
                        <button
                          className="apply-btn"
                          style={{ background: 'transparent', border: '1px solid var(--border-bright)', color: 'var(--gold)' }}
                          onClick={onReassess}
                          disabled={assessing}
                        >
                          ↺ Try Again
                        </button>
                      )}
                    </div>
                  )}

                  {resumeProfile && assessment && !parseFailed && (
                    <>
                      {/* Irrelevant job warning */}
                      {assessment.is_relevant === false && (
                        <div style={{
                          background: 'rgba(248,113,113,0.08)',
                          border: '1px solid rgba(248,113,113,0.25)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          marginBottom: 14,
                          fontSize: 12,
                          color: '#f87171',
                          lineHeight: 1.5,
                        }}>
                          ⚠ This job appears unrelated to your professional field.
                        </div>
                      )}

                      <div className="assessment-score-row">
                        <ScoreRing score={assessment.match_score} />
                        <span className="assessment-score-label">match score</span>
                      </div>

                      {assessment.summary && (
                        <div className="assessment-text">{assessment.summary}</div>
                      )}

                      {/* Income range */}
                      {assessment.income_range && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 12px',
                          background: 'rgba(74,222,128,0.08)',
                          border: '1px solid rgba(74,222,128,0.2)',
                          borderRadius: 8,
                          fontSize: 12,
                          color: '#4ade80',
                          fontWeight: 600,
                          marginBottom: 14,
                        }}>
                          💰 {assessment.income_range}
                        </div>
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

                      {assessment.company_insights && (
                        <div style={{ marginTop: 16 }}>
                          <div className="assessment-pros-title" style={{ color: '#60a5fa' }}>
                            🌐 Company Insights
                          </div>
                          <div className="assessment-item" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            {assessment.company_insights}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
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
            {resumeProfile && onReassess && (
              <button
                className="apply-btn"
                style={{ background: 'transparent', border: '1px solid var(--border-bright)', color: 'var(--gold)' }}
                onClick={onReassess}
                disabled={assessing}
              >
                {assessing ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Analyzing…</> : '↺ Re-assess'}
              </button>
            )}
            {/* Bookmark / Application Tracker */}
            {onBookmark && (
              <div className="bookmark-actions">
                {!bookmarkStatus ? (
                  <button
                    className="apply-btn"
                    style={{ background: 'transparent', border: '1px solid var(--border-bright)', color: 'var(--text-muted)' }}
                    onClick={() => onBookmark('saved')}
                  >
                    ☆ Save
                  </button>
                ) : (
                  <>
                    <select
                      className="bookmark-status-select"
                      value={bookmarkStatus}
                      onChange={e => onBookmark(e.target.value as BookmarkStatus)}
                    >
                      <option value="saved">☆ Saved</option>
                      <option value="applied">📨 Applied</option>
                      <option value="interview">🎯 Interview</option>
                      <option value="rejected">✕ Rejected</option>
                      <option value="offer">🎉 Offer</option>
                    </select>
                    <button
                      className="apply-btn"
                      style={{ background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', padding: '6px 12px', fontSize: 11 }}
                      onClick={() => onBookmark(null)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
