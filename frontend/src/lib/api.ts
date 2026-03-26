import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface Job {
  id?: string;
  title: string;
  company_name?: string;
  job_url: string;
  job_url_direct?: string;
  location?: { city?: string; state?: string; country?: string } | string;
  description?: string;
  job_type?: string;
  is_remote?: boolean;
  min_salary?: number;
  max_salary?: number;
  salary_interval?: string;
  currency?: string;
  site?: string;
  company_industry?: string;
  job_level?: string;
  company_logo?: string;
  date_posted?: string;
  easy_apply?: boolean;
  saved_at?: string;
  // raw fields from scrape_jobs DataFrame
  [key: string]: unknown;
}

export interface Resume {
  id: string;
  filename: string;
  content: string;
  char_count: number;
  uploaded_at: string;
}

export interface Analysis {
  id: string;
  job_id: string;
  resume_id: string;
  job_title?: string;
  company_name?: string;
  score: number;
  summary?: string;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  keywords_matched?: string[];
  keywords_missing?: string[];
  has_tailored_resume: boolean;
  analyzed_at: string;
}

export interface Application {
  id: string;
  job_id?: string;
  job_title: string;
  company_name?: string;
  job_url?: string;
  site?: string;
  status: string;
  is_easy_apply: boolean;
  notes?: string;
  analysis_id?: string;
  applied_at?: string;
  created_at: string;
}

// ── Jobs API ─────────────────────────────────────────────────────────────────

export const jobsApi = {
  search: (params: Record<string, unknown>) =>
    api.post<{ jobs: Job[]; count: number }>("/api/jobs/search", params),

  save: (job: Partial<Job>) =>
    api.post<{ id: string; already_existed: boolean }>("/api/jobs/save", job),

  getSaved: (filters?: { site?: string; is_remote?: boolean }) =>
    api.get<{ jobs: Job[]; count: number }>("/api/jobs/saved", { params: filters }),

  getById: (id: string) =>
    api.get<Job>(`/api/jobs/saved/${id}`),

  delete: (id: string) =>
    api.delete(`/api/jobs/saved/${id}`),
};

// ── Resume API ────────────────────────────────────────────────────────────────

export const resumeApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<{ id: string; filename: string; char_count: number; preview: string }>(
      "/api/resume/upload",
      form,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  },

  get: () => api.get<Resume>("/api/resume"),

  delete: () => api.delete("/api/resume"),
};

// ── Analysis API ───────────────────────────────────────────────────────────────

export const analysisApi = {
  analyse: (params: {
    job_id?: string;
    job_title?: string;
    company_name?: string;
    job_description?: string;
  }) => api.post<Analysis>("/api/analysis", params),

  getByJob: (jobId: string) => api.get<Analysis>(`/api/analysis/job/${jobId}`),

  getById: (id: string) => api.get<Analysis>(`/api/analysis/${id}`),

  generateTailored: (analysisId: string) =>
    api.post<{ analysis_id: string; tailored_resume: string }>(
      "/api/analysis/tailored-resume",
      { analysis_id: analysisId }
    ),
};

// ── Applications API ───────────────────────────────────────────────────────────

export const applicationsApi = {
  list: (status?: string) =>
    api.get<{ applications: Application[]; count: number }>("/api/applications", {
      params: status ? { status } : {},
    }),

  create: (data: Partial<Application> & { job_id?: string }) =>
    api.post<{ id: string; already_existed: boolean }>("/api/applications", data),

  updateStatus: (id: string, status: string, notes?: string) =>
    api.put<Application>(`/api/applications/${id}/status`, { status, notes }),

  delete: (id: string) => api.delete(`/api/applications/${id}`),

  stats: () =>
    api.get<{ total: number; by_status: Record<string, number> }>(
      "/api/applications/stats/summary"
    ),
};

// ── Concursos API ──────────────────────────────────────────────────────────────

export interface Concurso {
  id?: string;
  titulo: string;
  orgao: string;
  banca: string;
  estado: string;
  vagas: number;
  salario_minimo?: number;
  salario_maximo?: number;
  status: "Aberto" | "Previsto" | "Encerrado";
  data_inscricao_inicio?: string;
  data_inscricao_fim?: string;
  url: string;
}

export const concursosApi = {
  search: (params: {
    estado?: string;
    nivel?: string;
    area?: string;
    salario_minimo?: number;
    apenas_abertos?: boolean;
    banca?: string;
    orgao?: string;
  }) =>
    api.post<{ concursos: Concurso[]; count: number }>("/api/concursos/search", params),

  getEstados: () =>
    api.get<string[]>("/api/concursos/estados"),

  getAreas: () =>
    api.get<string[]>("/api/concursos/areas"),

  getBancas: () =>
    api.get<string[]>("/api/concursos/bancas"),
};
