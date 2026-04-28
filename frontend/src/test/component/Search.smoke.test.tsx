import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../hooks/useJobs', () => ({
  useJobs: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useSearch: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../hooks/useResume', () => ({
  useResume: () => ({ data: null, isLoading: false }),
  useUploadResume: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { provider: 'ollama', model: 'gemma3:27b' }, saveSettings: vi.fn() }),
  useLlmKeys: () => ({ data: {}, isLoading: false }),
  useUpdateLlmKeys: () => ({ mutate: vi.fn() }),
}));

describe('Search page smoke', () => {
  it('renders without crashing', async () => {
    const Search = (await import('../../pages/Search')).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <Search onBack={vi.fn()} onNavigate={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container).toBeTruthy();
  });
});
