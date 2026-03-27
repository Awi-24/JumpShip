import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JobCard from '../../components/JobCard';
import type { JobResult, ResumeProfile } from '../../types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockJob: JobResult = {
  id: 'job-1',
  title: 'Senior ML Engineer',
  company: 'Stripe',
  location: 'Remote',
  job_type: 'fulltime',
  salary_range: 'USD 160,000 - 210,000',
  posted_date: '2026-03-20',
  description: 'Build ML pipelines using Python and GCP.',
  url: 'https://stripe.com/jobs/ml',
  site: 'linkedin',
  match_score: 88,
};

const mockProfile: ResumeProfile = {
  name: 'Ada',
  title: 'ML Engineer',
  skills: ['Python', 'GCP'],
  experience_years: 5,
  domains: ['MLOps'],
  suggested_keywords: ['python'],
  suggested_titles: ['ML Engineer'],
  raw_text: 'Ada is an ML Engineer...',
};

const mockAssessment = {
  match_score: 88,
  summary: 'Great fit for this role.',
  strong_points: ['Strong Python skills', 'GCP experience matches'],
  gaps: ['No Rust experience'],
  career_suggestions: ['Learn MLflow for experiment tracking'],
};

describe('JobCard', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('renders job title and company', () => {
    render(<JobCard job={mockJob} resumeProfile={null} />);
    expect(screen.getByText('Senior ML Engineer')).toBeInTheDocument();
    expect(screen.getByText(/Stripe/)).toBeInTheDocument();
  });

  it('renders ScoreRing when match_score is present', () => {
    const { container } = render(<JobCard job={mockJob} resumeProfile={null} />);
    expect(container.querySelector('.score-ring')).toBeTruthy();
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  it('does not render ScoreRing when match_score is null', () => {
    const jobNoScore = { ...mockJob, match_score: null };
    const { container } = render(<JobCard job={jobNoScore} resumeProfile={null} />);
    expect(container.querySelector('.score-ring')).toBeNull();
  });

  it('expands card on click', () => {
    const { container } = render(<JobCard job={mockJob} resumeProfile={null} />);
    const header = container.querySelector('.job-card-header')!;
    fireEvent.click(header);
    expect(container.querySelector('.job-expanded.open')).toBeTruthy();
  });

  it('collapses card on second click', () => {
    const { container } = render(<JobCard job={mockJob} resumeProfile={null} />);
    const header = container.querySelector('.job-card-header')!;
    fireEvent.click(header);
    fireEvent.click(header);
    expect(container.querySelector('.job-expanded.open')).toBeNull();
  });

  it('shows upload-resume prompt when no profile', () => {
    const { container } = render(<JobCard job={mockJob} resumeProfile={null} />);
    fireEvent.click(container.querySelector('.job-card-header')!);
    expect(screen.getByText(/Upload your résumé/i)).toBeInTheDocument();
  });

  it('triggers assessment fetch when expanded with resume profile', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAssessment,
    });

    const { container } = render(
      <JobCard job={mockJob} resumeProfile={mockProfile} llmConfig={{ provider: 'ollama', model: 'llama3:8b', apiKey: '', baseUrl: 'http://localhost:11434' }} />
    );
    fireEvent.click(container.querySelector('.job-card-header')!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/jobs/assess',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('displays assessment results after fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAssessment,
    });

    const { container } = render(
      <JobCard job={mockJob} resumeProfile={mockProfile} />
    );
    fireEvent.click(container.querySelector('.job-card-header')!);

    await waitFor(() => {
      expect(screen.getByText('Great fit for this role.')).toBeInTheDocument();
      expect(screen.getByText('Strong Python skills')).toBeInTheDocument();
      expect(screen.getByText('No Rust experience')).toBeInTheDocument();
    });
  });

  it('shows error message on assessment failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { container } = render(
      <JobCard job={mockJob} resumeProfile={mockProfile} />
    );
    fireEvent.click(container.querySelector('.job-card-header')!);

    await waitFor(() => {
      expect(screen.getByText(/Assessment failed/i)).toBeInTheDocument();
    });
  });

  it('does not re-fetch assessment on second expand', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAssessment,
    });

    const { container } = render(
      <JobCard job={mockJob} resumeProfile={mockProfile} />
    );
    const header = container.querySelector('.job-card-header')!;
    fireEvent.click(header); // expand → fetch
    await waitFor(() => screen.getByText('Great fit for this role.'));

    fireEvent.click(header); // collapse
    fireEvent.click(header); // re-expand → should NOT fetch again

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
