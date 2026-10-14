import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSourceStatus, searchJobs, searchJobsStream } from '../../hooks/useJobs';

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

  it('searchJobsStream merges boards as they arrive', async () => {
    const lines = [
      '{"site":"gupy","jobs":[{"id":"a"}],"status":{"count":1,"error":null}}\n{"site":"linkedin","jobs":[],',
      '"status":{"count":0,"error":"boom"}}\n{"done":true,"dismissed":3}\n',
    ];
    const body = new ReadableStream({
      start(c) { lines.forEach(l => c.enqueue(new TextEncoder().encode(l))); c.close(); },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const seen: number[] = [];
    const out = await searchJobsStream(req, p => seen.push(Object.keys(p.sources).length));
    expect(out.jobs.map(j => j.id)).toEqual(['a']);
    expect(out.sources.linkedin.error).toBe('boom');
    expect(out.dismissed).toBe(3);
    expect(seen).toEqual([1, 2, 2]);
  });

  it('searchJobsStream falls back to the one-shot endpoint (Python backend)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"detail":"Not Found"}', { status: 404 }))
      .mockResolvedValueOnce(new Response('[{"id":"b"}]'));
    vi.stubGlobal('fetch', fetchMock);
    const out = await searchJobsStream(req);
    expect(out.jobs.map(j => j.id)).toEqual(['b']);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/jobs/search');
  });

  it('cancel signal goes to fetch, not into the request body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"detail":"Not Found"}', { status: 404 }))
      .mockResolvedValueOnce(new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const { signal } = new AbortController();
    await searchJobsStream(req, undefined, signal);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBe(signal); // stream and one-shot fallback both cancellable
      expect(JSON.parse(init.body)).toEqual(req);
    }
  });
});
