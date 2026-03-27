import { useMutation } from '@tanstack/react-query';
import type { ResumeProfile } from '../types';

const API = 'http://localhost:8000/api';

async function parseResume(file: File): Promise<ResumeProfile> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API}/resume/parse`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to parse resume');
  return res.json();
}

export function useResumeParse() {
  return useMutation({
    mutationFn: parseResume,
  });
}
