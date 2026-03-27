import { useMutation } from '@tanstack/react-query';
import type { ResumeProfile } from '../types';

interface ParseResumeArgs {
  file: File;
  llmProvider?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
}

async function parseResume(args: ParseResumeArgs): Promise<ResumeProfile> {
  const formData = new FormData();
  formData.append('file', args.file);
  // Pass LLM config as extra form fields so the server uses the user's chosen model
  if (args.llmProvider) formData.append('llm_provider', args.llmProvider);
  if (args.llmModel)    formData.append('llm_model', args.llmModel);
  if (args.llmBaseUrl)  formData.append('llm_base_url', args.llmBaseUrl);
  if (args.llmApiKey)   formData.append('llm_api_key', args.llmApiKey);

  const res = await fetch('/api/resume/parse', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to parse resume');
  return res.json();
}

export function useResumeParse() {
  return useMutation({ mutationFn: parseResume });
}
