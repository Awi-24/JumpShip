import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  User, Settings2, Search as SearchIcon, Bookmark, Rocket,
  Eye, X, AlertTriangle, Globe, FileDown, FileText,
  Banknote, Star,
} from 'lucide-react';
import ResumeUpload from '../components/ResumeUpload';
import JobCard from '../components/JobCard';
import SettingsModal from '../components/SettingsModal';
import ThemeToggle from '../components/ThemeToggle';
import Profile from './Profile';
import CustomSelect from '../components/CustomSelect';
import AssessmentLoader from '../components/AssessmentLoader';
import LocationSelect from '../components/LocationSelect';
import { useResumeParse } from '../hooks/useResume';
import { useJobSearch } from '../hooks/useJobs';
import { useSettings } from '../hooks/useSettings';
import { useResumeCache } from '../hooks/useResumeCache';
import type { ResumeProfile, JobResult, JobAssessment, SortOption, BookmarkStatus } from '../types';

interface SearchProps {
  onBack: () => void;
  onNavigate: (page: 'tracker') => void;
}

const ALL_SITES = ['linkedin', 'indeed', 'glassdoor', 'zip_recruiter', 'remoteok', 'arbeitnow', 'gupy', 'programathor', 'trampos'];
const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseSalary(s: string): number {
  if (!s) return -1;
  const m = s.match(/[\d,]+/);
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : -1;
}

function parseDate(s: string): number {
  if (!s) return 0;
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ── Search History (localStorage) ────────────────────────────────────────────
interface SearchHistoryEntry {
  keywords: string[];
  location: string;
  sites: string[];
  timestamp: number;
}

const HISTORY_KEY = 'jumpship_search_history';
const MAX_HISTORY = 10;

function loadHistory(): SearchHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(entry: SearchHistoryEntry) {
  try {
    const history = loadHistory().filter(
      h => h.keywords.join(',') !== entry.keywords.join(',') || h.location !== entry.location
    );
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

// ── Bookmarks (localStorage) ─────────────────────────────────────────────────
const BOOKMARKS_KEY = 'jumpship_bookmarks';

interface BookmarkEntry {
  job: JobResult;
  status: BookmarkStatus;
  savedAt: string;
  assessment?: JobAssessment;
}

function loadBookmarks(): Record<string, BookmarkEntry> {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '{}');
  } catch { return {}; }
}

function saveBookmarks(bookmarks: Record<string, BookmarkEntry>) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch { /* ignore */ }
}

