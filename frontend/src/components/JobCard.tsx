import { useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Banknote, AlertTriangle, Bookmark,
  FileText, Bot, Check, Sparkles, Tag, Globe, ChevronDown,
} from 'lucide-react';
import ScoreRing from './ScoreRing';
import type { JobResult, JobAssessment, ResumeProfile, LLMConfig } from '../types';

interface JobCardProps {
  job: JobResult;
  resumeProfile: ResumeProfile | null;
  llmConfig?: LLMConfig;
  keywords?: string[];
  assessment?: JobAssessment;
  assessing?: boolean;
  onReassess?: () => void;
  isSaved?: boolean;
  onSave?: () => void;
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
  isSaved,
  onSave,
}: JobCardProps) {
  const [expanded, setExpanded] = useState(false);

  const score = assessment?.match_score ?? job.match_score;

  const locLower = (job.location || '').toLowerCase();
  const workStyle = (() => {
    // Prefer the backend-resolved is_remote field; fall back to string scanning
    if (job.is_remote === null || locLower.includes('híbrido') || locLower.includes('hibrido') || locLower.includes('hybrid')) {
      return { cls: 'hybrid' as const, label: 'Híbrido' };
    }
    if (job.is_remote === true) {
      const isPortuguese = locLower.includes('remoto') || locLower.includes('teletrabalho');
      return { cls: 'remote' as const, label: isPortuguese ? 'Remoto' : 'Remote' };
    }
    if (job.is_remote === false) {
      return { cls: 'onsite' as const, label: 'Presencial' };
    }
    return { cls: '' as const, label: '' };
  })();

  // LLM tags from assessment (stack, domain, etc.) — shown even before full expand
  const llmTags: string[] = assessment?.job_tags ?? [];
  // Scraper tags that aren't work-mode (already shown via workStyle)
  const scraperTags = (job.tags ?? []).filter(t => !['remote','hybrid','on-site','remoto','presencial'].includes(t));

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
            {/* Work mode — from backend is_remote */}
            {workStyle.cls && <span className={`tag tag-workmode ${workStyle.cls}`}>{workStyle.label}</span>}
            {/* Seniority / contract from scraper */}
            {scraperTags.map(t => (
              <span key={t} className="tag tag-feature">{t}</span>
            ))}
            {/* Salary — green tag when available from scraper or LLM */}
            {(job.salary_range || assessment?.income_range) && (
              <span className="tag salary">
                <Banknote size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                {job.salary_range || assessment?.income_range}
              </span>
            )}
            {/* LLM stack/domain tags — shown as soon as assessment arrives */}
            {llmTags.map(t => (
              <span key={t} className="tag tag-llm">{t}</span>
            ))}
            {/* Source platform */}
            {job.site && <span className="tag tag-source">{job.site}</span>}
            {/* Posted date */}
            {job.posted_date && <span className="tag tag-date">{job.posted_date}</span>}
            {/* Matched keywords */}
            {hits.map(kw => (
              <span key={kw} className="tag kw-match">{kw}</span>
            ))}
            {(!job.description || job.description.length < 100) && (
              <span className="tag desc-warn" title="Short description: AI assessment may be less accurate">
                <AlertTriangle size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />Low detail
              </span>
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
          {isSaved && (
            <span className="bookmark-badge" title="Saved to Tracker">
              <Bookmark size={12} />
            </span>
          )}
          {score != null && !parseFailed && <ScoreRing score={score} />}
          <button
            className={`expand-btn ${expanded ? 'open' : ''}`}
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          ><ChevronDown size={16} /></button>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="job-expanded-body">
          <div className="job-expanded-grid">

            {/* Left — description */}
            <div className="job-expanded-col-outer">
              <div className="exp-section-title"><FileText size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Description</div>
              <div className="job-expanded-col">
                <div
                  className="job-description markdown-body"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(md(job.description || 'No description available.')) }}
                />
              </div>
            </div>

            {/* Right — LLM assessment */}
            <div className="job-expanded-col-outer">
              <div className="exp-section-title"><Bot size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />LLM Assessment</div>
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
                          <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />This job appears unrelated to your professional field.
                        </div>
                      )}

                      <div className="assessment-score-row">
                        <ScoreRing score={assessment.match_score} />
                        <span className="assessment-score-label">match score</span>
                        {assessment.hire_recommendation && (() => {
                          const cfg: Record<string, { label: string; color: string; bg: string; border: string }> = {
                            strong_yes: { label: 'Apply now',    color: '#4ade80', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)' },
                            yes:        { label: 'Good shot',    color: '#86efac', bg: 'rgba(74,222,128,0.07)', border: 'rgba(74,222,128,0.20)' },
                            borderline: { label: 'Borderline',   color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)' },
                            no:         { label: 'Weak match',   color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)' },
                            strong_no:  { label: 'Skip',         color: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)' },
                          };
                          const c = cfg[assessment.hire_recommendation!];
                          return c ? (
                            <span style={{ marginLeft: 10, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, border: `1px solid ${c.border}`, letterSpacing: '0.02em' }}>
                              {c.label}
                            </span>
                          ) : null;
                        })()}
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
                          <Banknote size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{assessment.income_range}
                        </div>
                      )}

                      {assessment.strong_points.length > 0 && (
                        <div className="assessment-pros">
                          <div className="assessment-pros-title"><Check size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Strong Points</div>
                          {assessment.strong_points.map((p, i) => (
                            <div key={i} className="assessment-item">{p}</div>
                          ))}
                        </div>
                      )}

                      {assessment.gaps.length > 0 && (
                        <div className="assessment-gaps">
                          <div className="assessment-gaps-title"><AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Gaps</div>
                          {assessment.gaps.map((g, i) => (
                            <div key={i} className="assessment-item">{g}</div>
                          ))}
                        </div>
                      )}

                      {(assessment.career_suggestions?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div className="assessment-pros-title" style={{ color: 'var(--gold)' }}>
                            <Sparkles size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Suggestions
                          </div>
                          {assessment.career_suggestions.map((s, i) => (
                            <div key={i} className="suggestion-item">{s}</div>
                          ))}
                        </div>
                      )}

                      {/* LLM-extracted job tags (stack, domain, seniority) */}
                      {(assessment.job_tags?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div className="assessment-pros-title" style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>
                            <Tag size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Job Tags
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {assessment.job_tags!.map(t => (
                              <span key={t} className="tag tag-feature" style={{ fontSize: 11 }}>{t}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Keywords matched / missing */}
                      {((assessment.keywords_matched?.length ?? 0) > 0 || (assessment.keywords_missing?.length ?? 0) > 0) && (
                        <div style={{ marginTop: 14 }}>
                          {(assessment.keywords_matched?.length ?? 0) > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div className="assessment-pros-title" style={{ color: '#4ade80', fontSize: 11, marginBottom: 5 }}>
                                <Check size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Keywords Matched
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {assessment.keywords_matched!.map(k => (
                                  <span key={k} className="tag" style={{ fontSize: 10, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}>{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(assessment.keywords_missing?.length ?? 0) > 0 && (
                            <div>
                              <div className="assessment-pros-title" style={{ color: '#f87171', fontSize: 11, marginBottom: 5 }}>
                                <AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Keywords Missing
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {assessment.keywords_missing!.map(k => (
                                  <span key={k} className="tag" style={{ fontSize: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171' }}>{k}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {assessment.company_insights && (
                        <div style={{ marginTop: 16 }}>
                          <div className="assessment-pros-title" style={{ color: '#60a5fa' }}>
                            <Globe size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Company Insights
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
            {(() => {
              let safeUrl: string | null = null;
              if (job.url) {
                try {
                  const u = new URL(job.url);
                  if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.toString();
                } catch { /* invalid URL — render disabled */ }
              }
              return safeUrl ? (
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="apply-btn"
                  style={{ textDecoration: 'none' }}
                  aria-label={`Apply to ${job.title} at ${job.company}`}
                >
                  Apply Now →
                </a>
              ) : (
                <span className="apply-btn" style={{ opacity: 0.4 }} aria-disabled="true">
                  Apply Now →
                </span>
              );
            })()}

            {resumeProfile && onReassess && (
              <button
                className="apply-btn"
                style={{ background: 'transparent', border: '1px solid var(--border-bright)', color: 'var(--gold)' }}
                onClick={onReassess}
                disabled={assessing}
                aria-label={`Re-assess ${job.title}`}
              >
                {assessing ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Analyzing…</> : '↺ Re-assess'}
              </button>
            )}

            {onSave && (
              <button
                className="apply-btn"
                aria-label={isSaved ? `${job.title} saved` : `Save ${job.title} to tracker`}
                style={{
                  background: isSaved ? 'rgba(74,222,128,0.08)' : 'transparent',
                  border: `1px solid ${isSaved ? 'rgba(74,222,128,0.35)' : 'var(--border-bright)'}`,
                  color: isSaved ? '#4ade80' : 'var(--text-muted)',
                }}
                onClick={onSave}
                disabled={isSaved}
              >
                <Bookmark size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {isSaved ? 'Saved to Tracker' : 'Save to Tracker'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
