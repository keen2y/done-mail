import { queryClient } from '../queryClient';
import { endpoints } from '../api/endpoints';
import { queryKeys } from './keys';
import type { SettingsState } from '../../shared/types';

export type { SettingsState };

export function applySettingsCache(settings: SettingsState) {
  queryClient.setQueryData(queryKeys.settings, settings);
  // Keep bootstrap banner / shell flags in sync after saving config.
  queryClient.setQueryData(queryKeys.bootstrap, (prev: { settings?: SettingsState } | undefined) =>
    prev ? { ...prev, settings } : prev
  );
  return settings;
}

export function getSettingsCache() {
  return queryClient.getQueryData<SettingsState>(queryKeys.settings) || null;
}

export function loadSettings(force = false) {
  const options = {
    queryKey: queryKeys.settings,
    queryFn: endpoints.settings,
    staleTime: 5 * 60_000
  };
  return (force ? queryClient.fetchQuery({ ...options, staleTime: 0 }) : queryClient.ensureQueryData(options)).then(applySettingsCache);
}

export function loadEntryOrigins(force = false) {
  const options = {
    queryKey: queryKeys.entryOrigins,
    queryFn: endpoints.entryOrigins,
    staleTime: 10 * 60_000
  };
  return force ? queryClient.fetchQuery({ ...options, staleTime: 0 }) : queryClient.ensureQueryData(options);
}
