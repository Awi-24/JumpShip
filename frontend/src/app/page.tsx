"use client";

import { useCallback } from "react";
import { Job, jobsApi, api } from "@/lib/api";
import { usePersistedState } from "@/lib/usePersistedState";
import JobCard from "@/components/JobCard";
import JobDetailPanel from "@/components/JobDetailPanel";
import {
  Search,
  SlidersHorizontal,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Briefcase,
} from "lucide-react";
import clsx from "clsx";

const SITES_INTERNATIONAL = ["indeed", "linkedin", "glassdoor", "google", "zip_recruiter"];
const SITES_BRASIL = ["gupy", "catho", "vagas.com.br"];
const SITES = [...SITES_INTERNATIONAL, ...SITES_BRASIL];
const JOB_TYPES = ["fulltime", "parttime", "internship", "contract"];
const COUNTRIES = [
  { label: "Brasil", value: "brazil" },
  { label: "USA", value: "usa" },
  { label: "UK", value: "uk" },
  { label: "Canada", value: "canada" },
  { label: "Australia", value: "australia" },
  { label: "Germany", value: "germany" },
  { label: "France", value: "france" },
];

export default function HomePage() {
  const [searchTerm, setSearchTerm] = usePersistedState("search_term", "");
  const [location, setLocation] = usePersistedState("search_location", "");
  const [selectedSites, setSelectedSites] = usePersistedState<string[]>("search_sites", ["indeed"]);
  const [jobType, setJobType] = usePersistedState("search_job_type", "");
  const [isRemote, setIsRemote] = usePersistedState("search_is_remote", false);
  const [easyApply, setEasyApply] = usePersistedState<boolean | undefined>("search_easy_apply", undefined);
  const [resultsWanted, setResultsWanted] = usePersistedState("search_results", 20);
  const [hoursOld, setHoursOld] = usePersistedState<number | undefined>("search_hours_old", undefined);
  const [country, setCountry] = usePersistedState("search_country", "brazil");
  const [showFilters, setShowFilters] = usePersistedState("search_show_filters", false);
  const [jobs, setJobs] = usePersistedState<Job[]>("search_jobs", []);
  const [loading, setLoading] = usePersistedState("search_loading", false);
  const [error, setError] = usePersistedState<string | null>("search_error", null);
  const [searched, setSearched] = usePersistedState("search_searched", false);
  const [savedIds, setSavedIds] = usePersistedState<string[]>("search_saved_ids", []);
  const [selectedJobUrl, setSelectedJobUrl] = usePersistedState<string | null>("search_selected_job_url", null);

  const savedIdsSet = new Set(savedIds);
  const selectedJob = jobs.find((j) => j.job_url === selectedJobUrl) ?? null;

  const toggleSite = (site: string) => {
    setSelectedSites((prev) =>
      prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site]
    );
  };

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!searchTerm.trim()) return;
    if (selectedSites.length === 0) {
      setError("Selecione pelo menos um site de vagas.");
      return;
    }

    setLoading(true);
    setError(null);
    setJobs([]);
    setSelectedJobUrl(null);
    setSearched(true);

    try {
      const hasBrazilSites = selectedSites.some((s) => SITES_BRASIL.includes(s));
      const hasIntlSites = selectedSites.some((s) => SITES_INTERNATIONAL.includes(s));

      const allJobs: typeof jobs = [];

      // Search international sites
      if (hasIntlSites) {
        const intlSites = selectedSites.filter((s) => SITES_INTERNATIONAL.includes(s));
        const { data } = await jobsApi.search({
          sites: intlSites,
          search_term: searchTerm,
          location,
          is_remote: isRemote,
          job_type: jobType || undefined,
          easy_apply: easyApply,
          results_wanted: resultsWanted,
          country_indeed: country,
          hours_old: hoursOld,
        });
        allJobs.push(...data.jobs);
      }

      // Search Brazil sites
      if (hasBrazilSites) {
        const brazilSites = selectedSites.filter((s) => SITES_BRASIL.includes(s));
        const { data } = await api.post<{ jobs: Job[]; count: number }>("/api/jobs/brazil/search", {
          sites: brazilSites,
          search_term: searchTerm,
          location,
          results_wanted: resultsWanted,
        });
        allJobs.push(...data.jobs);
      }

      setJobs(allJobs);
      if (allJobs.length === 0) {
        setError("Nenhuma vaga encontrada. Tente ajustar os filtros.");
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err.response?.data?.detail ?? err.message ?? "Busca falhou. Verifique se o backend está rodando.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(job: Job) {
    try {
      const loc =
        typeof job.location === "object" && job.location
          ? job.location
          : { city: undefined, state: undefined, country: undefined };

      await jobsApi.save({
        title: job.title,
        company_name: job.company_name,
        job_url: job.job_url,
        job_url_direct: job.job_url_direct,
        location_city: loc.city,
        location_state: loc.state,
        location_country: typeof job.location === "string" ? job.location : loc.country,
        description: job.description,
        job_type: job.job_type,
        is_remote: job.is_remote,
        min_salary: job.min_salary,
        max_salary: job.max_salary,
        salary_interval: job.salary_interval,
        currency: job.currency,
        site: job.site,
        company_industry: job.company_industry,
        job_level: job.job_level,
        company_logo: job.company_logo,
        date_posted: job.date_posted,
        easy_apply: !!(job.easy_apply || (job as Record<string, unknown>).easy_apply),
        raw_data: job as Record<string, unknown>,
      });
      setSavedIds((prev) => Array.from(new Set([...prev, job.job_url ?? ""])));
    } catch {
      setSavedIds((prev) => Array.from(new Set([...prev, job.job_url ?? ""])));
    }
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-5rem)]">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-taupe-400" />
          <input
            type="text"
            placeholder="Cargo, habilidades, palavras-chave…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-taupe-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-coral focus:border-transparent shadow-sm"
          />
        </div>
        <input
          type="text"
          placeholder="Localização (cidade, estado)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="sm:w-56 px-4 py-2.5 bg-white border border-taupe-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-coral focus:border-transparent shadow-sm"
        />
        <button
          type="submit"
          disabled={loading || !searchTerm.trim()}
          className="flex items-center gap-2 bg-coral hover:bg-coral-600 disabled:opacity-60 text-white font-medium px-5 py-2.5 rounded-xl transition-colors text-sm shadow-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            "flex items-center gap-2 border px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm",
            showFilters
              ? "border-coral bg-coral-50 text-coral"
              : "border-taupe-200 bg-white text-gray-600 hover:border-taupe-400"
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filtros
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </form>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white border border-taupe-100 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm shadow-sm">
          {/* Sites */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-4">
            <label className="block text-xs font-semibold text-taupe-500 mb-3 uppercase tracking-wide">Sites</label>
            <div className="space-y-3">
              {/* International Sites */}
              <div>
                <p className="text-xs text-taupe-400 font-medium mb-2">Internacional</p>
                <div className="flex flex-wrap gap-2">
                  {SITES_INTERNATIONAL.map((site) => (
                    <button
                      key={site}
                      type="button"
                      onClick={() => toggleSite(site)}
                      className={clsx(
                        "px-3 py-1.5 rounded-full border text-xs font-medium transition-all capitalize",
                        selectedSites.includes(site)
                          ? "border-coral bg-coral text-white shadow-sm"
                          : "border-taupe-200 text-gray-600 hover:border-coral hover:text-coral bg-white"
                      )}
                    >
                      {site.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              {/* Brazil Sites */}
              <div>
                <p className="text-xs text-taupe-400 font-medium mb-2">Brasil</p>
                <div className="flex flex-wrap gap-2">
                  {SITES_BRASIL.map((site) => (
                    <button
                      key={site}
                      type="button"
                      onClick={() => toggleSite(site)}
                      className={clsx(
                        "px-3 py-1.5 rounded-full border text-xs font-medium transition-all capitalize",
                        selectedSites.includes(site)
                          ? "border-coral bg-coral text-white shadow-sm"
                          : "border-taupe-200 text-gray-600 hover:border-coral hover:text-coral bg-white"
                      )}
                    >
                      {site.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Job Type */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">Tipo</label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            >
              <option value="">Qualquer</option>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t} className="capitalize">{t}</option>
              ))}
            </select>
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">País (Indeed)</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            >
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Results wanted */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">
              Resultados por site: <span className="text-coral">{resultsWanted}</span>
            </label>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={resultsWanted}
              onChange={(e) => setResultsWanted(Number(e.target.value))}
              className="w-full accent-coral"
            />
          </div>

          {/* Hours old */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">Publicado em</label>
            <select
              value={hoursOld ?? ""}
              onChange={(e) => setHoursOld(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            >
              <option value="">Qualquer período</option>
              <option value="24">Últimas 24h</option>
              <option value="72">Últimos 3 dias</option>
              <option value="168">Última semana</option>
              <option value="720">Último mês</option>
            </select>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRemote}
                onChange={(e) => setIsRemote(e.target.checked)}
                className="w-4 h-4 accent-coral"
              />
              <span className="text-sm text-gray-700">Apenas remoto</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={easyApply === true}
                onChange={(e) => setEasyApply(e.target.checked ? true : undefined)}
                className="w-4 h-4 accent-coral"
              />
              <span className="text-sm text-gray-700">Easy Apply</span>
            </label>
          </div>
        </div>
      )}

      {/* Results area */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Job List */}
        <div className={clsx("flex flex-col gap-2.5 overflow-y-auto", selectedJob ? "hidden lg:flex lg:w-2/5" : "w-full")}>
          {loading && (
            <div className="flex items-center justify-center gap-3 py-16 text-taupe-500">
              <Loader2 className="w-5 h-5 animate-spin text-coral" />
              <span className="text-sm">Buscando vagas…</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && !searched && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-taupe-400 gap-4">
              <div className="w-20 h-20 rounded-2xl bg-white border border-taupe-100 flex items-center justify-center shadow-sm">
                <Briefcase className="w-9 h-9 text-coral opacity-60" />
              </div>
              <div>
                <p className="font-semibold text-gray-700">Comece sua busca</p>
                <p className="text-sm mt-1 text-taupe-500">Digite um cargo ou palavras-chave acima</p>
              </div>
            </div>
          )}

          {!loading && jobs.length > 0 && (
            <div className="flex items-center justify-between text-xs text-taupe-500 px-1 mb-1">
              <span className="font-medium">{jobs.length} vagas encontradas</span>
              <button
                onClick={() => handleSearch()}
                className="flex items-center gap-1 hover:text-coral transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Atualizar
              </button>
            </div>
          )}

          {jobs.map((job, idx) => (
            <JobCard
              key={job.job_url ?? idx}
              job={job}
              saved={savedIdsSet.has(job.job_url ?? "")}
              onSave={handleSave}
              onSelect={(j) => setSelectedJobUrl(j.job_url ?? null)}
              selected={selectedJobUrl === job.job_url}
            />
          ))}
        </div>

        {/* Detail Panel — só aparece após uma busca ter sido realizada */}
        {searched && (
          <div className={clsx("flex-1 min-h-0", selectedJob ? "block" : "hidden lg:block")}>
            <JobDetailPanel
              job={selectedJob}
              onClose={() => setSelectedJobUrl(null)}
              savedIds={savedIdsSet}
              onSave={handleSave}
            />
          </div>
        )}
      </div>
    </div>
  );
}