// ── Export helpers ────────────────────────────────────────────────────────────
function exportCSV(jobs: JobResult[], assessments: Record<string, JobAssessment>) {
  const header = 'Title,Company,Location,Site,Salary,Posted,Score,Summary,URL\n';
  const rows = jobs.map(j => {
    const a = assessments[j.id];
    return [
      `"${(j.title || '').replace(/"/g, '""')}"`,
      `"${(j.company || '').replace(/"/g, '""')}"`,
      `"${(j.location || '').replace(/"/g, '""')}"`,
      j.site,
      `"${(j.salary_range || '').replace(/"/g, '""')}"`,
      j.posted_date,
      a?.match_score ?? '',
      `"${(a?.summary || '').replace(/"/g, '""')}"`,
      j.url,
    ].join(',');
  }).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jumpship-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(jobs: JobResult[], assessments: Record<string, JobAssessment>) {
  const data = jobs.map(j => ({ ...j, assessment: assessments[j.id] || null }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jumpship-results-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function Search({ onBack, onNavigate }: SearchProps) {
  const { settings, saveSettings } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const ASSESS_CONCURRENCY = settings.assessmentSpeed === 'careful' ? 1 : settings.assessmentSpeed === 'turbo' ? 6 : 3;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [generatingResumeJobId, setGeneratingResumeJobId] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<'green' | 'yellow' | 'red'>('yellow');

  // Resume — with localStorage persistence
  const resumeMutation = useResumeParse();
  const { cache: resumeCache, saveResume, clearResume } = useResumeCache();
  const [resumeProfile, setResumeProfile] = useState<ResumeProfile | null>(resumeCache?.profile ?? null);
  const [resumeFileName, setResumeFileName] = useState(resumeCache?.fileName ?? '');

  // Search filters — pre-fill from cached resume if available
  const [keywords, setKeywords] = useState<string[]>(resumeCache?.keywords ?? []);
  const [location, setLocation] = useState(settings.defaultLocation);
  const [jobType, setJobType] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('match');
  const [newKeyword, setNewKeyword] = useState('');
  const [activeSites, setActiveSites] = useState<string[]>(
    settings.defaultSites?.length ? settings.defaultSites : ['linkedin', 'indeed', 'glassdoor']
  );
  const [resultsWanted, setResultsWanted] = useState(settings.resultsWanted ?? 20);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Search history
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>(loadHistory);

  // Active tab
  const [activeTab, setActiveTab] = useState<'search' | 'saved'>('search');

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<Record<string, BookmarkEntry>>(loadBookmarks);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  // Keyword suggestions & translations
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [translations, setTranslations] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingTranslations, setLoadingTranslations] = useState(false);

  const toggleSite = (site: string) =>
    setActiveSites(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site]
    );

  // Assessments — owned by parent for sorting + auto-assess
  const [assessments, setAssessments] = useState<Record<string, JobAssessment>>({});
  const [assessingIds, setAssessingIds] = useState<Set<string>>(new Set());

  const jobSearch = useJobSearch();
  const jobs: JobResult[] = jobSearch.data || [];

  // Poll LLM health
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        setLlmStatus(data.llm_available ? 'green' : 'yellow');
      } catch {
        setLlmStatus('red');
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [settings.llmProvider]);

  // ── Resume upload ──────────────────────────────────────────────────────────
  const handleResumeUpload = useCallback(async (file: File) => {
    const s = settingsRef.current;
    const apiKey =
      s.llmProvider === 'openai'    ? s.openaiKey :
      s.llmProvider === 'anthropic' ? s.anthropicKey :
      s.llmProvider === 'groq'      ? s.groqKey : '';

    const profile = await resumeMutation.mutateAsync({
      file,
      llmProvider: s.llmProvider,
      llmModel:    s.llmModel    || undefined,
      llmBaseUrl:  s.ollamaUrl   || undefined,
      llmApiKey:   apiKey        || undefined,
    });
    setResumeProfile(profile);
    setResumeFileName(file.name);
    setAssessments({});
    setAssessingIds(new Set());
    const kws: string[] = [];
    if (profile.suggested_keywords?.length) {
      const seen = new Set<string>();
      profile.suggested_keywords
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 0 && !seen.has(k) && seen.add(k))
        .forEach(k => kws.push(k));
      setKeywords(kws);
    }
    // Persist so next session auto-restores without re-upload
    saveResume(profile, kws, file.name);
    if (!location && s.defaultLocation) setLocation(s.defaultLocation);
    else if (!location) setLocation('Remote');
  }, [resumeMutation, location, saveResume]);

  const handleResetResume = () => {
    setResumeProfile(null);
    setResumeFileName('');
    setKeywords([]);
    setAssessments({});
    setAssessingIds(new Set());
    clearResume();
  };

  const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'openclaw']);

  // ── Build LLM body fields ──────────────────────────────────────────────────
  const getLlmFields = useCallback(() => {
    const s = settingsRef.current;
    const apiKey =
      s.llmProvider === 'openai'    ? s.openaiKey :
      s.llmProvider === 'anthropic' ? s.anthropicKey :
      s.llmProvider === 'groq'      ? s.groqKey : '';
    return {
      llm_provider: s.llmProvider,
      llm_model:    s.llmModel    || undefined,
      llm_api_key:  apiKey        || undefined,
      llm_base_url: s.ollamaUrl   || undefined,
    };
  }, []);

  // ── Auto-assess all jobs ──────────────────────────────────────────────────
  const assessSingle = useCallback(async (job: JobResult, profile: ResumeProfile) => {
    const body = { job, resume_profile: profile, ...getLlmFields() };
    setAssessingIds(prev => new Set(prev).add(job.id));

    const MAX_RETRIES = 2;
    let lastData: JobAssessment | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/jobs/assess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) break;
        const data: JobAssessment = await res.json();
        if (data.summary?.toLowerCase().includes('could not parse') && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        lastData = data;
        break;
      } catch {
        break;
      }
    }

    const fallback: JobAssessment = {
      match_score: 0,
      summary: 'Assessment could not be completed for this listing.',
      strong_points: [],
      gaps: [],
      career_suggestions: [],
      is_relevant: true,
    };
    setAssessments(prev => ({ ...prev, [job.id]: lastData ?? fallback }));
    setAssessingIds(prev => { const s = new Set(prev); s.delete(job.id); return s; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getLlmFields]);

  // ── Batch assess (cloud providers — parallel, one round-trip) ─────────────
  const assessBatch = useCallback(async (jobList: JobResult[], profile: ResumeProfile) => {
    if (!jobList.length) {
      setAssessingIds(new Set());
      return;
    }
    setAssessingIds(new Set(jobList.map(j => j.id)));
    const batchFallback: JobAssessment = {
      match_score: 0,
      summary: 'Assessment could not be completed for this listing.',
      strong_points: [],
      gaps: [],
      career_suggestions: [],
      is_relevant: true,
    };
    try {
      const body = {
        jobs: jobList,
        resume_profile: profile,
        include_company_research: false,
        ...getLlmFields(),
      };
      const res = await fetch('/api/jobs/assess-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setAssessments(prev => {
          const next = { ...prev };
          for (const j of jobList) next[j.id] = batchFallback;
          return next;
        });
        return;
      }
      const items: { job_id: string; assessment: JobAssessment | null; error?: string }[] = await res.json();
      setAssessments(prev => {
        const next = { ...prev };
        for (const item of items) {
          if (item.assessment) next[item.job_id] = item.assessment;
          else if (item.job_id) next[item.job_id] = batchFallback;
        }
        for (const j of jobList) {
          if (!next[j.id]) next[j.id] = batchFallback;
        }
        return next;
      });
    } catch {
      setAssessments(prev => {
        const next = { ...prev };
        for (const j of jobList) next[j.id] = batchFallback;
        return next;
      });
    }
    finally {
      setAssessingIds(new Set());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getLlmFields]);

  // Trigger auto-assessment whenever jobs load and a resume exists
  const jobIds = jobs.map(j => j.id).join(',');
  useEffect(() => {
    if (!resumeProfile || !jobs.length) return;
    setAssessments({});
    const pending = [...jobs];
    // Mark every job as in-flight immediately so the search loader stays up without a gap
    setAssessingIds(new Set(pending.map(j => j.id)));

    const s = settingsRef.current;
    const isCloud = !LOCAL_PROVIDERS.has(s.llmProvider || 'ollama');

    if (isCloud) {
      // Cloud: fire all in parallel via batch endpoint
      assessBatch(jobs, resumeProfile);
      return;
    }

    // Local: sequential batches with backend semaphore preventing GPU contention
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pending.length; i += ASSESS_CONCURRENCY) {
        if (cancelled) break;
        const batch = pending.slice(i, i + ASSESS_CONCURRENCY);
        await Promise.allSettled(batch.map(job => assessSingle(job, resumeProfile)));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds, resumeProfile]);

  const handleReassess = useCallback((job: JobResult) => {
    if (!resumeProfile) return;
    setAssessments(prev => { const n = { ...prev }; delete n[job.id]; return n; });
    assessSingle(job, resumeProfile);
  }, [resumeProfile, assessSingle]);

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = () => {
    const s = settingsRef.current;
    const apiKey =
      s.llmProvider === 'openai'    ? s.openaiKey :
      s.llmProvider === 'anthropic' ? s.anthropicKey :
      s.llmProvider === 'groq'      ? s.groqKey : '';

    jobSearch.mutate({
      keywords,
      location,
      job_type: jobType === 'all' ? 'fulltime' : jobType,
      sites: activeSites.length > 0 ? activeSites : ['linkedin', 'indeed'],
      results_wanted: resultsWanted,
      resume_profile: resumeProfile,
      llm_provider: s.llmProvider,
      llm_model:    s.llmModel || undefined,
      llm_api_key:  apiKey     || undefined,
      llm_base_url: s.ollamaUrl || undefined,
    });

    // Save to search history
    const entry: SearchHistoryEntry = {
      keywords: [...keywords],
      location,
      sites: [...activeSites],
      timestamp: Date.now(),
    };
    saveHistory(entry);
    setSearchHistory(loadHistory());
    setVisibleCount(PAGE_SIZE);
    setSuggestions([]);
    setTranslations([]);
  };


  // ── Keywords ───────────────────────────────────────────────────────────────
  const removeKeyword = (kw: string) => setKeywords(k => k.filter(x => x !== kw));
  const addKeyword = (kw?: string) => {
    // Normalize: lowercase + trim so "Python" and "python" are the same keyword
    const keyword = (kw || newKeyword).trim().toLowerCase();
    if (keyword && !keywords.some(k => k.toLowerCase() === keyword)) {
      setKeywords(k => [...k, keyword]);
    }
    if (!kw) setNewKeyword('');
  };

  // ── Keyword Suggestions (LLM) ─────────────────────────────────────────────
  const fetchSuggestions = async () => {
    if (keywords.length === 0) return;
    setLoadingSuggestions(true);
    setSuggestions([]);
    const s = settingsRef.current;
    const apiKey =
      s.llmProvider === 'openai'    ? s.openaiKey :
      s.llmProvider === 'anthropic' ? s.anthropicKey :
      s.llmProvider === 'groq'      ? s.groqKey : '';
    try {
      const res = await fetch('/api/jobs/suggest-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          llm_provider: s.llmProvider,
          llm_model: s.llmModel || undefined,
          llm_api_key: apiKey || undefined,
          llm_base_url: s.ollamaUrl || undefined,
        }),
      });
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch { /* ignore */ }
    setLoadingSuggestions(false);
  };

  // ── Multi-language Translation ─────────────────────────────────────────────
  const fetchTranslations = async () => {
    if (keywords.length === 0) return;
    setLoadingTranslations(true);
    setTranslations([]);
    const s = settingsRef.current;
    const apiKey =
      s.llmProvider === 'openai'    ? s.openaiKey :
      s.llmProvider === 'anthropic' ? s.anthropicKey :
      s.llmProvider === 'groq'      ? s.groqKey : '';
    try {
      const res = await fetch('/api/jobs/translate-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          target_language: 'pt',
          llm_provider: s.llmProvider,
          llm_model: s.llmModel || undefined,
          llm_api_key: apiKey || undefined,
          llm_base_url: s.ollamaUrl || undefined,
        }),
      });
      const data = await res.json();
      setTranslations(data.translations || []);
    } catch { /* ignore */ }
    setLoadingTranslations(false);
  };

  // ── Bookmarks ──────────────────────────────────────────────────────────────
  const handleBookmark = useCallback((jobId: string, job: JobResult, status: BookmarkStatus | null) => {
    setBookmarks(prev => {
      const next = { ...prev };
      if (status === null) {
        delete next[jobId];
      } else {
        next[jobId] = {
          job,
          status,
          savedAt: prev[jobId]?.savedAt || new Date().toISOString(),
          assessment: assessments[jobId] || prev[jobId]?.assessment,
        };
      }
      saveBookmarks(next);
      return next;
    });
  }, [assessments]);

  // ── Restore search from history ────────────────────────────────────────────
  const restoreSearch = (entry: SearchHistoryEntry) => {
    setKeywords(entry.keywords);
    setLocation(entry.location);
    setActiveSites(entry.sites);
  };

  // ── Generate tailored resume PDF ─────────────────────────────────────────────
  const handleGenerateResume = async (job: JobResult) => {
    if (!resumeProfile) return;
    setGeneratingResumeJobId(job.id);
    try {
      const llmOverride = settings.llmProvider !== 'ollama' ? {
        llm_provider: settings.llmProvider,
        llm_model: settings.llmModel || undefined,
        llm_api_key: (() => {
          const keyMap: Record<string, string> = {
            openai: settings.openaiKey, anthropic: settings.anthropicKey,
            groq: settings.groqKey, gemini: settings.geminiKey,
            mistral: settings.mistralKey, deepseek: settings.deepseekKey,
            huggingface: settings.huggingfaceKey, openrouter: settings.openrouterKey,
            cohere: settings.cohereKey,
          };
          return keyMap[settings.llmProvider] || undefined;
        })(),
        llm_base_url: settings.ollamaUrl || undefined,
      } : {};
      const res = await fetch('/api/resume/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job,
          resume_profile: resumeProfile,
          assessment: assessments[job.id] ? { ...assessments[job.id] } : undefined,
          ...llmOverride,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        alert(`Resume generation failed: ${err.detail || res.statusText}`);
        return;
      }
      // Trigger browser download
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume_${job.company}_${job.title}.pdf`.replace(/[^\w.-]/g, '_');
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Resume generation error: ${e}`);
    } finally {
      setGeneratingResumeJobId(null);
    }
  };

  // ── Sorting + relevance filter ──────────────────────────────────────────────
  const sortedJobs = useMemo(() => {
    let visible = jobs.filter(j => {
      const a = assessments[j.id];
      return !a || a.is_relevant !== false;
    });

    if (showBookmarksOnly) {
      visible = visible.filter(j => bookmarks[j.id]);
    }

    return [...visible].sort((a, b) => {
      if (sortBy === 'match') {
        const sa = assessments[a.id]?.match_score ?? -1;
        const sb = assessments[b.id]?.match_score ?? -1;
        return sb - sa;
      }
      if (sortBy === 'newest') return parseDate(b.posted_date) - parseDate(a.posted_date);
      if (sortBy === 'salary') return parseSalary(b.salary_range) - parseSalary(a.salary_range);
      return 0;
    });
  }, [jobs, sortBy, assessments, showBookmarksOnly, bookmarks]);

  // Paginated view
  const paginatedJobs = sortedJobs.slice(0, visibleCount);
  const hasMore = visibleCount < sortedJobs.length;

  const filteredCount = useMemo(() =>
    jobs.filter(j => assessments[j.id]?.is_relevant === false).length,
  [jobs, assessments]);

  const hiddenJobs = useMemo(() =>
    jobs.filter(j => assessments[j.id]?.is_relevant === false),
  [jobs, assessments]);

  const bookmarkCount = useMemo(() =>
    jobs.filter(j => bookmarks[j.id]).length,
  [jobs, bookmarks]);

  const llmConfig = {
    provider: settings.llmProvider,
    model: settings.llmModel,
    apiKey:
      settings.llmProvider === 'openai'    ? settings.openaiKey :
      settings.llmProvider === 'anthropic' ? settings.anthropicKey :
      settings.llmProvider === 'groq'      ? settings.groqKey : '',
    baseUrl: settings.ollamaUrl,
  };

  const assessedCount = Object.keys(assessments).length;
  const assessingCount = assessingIds.size;

  const totalJobCount = jobs.length;
  const awaitingAllAssessments =
    Boolean(resumeProfile) &&
    totalJobCount > 0 &&
    (assessingCount > 0 || assessedCount < totalJobCount);
  const searchPipelineBusy = jobSearch.isPending || awaitingAllAssessments;

  return (
    <div className="search-page">
      {/* ── HEADER ── */}
      <header className="search-header">
        <div
          className="search-logo"
          onClick={onBack}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBack(); } }}
          aria-label="Back to home"
        >
          <span className="search-page-title">
            <span className="logo-accent">Job</span>
            <span> Hunting</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="settings-trigger" onClick={() => onNavigate('tracker')} title="Job Tracker">
            <Bookmark size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Tracker
          </button>
          <ThemeToggle compact />
          <button className="settings-trigger" onClick={() => setProfileOpen(true)} title="Profile">
            <User size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Profile
          </button>
          <button className="settings-trigger" onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings2 size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Settings
          </button>
        </div>
      </header>

      <SettingsModal open={settingsOpen} initial={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      {profileOpen && <Profile onClose={() => setProfileOpen(false)} />}


      <div className="search-body">
        {/* ── SIDEBAR ── */}
        <aside className="sidebar">

          {/* Resume */}
          <div>
            <div className="sidebar-section-title">Résumé</div>
            <ResumeUpload
              profile={resumeProfile}
              fileName={resumeFileName}
              isLoading={resumeMutation.isPending}
              onUpload={handleResumeUpload}
              cached={!!resumeCache && !resumeMutation.isPending}
            />
            {resumeProfile && (
              <button
                onClick={handleResetResume}
                style={{
                  marginTop: 8, width: '100%', padding: '6px 0',
                  background: 'none', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, color: 'var(--text-muted)', fontSize: 12,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#f87171')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
              >
                <X size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Clear résumé
              </button>
            )}
          </div>

          {/* LLM Status */}
          <div className="llm-status-card">
            <div className="llm-status-row">
              <span className={`status-dot ${llmStatus}`} />
              <span className="llm-status-text">
                {['ollama', 'lmstudio', 'openclaw'].includes(settings.llmProvider)
                  ? `${settings.llmProvider} · local`
                  : `${settings.llmProvider} · cloud`}
              </span>
            </div>
            <div className="llm-status-model">{settings.llmModel}</div>
            {llmStatus === 'red' && (
              <div className="llm-warning"><AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{settings.llmProvider} not reachable. Check Settings</div>
            )}
            {assessingCount > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gold)' }}>
                <div className="spinner" style={{ width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }} />
                Assessing {assessingCount} job{assessingCount > 1 ? 's' : ''}…
                {assessedCount > 0 && ` (${assessedCount}/${jobs.length} done)`}
              </div>
            )}
            <button className="llm-settings-link" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Change LLM or API keys →
            </button>
          </div>

          {/* Search Filters */}
          <div>
            <div className="sidebar-section-title">Search Filters</div>

            {/* Keywords */}
            <div className="filter-group">
              <div className="filter-label">Keywords</div>
              <div className="keyword-chips">
                {keywords.map(k => {
                  const isLong = k.split(' ').length > 2 || k.length > 25;
                  return (
                    <div key={k} className={`keyword-chip${isLong ? ' kw-warn' : ''}`} title={isLong ? 'Long phrases may return fewer results' : undefined}>
                      {k}
                      <button onClick={() => removeKeyword(k)}>×</button>
                    </div>
                  );
                })}
                {keywords.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-filled from résumé</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  className="config-input" style={{ flex: 1 }}
                  placeholder="python, react, sql…"
                  value={newKeyword}
                  onChange={e => setNewKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addKeyword()}
                />
                <button className="add-kw-btn" onClick={() => addKeyword()}>+</button>
              </div>
              {newKeyword.split(' ').length > 2 && (
                <div style={{ fontSize: 11, color: '#f5a623', marginTop: 4, lineHeight: 1.4 }}>
                  <AlertTriangle size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />Use short keywords (e.g. python, react). Long phrases may return no results.
                </div>
              )}

              {/* AI Keyword Tools */}
              {keywords.length > 0 && llmStatus === 'green' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    className="export-btn"
                    style={{ flex: 1 }}
                    onClick={fetchSuggestions}
                    disabled={loadingSuggestions}
                  >
                    {loadingSuggestions
                      ? <><div className="spinner" style={{ width: 8, height: 8 }} /> Loading…</>
                      : 'Suggest related'}
                  </button>
                  <button
                    className="export-btn"
                    style={{ flex: 1 }}
                    onClick={fetchTranslations}
                    disabled={loadingTranslations}
                  >
                    {loadingTranslations
                      ? <><div className="spinner" style={{ width: 8, height: 8 }} /> Loading…</>
                      : <><Globe size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Translate PT</>}
                  </button>
                </div>
              )}

              {/* Suggested keywords */}
              {suggestions.length > 0 && (
                <div className="suggestion-chips">
                  {suggestions.map(s => (
                    <button key={s} className="suggestion-chip" onClick={() => addKeyword(s)}>+ {s}</button>
                  ))}
                </div>
              )}

              {/* Translated keywords */}
              {translations.length > 0 && (
                <div className="translate-chips">
                  {translations.map(t => (
                    <button key={t} className="translate-chip" onClick={() => addKeyword(t)}>+ {t}</button>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                Tip: atomic keywords work best, e.g. <em>python</em>, <em>sql</em>, <em>figma</em>
              </div>
            </div>

            {/* Location */}
            <div className="filter-group" style={{ marginTop: 14 }}>
              <div className="filter-label">Location</div>
              <LocationSelect value={location} onChange={setLocation} />
            </div>

            {/* Job Type */}
            <div className="filter-group" style={{ marginTop: 14 }}>
              <div className="filter-label">Job Type</div>
              <CustomSelect
                value={jobType}
                onChange={v => setJobType(v)}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'fulltime', label: 'Full-time' },
                  { value: 'parttime', label: 'Part-time' },
                  { value: 'contract', label: 'Contract' },
                ]}
              />
            </div>

            {/* Job Boards */}
            <div className="filter-group" style={{ marginTop: 14 }}>
              <div className="filter-label">Job Boards</div>
              <div className="site-pills">
                {ALL_SITES.map(site => (
                  <button
                    key={site}
                    type="button"
                    className={`site-pill${activeSites.includes(site) ? ' active' : ''}`}
                    onClick={() => toggleSite(site)}
                  >
                    {site.replace('_', ' ')}
                  </button>
                ))}
              </div>
              {activeSites.length === 0 && (
                <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>Select at least one board</div>
              )}
            </div>

            {/* Results count */}
            <div className="filter-group" style={{ marginTop: 14 }}>
              <div className="filter-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Results per search</span>
                <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>{resultsWanted}</span>
              </div>
              <div className="range-slider-container">
                <input
                  type="range" min={5} max={50} step={5}
                  className="range-slider"
                  value={resultsWanted}
                  onChange={e => setResultsWanted(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg, var(--gold) 0%, var(--gold) ${((resultsWanted - 5) / 45) * 100}%, var(--bg3) ${((resultsWanted - 5) / 45) * 100}%, var(--bg3) 100%)`
                  }}
                />
                <div className="range-ticks">
                  <span>5</span>
                  <span>15</span>
                  <span>25</span>
                  <span>35</span>
                  <span>50</span>
                </div>
              </div>
            </div>
          </div>

          <button
            className="search-btn"
            onClick={handleSearch}
            disabled={jobSearch.isPending || keywords.length === 0 || activeSites.length === 0}
          >
            {jobSearch.isPending
              ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Fetching jobs…</>
              : <><SearchIcon size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />Search Jobs</>}
          </button>

          {keywords.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: -12 }}>
              Add at least one keyword or upload a résumé
            </div>
          )}

          {/* Search History */}
          {searchHistory.length > 0 && (
            <div className="search-history">
              <div className="search-history-title">
                <span>Recent Searches</span>
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}
                  onClick={() => { localStorage.removeItem(HISTORY_KEY); setSearchHistory([]); }}
                >
                  Clear
                </button>
              </div>
              <div className="history-list">
                {searchHistory.slice(0, 5).map((h, i) => (
                  <div key={i} className="history-item" onClick={() => restoreSearch(h)}>
                    <span className="history-item-keywords">{h.keywords.join(', ')}</span>
                    <span className="history-item-meta">{h.location}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="main-content">

          {/* ── Tab switcher ── */}
          <div className="main-tabs">
            <button
              className={`main-tab${activeTab === 'search' ? ' active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              <SearchIcon size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Search Results
              {jobs.length > 0 && <span className="tab-badge">{sortedJobs.length}</span>}
            </button>
            <button
              className={`main-tab${activeTab === 'saved' ? ' active' : ''}`}
              onClick={() => setActiveTab('saved')}
            >
              <Bookmark size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Saved Jobs
              {Object.keys(bookmarks).length > 0 && (
                <span className="tab-badge">{Object.keys(bookmarks).length}</span>
              )}
            </button>
          </div>

          {/* ── Saved Jobs tracking panel ── */}
          {activeTab === 'saved' && (() => {
            const allSaved = Object.values(bookmarks);
            const STATUS_COLS: { key: BookmarkStatus; label: string; icon: React.ReactNode; color: string }[] = [
              { key: 'saved',     label: 'Saved',     icon: <Bookmark size={12} />,  color: '#a78bfa' },
              { key: 'applied',   label: 'Applied',   icon: <FileDown size={12} />,  color: '#60a5fa' },
              { key: 'interview', label: 'Interview', icon: <Star size={12} />,      color: '#fbbf24' },
              { key: 'offer',     label: 'Offer',     icon: <Rocket size={12} />,    color: '#4ade80' },
              { key: 'rejected',  label: 'Rejected',  icon: <X size={12} />,         color: '#f87171' },
            ];
            if (allSaved.length === 0) {
              return (
                <div className="empty-state" style={{ marginTop: 60 }}>
                  <div className="empty-icon"><Bookmark size={36} strokeWidth={1.2} /></div>
                  <div className="empty-title">No saved jobs yet</div>
                  <div className="empty-sub">Save jobs from search results to track your applications here.</div>
                </div>
              );
            }
            return (
              <div className="tracking-board">
                {/* Summary bar */}
                <div className="tracking-summary">
                  {STATUS_COLS.map(col => {
                    const count = allSaved.filter(b => b.status === col.key).length;
                    return count > 0 ? (
                      <div key={col.key} className="tracking-summary-pill" style={{ borderColor: col.color }}>
                        <span style={{ color: col.color }}>{col.icon}</span>
                        <span>{col.label}</span>
                        <span className="tracking-summary-count" style={{ background: col.color }}>{count}</span>
                      </div>
                    ) : null;
                  })}
                  <button
                    className="export-btn"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                      const rows = allSaved.map(b => [
                        `"${(b.job.title || '').replace(/"/g, '""')}"`,
                        `"${(b.job.company || '').replace(/"/g, '""')}"`,
                        b.status,
                        b.job.site,
                        `"${(b.job.salary_range || '').replace(/"/g, '""')}"`,
                        b.assessment?.match_score ?? '',
                        b.savedAt.slice(0, 10),
                        b.job.url,
                      ].join(','));
                      const csv = 'Title,Company,Status,Site,Salary,Score,Saved,URL\n' + rows.join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'jumpship-saved.csv'; a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <FileText size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Export CSV
                  </button>
                </div>

                {/* Columns */}
                <div className="tracking-columns">
                  {STATUS_COLS.map(col => {
                    const colJobs = allSaved.filter(b => b.status === col.key);
                    return (
                      <div key={col.key} className="tracking-col">
                        <div className="tracking-col-header" style={{ borderTopColor: col.color }}>
                          <span style={{ color: col.color }}>{col.icon}</span>
                          <span>{col.label}</span>
                          <span className="tracking-col-count">{colJobs.length}</span>
                        </div>
                        <div className="tracking-col-body">
                          {colJobs.length === 0 && (
                            <div className="tracking-empty-col">-</div>
                          )}
                          {colJobs.map(b => (
                            <div key={b.job.id} className="tracking-card">
                              <div className="tracking-card-title">{b.job.title}</div>
                              <div className="tracking-card-company">{b.job.company}</div>
                              {b.job.location && (
                                <div className="tracking-card-location">{b.job.location}</div>
                              )}
                              <div className="tracking-card-meta">
                                {b.job.site && <span className="tag">{b.job.site}</span>}
                                {b.job.salary_range && <span className="tag salary"><Banknote size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />{b.job.salary_range}</span>}
                                {b.assessment?.match_score != null && (
                                  <span className="tag" style={{ color: 'var(--gold)' }}>
                                    <Star size={10} style={{ verticalAlign: 'middle', marginRight: 2 }} />{b.assessment.match_score}%
                                  </span>
                                )}
                              </div>
                              <div className="tracking-card-saved">
                                Saved {new Date(b.savedAt).toLocaleDateString()}
                              </div>
                              <div className="tracking-card-actions">
                                <select
                                  className="bookmark-status-select"
                                  value={b.status}
                                  onChange={e => handleBookmark(b.job.id, b.job, e.target.value as BookmarkStatus)}
                                >
                                  <option value="saved">☆ Saved</option>
                                  <option value="applied">📨 Applied</option>
                                  <option value="interview">🎯 Interview</option>
                                  <option value="offer">🎉 Offer</option>
                                  <option value="rejected">✕ Rejected</option>
                                </select>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {b.job.url && (
                                    <a
                                      href={b.job.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="apply-btn"
                                      style={{ textDecoration: 'none', padding: '4px 10px', fontSize: 11 }}
                                    >
                                      View →
                                    </a>
                                  )}
                                  <button
                                    className="apply-btn"
                                    style={{ background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', padding: '4px 10px', fontSize: 11 }}
                                    onClick={() => handleBookmark(b.job.id, b.job, null)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}


          {activeTab === 'search' && (<>
          {searchPipelineBusy ? (
            <>
              <div className="results-header">
                <div className="results-title">
                  {jobSearch.isPending ? 'Searching job boards…' : 'Evaluating your fit…'}
                </div>
              </div>
              <AssessmentLoader
                fetching={jobSearch.isPending}
                total={jobSearch.isPending ? Math.max(resultsWanted, 1) : totalJobCount}
                assessed={assessedCount}
              />
            </>
          ) : !jobSearch.data ? (
            <div className="empty-state">
              <div className="empty-icon"><Rocket size={36} strokeWidth={1.2} /></div>
              <div className="empty-title">Ready to launch your search</div>
              <div className="empty-sub">
                {resumeProfile
                  ? 'Keywords extracted. Hit Search to find matching jobs.'
                  : 'Upload your résumé to let the AI find the best matches.'}
              </div>
            </div>
          ) : (
            <>
              <div className="results-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div className="results-title">Results</div>
                  <div className="results-count">{sortedJobs.length} jobs</div>
                  {filteredCount > 0 && (
                    <button
                      className={`filter-pill${showHidden ? ' active' : ''}`}
                      onClick={() => setShowHidden(v => !v)}
                    >
                      {showHidden ? <><X size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />Hide</> : <Eye size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />} {filteredCount} unrelated
                    </button>
                  )}
                  {/* Bookmark filter */}
                  {bookmarkCount > 0 && (
                    <button
                      className={`filter-pill${showBookmarksOnly ? ' active' : ''}`}
                      onClick={() => setShowBookmarksOnly(v => !v)}
                    >
                      <Bookmark size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />{bookmarkCount} saved
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Export buttons */}
                  {sortedJobs.length > 0 && (
                    <div className="export-actions">
                      <button className="export-btn" onClick={() => exportCSV(sortedJobs, assessments)}>
                        <FileText size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />CSV
                      </button>
                      <button className="export-btn" onClick={() => exportJSON(sortedJobs, assessments)}>
                        <FileDown size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />JSON
                      </button>
                    </div>
                  )}
                  <CustomSelect
                    className="sort-select-cs"
                    style={{ minWidth: 160 }}
                    value={sortBy}
                    onChange={v => setSortBy(v as SortOption)}
                    options={[
                      { value: 'match', label: 'Sort: Best Match' },
                      { value: 'newest', label: 'Sort: Newest' },
                      { value: 'salary', label: 'Sort: Salary' },
                    ]}
                  />
                </div>
              </div>

              <div className="jobs-list">
                {paginatedJobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    resumeProfile={resumeProfile}
                    llmConfig={llmConfig}
                    keywords={keywords}
                    assessment={assessments[job.id]}
                    assessing={assessingIds.has(job.id)}
                    onReassess={() => handleReassess(job)}
                    bookmarkStatus={bookmarks[job.id]?.status}
                    onBookmark={(status) => handleBookmark(job.id, job, status)}
                    onGenerateResume={resumeProfile ? () => handleGenerateResume(job) : undefined}
                    generatingResume={generatingResumeJobId === job.id}
                  />
                ))}
              </div>

              {/* Load More */}
              {hasMore && (
                <div className="load-more-container">
                  <button
                    className="load-more-btn"
                    onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                  >
                    Show more ({sortedJobs.length - visibleCount} remaining)
                  </button>
                </div>
              )}

              {/* Hidden (unrelated) jobs section */}
              {showHidden && hiddenJobs.length > 0 && (
                <div className="hidden-jobs-section">
                  <div className="hidden-jobs-header">
                    <span>Unrelated Jobs</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                      These were flagged by the AI as outside your professional field
                    </span>
                  </div>
                  <div className="jobs-list">
                    {hiddenJobs.map(job => (
                      <JobCard
                        key={job.id}
                        job={job}
                        resumeProfile={resumeProfile}
                        llmConfig={llmConfig}
                        keywords={keywords}
                        assessment={assessments[job.id]}
                        assessing={assessingIds.has(job.id)}
                        onReassess={() => handleReassess(job)}
                        bookmarkStatus={bookmarks[job.id]?.status}
                        onBookmark={(status) => handleBookmark(job.id, job, status)}
                        onGenerateResume={resumeProfile ? () => handleGenerateResume(job) : undefined}
                    generatingResume={generatingResumeJobId === job.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!resumeProfile && jobs.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon"><SearchIcon size={36} strokeWidth={1.2} /></div>
                  <div className="empty-title">No jobs found</div>
                  <div className="empty-sub">Try adjusting your keywords or location.</div>
                </div>
              )}
            </>
          )}
          </>)}
        </main>
      </div>
    </div>
  );
}
