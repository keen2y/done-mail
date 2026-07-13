import { queryClient } from '../queryClient';
import { endpoints, type BootstrapState } from '../api/endpoints';
import { queryKeys } from './keys';

export function applyBootstrapCache(data: BootstrapState) {
  queryClient.setQueryData(queryKeys.auth, data.auth);
  queryClient.setQueryData(queryKeys.settings, data.settings);
  queryClient.setQueryData(queryKeys.bootstrap, data);
}

async function fetchBootstrapWithRetry() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await endpoints.bootstrap();
    } catch (error) {
      lastError = error;
      const status = Number((error as { response?: { status?: number } })?.response?.status || 0);
      const code = String(
        (error as { response?: { data?: { error?: { code?: string }; code?: string } } })?.response?.data?.error?.code ||
          (error as { response?: { data?: { code?: string } } })?.response?.data?.code ||
          ''
      );
      const initializing = status === 503 || code === 'schema_initializing';
      if (!initializing || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function loadBootstrap(force = false) {
  if (!force) {
    const cached = queryClient.getQueryData<BootstrapState>(queryKeys.bootstrap);
    if (cached) return cached;
  }

  const data = await queryClient.fetchQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: fetchBootstrapWithRetry,
    staleTime: 5 * 60_000,
    retry: false
  });
  applyBootstrapCache(data);
  return data;
}
