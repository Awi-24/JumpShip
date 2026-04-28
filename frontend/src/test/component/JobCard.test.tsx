import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JobCard from '../../components/JobCard';
import type { JobResult, ResumeProfile, JobAssessment } from '../../types';

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
  email: 'ada@example.com',
  phone: '+1-555-0100',
  location_city: 'San Francisco',
  location_country: 'USA',
  skills: ['Python', 'GCP'],
  experience_years: 5,
  domains: ['MLOps'],
  suggested_keywords: ['python'],
  suggested_titles: ['ML Engineer'],
  raw_text: 'Ada is an ML Engineer...',
};

const mockAssessment: JobAssessment = {
  match_score: 88,
  summary: 'Great fit for this role.',
  strong_points: ['Strong Python skills', 'GCP experience matches'],
  gaps: ['No Rust experience'],
  career_suggestions: ['Learn MLflow for experiment tracking'],
  company_insights: '',
  income_range: '',
  is_relevant: true,
  job_tags: [],
  keywords_matched: [],
  keywords_missing: [],
  resume_generation_triggered: false,
};

describe('JobCard', () => {
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

  it('expands and collapses the card body', () => {
    const { container } = render(<JobCard job={mockJob} resumeProfile={null} />);
    const header = container.querySelector('.job-card-header')!;
    fireEvent.click(header);
    expect(container.querySelector('.job-card.expanded')).toBeTruthy();
    expect(container.querySelector('.job-expanded-body')).toBeTruthy();
    fireEvent.click(header);
    expect(container.querySelector('.job-card.expanded')).toBeNull();
  });

  it('shows upload-resume prompt when no profile', () => {
    const { container } = render(<JobCard job={mockJob} resumeProfile={null} />);
    fireEvent.click(container.querySelector('.job-card-header')!);
    expect(screen.getByText(/Upload your résumé/i)).toBeInTheDocument();
  });

  it('renders assessment content when provided by parent', () => {
    const { container } = render(
      <JobCard job={mockJob} resumeProfile={mockProfile} assessment={mockAssessment} />
    );
    fireEvent.click(container.querySelector('.job-card-header')!);
    expect(screen.getByText('Great fit for this role.')).toBeInTheDocument();
    expect(screen.getByText('Strong Python skills')).toBeInTheDocument();
    expect(screen.getByText('No Rust experience')).toBeInTheDocument();
  });

  it('calls onReassess when Re-assess is clicked', () => {
    const onReassess = vi.fn();
    const { container } = render(
      <JobCard
        job={mockJob}
        resumeProfile={mockProfile}
        assessment={mockAssessment}
        onReassess={onReassess}
      />
    );
    fireEvent.click(container.querySelector('.job-card-header')!);
    fireEvent.click(screen.getByRole('button', { name: /Re-assess/i }));
    expect(onReassess).toHaveBeenCalledTimes(1);
  });
});
