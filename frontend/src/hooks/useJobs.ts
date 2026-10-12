import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { JobSearchRequest, JobSearchResponse, SourceStatus } from '../types';

export function parseSourceStatus(header: string | null): SourceStatus {
  if (!header) return {};
  try {
    const v = JSON.parse(header);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export async function searchJobs(request: JobSearchRequest): Promise<JobSearchResponse> {
  const res = await fetch('/api/jobs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    let detail: unknown;
    try { detail = (await res.json())?.detail; } catch { /* non-JSON body */ }
    throw new Error(typeof detail === 'string' && detail ? detail : 'Failed to search jobs');
  }
  return { jobs: await res.json(), sources: parseSourceStatus(res.headers.get('X-Source-Status')) };
}

export function useJobSearch(): UseMutationResult<JobSearchResponse, Error, JobSearchRequest> {
  return useMutation({
    mutationFn: searchJobs,
  });
}
