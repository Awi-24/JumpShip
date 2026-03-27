import { useMutation } from '@tanstack/react-query';
import type { JobSearchRequest, JobResult } from '../types';

async function searchJobs(request: JobSearchRequest): Promise<JobResult[]> {
  const res = await fetch('/api/jobs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Failed to search jobs');
  return res.json();
}

export function useJobSearch() {
  return useMutation({
    mutationFn: searchJobs,
  });
}
