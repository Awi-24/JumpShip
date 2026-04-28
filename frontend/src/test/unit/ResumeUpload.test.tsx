import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResumeUpload from '../../components/ResumeUpload';
import type { ResumeProfile } from '../../types';

const mockProfile: ResumeProfile = {
  name: 'Ada Lovelace',
  title: 'ML Engineer',
  email: 'ada@example.com',
  phone: '+1-555-0100',
  location_city: 'London',
  location_country: 'UK',
  skills: ['Python', 'GCP', 'TensorFlow'],
  experience_years: 5,
  domains: ['MLOps'],
  suggested_keywords: ['python', 'mlops'],
  suggested_titles: ['ML Engineer'],
  raw_text: 'Ada Lovelace is an ML Engineer...',
};

describe('ResumeUpload', () => {
  it('renders upload zone when no profile loaded', () => {
    render(<ResumeUpload profile={null} isLoading={false} onUpload={vi.fn()} />);
    expect(screen.getByText('Drop your resume')).toBeInTheDocument();
    expect(screen.getByText(/PDF or DOCX/)).toBeInTheDocument();
  });

  it('renders spinner when isLoading is true', () => {
    const { container } = render(
      <ResumeUpload profile={null} isLoading={true} onUpload={vi.fn()} />
    );
    expect(container.querySelector('.spinner')).toBeTruthy();
    expect(screen.getByText(/Parsing resume/i)).toBeInTheDocument();
  });

  it('renders profile details when profile is loaded', () => {
    render(<ResumeUpload profile={mockProfile} isLoading={false} onUpload={vi.fn()} />);
    expect(screen.getByText('ML Engineer')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('GCP')).toBeInTheDocument();
  });

  it('calls onUpload when a file is selected', () => {
    const onUpload = vi.fn();
    const { container } = render(
      <ResumeUpload profile={null} isLoading={false} onUpload={onUpload} />
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it('shows dragging state on dragOver', () => {
    const { container } = render(
      <ResumeUpload profile={null} isLoading={false} onUpload={vi.fn()} />
    );
    const zone = container.querySelector('.upload-zone')!;
    fireEvent.dragOver(zone, { preventDefault: () => {} });
    expect(zone.classList.contains('dragging')).toBe(true);
  });

  it('clears dragging state on dragLeave', () => {
    const { container } = render(
      <ResumeUpload profile={null} isLoading={false} onUpload={vi.fn()} />
    );
    const zone = container.querySelector('.upload-zone')!;
    fireEvent.dragOver(zone, { preventDefault: () => {} });
    fireEvent.dragLeave(zone);
    expect(zone.classList.contains('dragging')).toBe(false);
  });
});
