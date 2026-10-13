import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSourceStatus, searchJobs } from '../../hooks/useJobs';

const req = { keywords: ['x'], location: '', job_type: 'all', sites: ['gupy'], results_wanted: 5 };

afterEach(() => vi.unstubAllGlobals());

describe('X-Source-Status parsing', () => {
  it('parses valid, tolerates missing/invalid', () => {
    expect(parseSourceStatus('{"gupy":{"count":0,"error":"boom"}}')).toEqual({ gupy: { count: 0, error: 'boom' } });
    expect(parseSourceStatus(null)).toEqual({});
    expect(parseSourceStatus('not json')).toEqual({});
  });

  it('searchJobs returns jobs + sources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', {
      headers: { 'X-Source-Status': '{"gupy":{"count":0,"error":null}}', 'X-Dismissed-Count': '2' },
    })));
    expect(await searchJobs(req)).toEqual({ jobs: [], sources: { gupy: { count: 0, error: null } }, dismissed: 2 });
  });

  it('surfaces backend detail on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"bad sites"}', { status: 422 })));
    await expect(searchJobs(req)).rejects.toThrow('bad sites');
  });
});
