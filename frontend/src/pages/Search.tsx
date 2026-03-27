import { useState, useCallback, useEffect } from 'react';
import ResumeUpload from '../components/ResumeUpload';
import JobCard from '../components/JobCard';
import SettingsModal from '../components/SettingsModal';
import { useResumeParse } from '../hooks/useResume';
import { useJobSearch } from '../hooks/useJobs';
import { useSettings } from '../hooks/useSettings';
import type { ResumeProfile, SortOption } from '../types';

interface SearchProps {
  onBack: () => void;
}

export default function Search({ onBack }: SearchProps) {
  const { settings, saveSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmStatus, setLlmStatus] = useState<'green' | 'yellow' | 'red'>('yellow');

  // Resume
  const resumeMutation = useResumeParse();
  const [resumeProfile, setResumeProfile] = useState<ResumeProfile | null>(null);

  // Search filters (pre-populated from settings + resume)
  const [keywords, setKeywords] = useState<string[]>([]);
  const [location, setLocation] = useState(settings.defaultLocation);
  const [jobType, setJobType] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('match');
  const [newKeyword, setNewKeyword] = useState('');
  const [activeSites, setActiveSites] = useState<string[]>(settings.defaultSites);

  const ALL_SITES = ['linkedin', 'indeed', 'glassdoor', 'zip_recruiter'];

  const toggleSite = (site: string) => {
    setActiveSites(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site]
    );
  };

  const jobSearch = useJobSearch();

  // Poll health / LLM status
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
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [settings.llmProvider]);

  const handleResumeUpload = useCallback(async (file: File) => {
    const apiKey =
      settings.llmProvider === 'openai'    ? settings.openaiKey :
      settings.llmProvider === 'anthropic' ? settings.anthropicKey :
      settings.llmProvider === 'groq'      ? settings.groqKey : '';

    const profile = await resumeMutation.mutateAsync({
      file,
      llmProvider: settings.llmProvider,
      llmModel:    settings.llmModel    || undefined,
      llmBaseUrl:  settings.ollamaUrl   || undefined,
      llmApiKey:   apiKey               || undefined,
    });
    setResumeProfile(profile);
    if (profile.suggested_keywords?.length) setKeywords(profile.suggested_keywords);
    if (!location && settings.defaultLocation) setLocation(settings.defaultLocation);
    else if (!location) setLocation('Remote');
  }, [resumeMutation, location, settings]);

  const handleSearch = () => {
    jobSearch.mutate({
      keywords,
      location,
      job_type: jobType === 'all' ? 'fulltime' : jobType,
      sites: activeSites.length > 0 ? activeSites : settings.defaultSites,
      results_wanted: settings.resultsWanted,
      resume_profile: resumeProfile,
      // LLM config passed per-request
      llm_provider: settings.llmProvider,
      llm_model: settings.llmModel,
      llm_api_key:
        settings.llmProvider === 'openai'    ? settings.openaiKey :
        settings.llmProvider === 'anthropic' ? settings.anthropicKey :
        settings.llmProvider === 'groq'      ? settings.groqKey : '',
      llm_base_url: settings.ollamaUrl,
    });
  };

  const removeKeyword = (kw: string) => setKeywords(k => k.filter(x => x !== kw));
  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (kw && !keywords.includes(kw)) setKeywords(k => [...k, kw]);
    setNewKeyword('');
  };

  const jobs = jobSearch.data || [];
  const sortedJobs = [...jobs].sort((a, b) => {
    if (sortBy === 'match') return (b.match_score ?? 0) - (a.match_score ?? 0);
    return 0;
  });

  const statusLabel =
    llmStatus === 'green' ? `${settings.llmProvider} · ${settings.llmModel}` :
    llmStatus === 'yellow' ? 'Connecting...' : 'LLM offline';

  return (
    <div className="search-page">
      {/* ── HEADER ── */}
      <header className="search-header">
        <div className="search-logo" onClick={onBack}>
          JUMP<span>SHIP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="llm-status">
            <span className={`status-dot ${llmStatus}`} />
            {statusLabel}
          </div>
          <button
            className="settings-trigger"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            ⚙ Settings
          </button>
        </div>
      </header>

      {/* ── SETTINGS MODAL ── */}
      <SettingsModal
        open={settingsOpen}
        initial={settings}
        onSave={saveSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <div className="search-body">
        {/* ── SIDEBAR ── */}
        <aside className="sidebar">

          {/* Resume */}
          <div>
            <div className="sidebar-section-title">Résumé</div>
            <ResumeUpload
              profile={resumeProfile}
              isLoading={resumeMutation.isPending}
              onUpload={handleResumeUpload}
            />
          </div>

          {/* LLM Status (compact) */}
          <div className="llm-status-card">
            <div className="llm-status-row">
              <span className={`status-dot ${llmStatus}`} />
              <span className="llm-status-text">
                {settings.llmProvider === 'ollama' || settings.llmProvider === 'lmstudio' || settings.llmProvider === 'openclaw'
                  ? `${settings.llmProvider} · local`
                  : `${settings.llmProvider} · cloud`}
              </span>
            </div>
            <div className="llm-status-model">{settings.llmModel}</div>
            {llmStatus === 'red' && (
              <div className="llm-warning">
                ⚠ {settings.llmProvider} not reachable — check Settings
              </div>
            )}
            {llmStatus === 'yellow' && settings.llmProvider !== 'ollama' && (
              <div className="llm-warning">
                ⚠ Add API key in Settings to use {settings.llmProvider}
              </div>
            )}
            <button
              className="llm-settings-link"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙ Change LLM or API keys →
            </button>
          </div>

          {/* Search Filters */}
          <div>
            <div className="sidebar-section-title">Search Filters</div>

            <div className="filter-group">
              <div className="filter-label">Keywords</div>
              <div className="keyword-chips">
                {keywords.map(k => (
                  <div key={k} className="keyword-chip">
                    {k}
                    <button onClick={() => removeKeyword(k)}>×</button>
                  </div>
                ))}
                {keywords.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Auto-filled from résumé
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  className="config-input"
                  style={{ flex: 1 }}
                  placeholder="Add keyword..."
                  value={newKeyword}
                  onChange={e => setNewKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addKeyword()}
                />
                <button
                  onClick={addKeyword}
                  style={{
                    padding: '0 12px',
                    background: 'var(--border-bright)',
                    border: 'none',
                    borderRadius: 8,
                    color: 'var(--gold)',
                    cursor: 'pointer',
                    fontSize: 16,
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <div className="filter-group" style={{ marginTop: 14 }}>
              <div className="filter-label">Location</div>
              <input
                className="config-input"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Remote, São Paulo..."
              />
            </div>

            <div className="filter-group" style={{ marginTop: 14 }}>
              <div className="filter-label">Job Type</div>
              <select
                className="config-select"
                value={jobType}
                onChange={e => setJobType(e.target.value)}
              >
                <option value="all">All Types</option>
                <option value="fulltime">Full-time</option>
                <option value="parttime">Part-time</option>
                <option value="contract">Contract</option>
              </select>
            </div>

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
                <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>
                  Select at least one board
                </div>
              )}
            </div>
          </div>

          <button
            className="search-btn"
            onClick={handleSearch}
            disabled={jobSearch.isPending || keywords.length === 0}
          >
            {jobSearch.isPending ? (
              <><div className="spinner" style={{ width: 14, height: 14 }} /> Fetching jobs...</>
            ) : (
              '🔍 Search Jobs'
            )}
          </button>

          {keywords.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: -12 }}>
              Add at least one keyword or upload a résumé
            </div>
          )}

        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="main-content">
          {!jobSearch.data && !jobSearch.isPending ? (
            <div className="empty-state">
              <div className="empty-icon">🚀</div>
              <div className="empty-title">Ready to launch your search</div>
              <div className="empty-sub">
                {resumeProfile
                  ? 'Keywords extracted from your résumé. Hit Search to find matching jobs.'
                  : 'Upload your résumé to let the AI find the best matches for you.'}
              </div>
            </div>
          ) : jobSearch.isPending ? (
            <>
              <div className="results-header">
                <div className="results-title">Searching...</div>
              </div>
              <div className="loading-jobs">
                {[1, 2, 3].map(i => (
                  <div key={i} className="skeleton" style={{ height: 100 - i * 8 }} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="results-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="results-title">Results</div>
                  <div className="results-count">{jobs.length} jobs found</div>
                </div>
                <select
                  className="sort-select"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortOption)}
                >
                  <option value="match">Sort: Best Match</option>
                  <option value="newest">Sort: Newest</option>
                  <option value="salary">Sort: Salary</option>
                </select>
              </div>

              <div className="jobs-list">
                {sortedJobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    resumeProfile={resumeProfile}
                    llmConfig={{
                      provider: settings.llmProvider,
                      model: settings.llmModel,
                      apiKey:
                        settings.llmProvider === 'openai'    ? settings.openaiKey :
                        settings.llmProvider === 'anthropic' ? settings.anthropicKey :
                        settings.llmProvider === 'groq'      ? settings.groqKey : '',
                      baseUrl: settings.ollamaUrl,
                    }}
                  />
                ))}
              </div>

              {jobs.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">🔭</div>
                  <div className="empty-title">No jobs found</div>
                  <div className="empty-sub">Try adjusting your keywords or location.</div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
