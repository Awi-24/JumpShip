// ─── JumpShip Types ─────────────────────────────────────────────────────────

export interface ResumeProfile {
  name: string;
  title: string;
  skills: string[];
  experience_years: number;
  domains: string[];
  suggested_keywords: string[];
  suggested_titles: string[];
  raw_text: string;
}

export interface JobSearchRequest {
  keywords: string[];
  location: string;
  job_type: string;
  sites: string[];
  results_wanted: number;
  resume_profile?: ResumeProfile | null;
  // Per-request LLM config (overrides backend .env)
  llm_provider?: string;
  llm_model?: string;
  llm_api_key?: string;
  llm_base_url?: string;
}

export interface JobResult {
  id: string;
  title: string;
  company: string;
  location: string;
  job_type: string;
  salary_range: string;
  posted_date: string;
  description: string;
  url: string;
  site: string;
  match_score?: number | null;
}

export interface AssessmentRequest {
  job: JobResult;
  resume_profile: ResumeProfile;
  // Per-request LLM config
  llm_provider?: string;
  llm_model?: string;
  llm_api_key?: string;
  llm_base_url?: string;
}

export interface JobAssessment {
  match_score: number;
  summary: string;
  strong_points: string[];
  gaps: string[];
  career_suggestions: string[];
}

export interface HealthStatus {
  status: string;
  llm_provider: string;
  llm_model: string;
  llm_available: boolean;
}

export type LLMProvider = 'ollama' | 'openclaw' | 'lmstudio' | 'openai' | 'anthropic' | 'groq';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  api_key?: string;
}

export type SortOption = 'match' | 'newest' | 'salary';
export type JobTypeFilter = 'all' | 'fulltime' | 'parttime' | 'contract' | 'remote';
