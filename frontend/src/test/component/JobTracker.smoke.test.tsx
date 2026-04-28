import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../hooks/useJobs', () => ({
  useApplications: () => ({ data: [], isLoading: false }),
  useUpdateApplication: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: {}, saveSettings: vi.fn() }),
  useLlmKeys: () => ({ data: {}, isLoading: false }),
  useUpdateLlmKeys: () => ({ mutate: vi.fn() }),
}));

describe('JobTracker page smoke', () => {
  it('renders without crashing', async () => {
    const JobTracker = (await import('../../pages/JobTracker')).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <JobTracker onBack={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container).toBeTruthy();
  });
});
