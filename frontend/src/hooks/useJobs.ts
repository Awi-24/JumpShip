import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { JobResult, JobSearchRequest, JobSearchResponse, SourceStatus } from '../types';

export function parseSourceStatus(header: string | null): SourceStatus {
  if (!header) return {};
  try {
    const v = JSON.parse(header);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function throwSearchError(res: Response): Promise<never> {
  let detail: unknown;
  try { detail = (await res.json())?.detail; } catch { /* non-JSON body */ }
  throw new Error(typeof detail === 'string' && detail ? detail : 'Failed to search jobs');
}

export async function searchJobs(request: JobSearchRequest): Promise<JobSearchResponse> {
  const res = await fetch('/api/jobs/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) await throwSearchError(res);
  return {
    jobs: await res.json(),
    sources: parseSourceStatus(res.headers.get('X-Source-Status')),
    dismissed: Number(res.headers.get('X-Dismissed-Count')) || 0,
  };
}

/** One NDJSON line of `/api/jobs/search/stream`. */
type StreamEvent =
  | { site: string; jobs: JobResult[]; status: SourceStatus[string] }
  | { done: true; dismissed: number };

/**
 * Streaming search (Rust backend): `onProgress` gets the merged result after every board that finishes.
 * Falls back to the one-shot endpoint when the backend has no stream route (Python backend).
 */
export async function searchJobsStream(
  request: JobSearchRequest,
  onProgress?: (partial: JobSearchResponse) => void,
): Promise<JobSearchResponse> {
  const res = await fetch('/api/jobs/search/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (res.status === 404 || res.status === 405 || !res.body) return searchJobs(request);
  if (!res.ok) await throwSearchError(res);

  const acc: JobSearchResponse = { jobs: [], sources: {}, dismissed: 0 };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    const lines = buf.split('\n');
    buf = done ? '' : lines.pop() ?? '';
    for (const line of lines.filter(l => l.trim())) {
      const ev = JSON.parse(line) as StreamEvent;
      if ('done' in ev) {
        acc.dismissed = ev.dismissed;
      } else {
        acc.jobs = [...acc.jobs, ...ev.jobs];
        acc.sources = { ...acc.sources, [ev.site]: ev.status };
      }
      onProgress?.({ ...acc });
    }
    if (done) return acc;
  }
}

export function useJobSearch(
  onProgress?: (partial: JobSearchResponse) => void,
): UseMutationResult<JobSearchResponse, Error, JobSearchRequest> {
  return useMutation({
    mutationFn: (request: JobSearchRequest) => searchJobsStream(request, onProgress),
  });
}
