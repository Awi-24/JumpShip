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
  is_remote?: boolean | null;
  tags?: string[];
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

// ─── Agent / Model Discovery ────────────────────────────────────────────────

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

// ─── Agent Trace Events ─────────────────────────────────────────────────────

export type TraceEventType = 'thinking' | 'tool_call' | 'tool_result' | 'error' | 'human_needed' | 'status';

export interface TraceEvent {
  id: string;
  task_id: string;
  step: number;
  event_type: TraceEventType;
  content: {
    reasoning?: string;
    summary?: string;
    tool?: string;
    args?: Record<string, unknown>;
    result?: string;
    error?: string;
    screenshot_path?: string;
    duration_ms?: number;
  };
  timestamp: string;
}

// ─── Application agents (Agent Monitor / auto-apply) ─────────────────────────

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'review_requested'
  | 'help_requested';

export interface AgentLogEntry {
  level?: 'error' | 'warn' | 'info' | string;
  message: string;
  timestamp: string;
}

export interface AgentInteraction {
  type: 'review' | 'help' | string;
  message?: string;
  reason?: string;
  options: string[];
  screenshot?: string;
}

export interface Agent {
  id: string;
  job_url?: string;
  job_title?: string;
  company?: string;
  status: AgentStatus;
  current_action: string;
  log: AgentLogEntry[];
  screenshot_b64?: string | null;
  error?: string | null;
  application_id?: string | null;
  interaction_pending?: AgentInteraction | null;
  llm_provider?: string;
  llm_model?: string;
}
