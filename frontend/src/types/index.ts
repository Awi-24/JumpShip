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
  company_url?: string;
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
  company_insights?: string;
  income_range?: string;
  is_relevant?: boolean;
  job_tags?: string[];
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

export type AssessmentSpeed = 'careful' | 'balanced' | 'turbo';

export type BookmarkStatus = 'saved' | 'applied' | 'interview' | 'rejected' | 'offer';

export interface BookmarkedJob {
  job: JobResult;
  status: BookmarkStatus;
  savedAt: string;
  assessment?: JobAssessment;
}

// ── User Profile ──────────────────────────────────────────────────────────────

export interface WorkExperience {
  company: string;
  title: string;
  start_date: string;
  end_date: string;
  current: boolean;
  description: string;
  location: string;
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  start_date: string;
  end_date: string;
  gpa: string;
}

export interface CustomQA {
  question: string;
  answer: string;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zip_code: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  professional_summary: string;
  current_title: string;
  years_experience: number;
  skills: string[];
  work_experience: WorkExperience[];
  education: Education[];
  expected_salary: string;
  work_authorization: string;
  willing_to_relocate: boolean;
  remote_preference: string;
  cover_letter_template: string;
  custom_answers: CustomQA[];
}

// ── Agents ────────────────────────────────────────────────────────────────────

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'review_requested' | 'help_requested';

export interface AgentLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface AgentInteraction {
  type: 'review' | 'help';
  message?: string;
  reason?: string;
  options: string[];
  screenshot?: string;
}

export interface Agent {
  id: string;
  job_url: string;
  job_title: string;
  company: string;
  status: AgentStatus;
  current_action: string;
  log: AgentLogEntry[];
  screenshot_b64: string | null;
  error: string | null;
  application_id: string | null;
  interaction_pending: AgentInteraction | null;
  llm_provider: string;
  llm_model: string;
}
