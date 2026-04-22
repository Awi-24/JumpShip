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
  llm_provider?: string;
  llm_model?: string;
  llm_api_key?: string;
  llm_base_url?: string;
}

export interface JobResult {
  id: string;
  title: string;
  company: string;
  company_url?: string;
  location: string;
  job_type: string;
  salary_range: string;
  posted_date: string;
  description: string;
  url: string;
  site: string;
  match_score?: number | null;
  is_remote?: boolean | null;
  tags?: string[];
}

export interface AssessmentRequest {
  job: JobResult;
  resume_profile: ResumeProfile;
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
  company_insights?: string;
  income_range?: string;
  is_relevant?: boolean;
  job_tags?: string[];
  keywords_matched?: string[];
  keywords_missing?: string[];
  resume_generation_triggered?: boolean;
}

export interface GenerateResumeRequest {
  job: JobResult;
  resume_profile: ResumeProfile;
  assessment?: Record<string, unknown>;
  llm_provider?: string;
  llm_model?: string;
  llm_api_key?: string;
  llm_base_url?: string;
}

export interface GeneratedResumeItem {
  id: string;
  job_title: string;
  company: string;
  match_score: number;
  provider: string;
  model: string;
  pdf_path: string;
  created_at: string;
}

export interface HealthStatus {
  status: string;
  llm_provider: string;
  llm_model: string;
  llm_available: boolean;
}

export type LLMProvider =
  | 'ollama'
  | 'lmstudio'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'gemini'
  | 'mistral'
  | 'deepseek'
  | 'huggingface'
  | 'openrouter'
  | 'cohere';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  api_key?: string;
}

export type SortOption = 'match' | 'newest' | 'salary';
export type JobTypeFilter = 'all' | 'fulltime' | 'parttime' | 'contract' | 'remote';
export type AssessmentSpeed = 'careful' | 'balanced' | 'turbo';
export type BookmarkStatus = 'saved' | 'applied' | 'interview' | 'rejected' | 'offer';

export interface BookmarkedJob {
  job: JobResult;
  status: BookmarkStatus;
  savedAt: string;
  assessment?: JobAssessment;
}

// ─── Model Discovery ─────────────────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  name: string;
  size_gb?: number | null;
  family?: string | null;
}

export interface DiscoveredProvider {
  id: string;
  name: string;
  reachable: boolean;
  base_url: string;
  models: DiscoveredModel[];
}

export interface DiscoverResponse {
  providers: DiscoveredProvider[];
  active_provider?: string | null;
  active_model?: string | null;
}
