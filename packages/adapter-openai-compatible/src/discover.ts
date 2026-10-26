import { Effect } from 'effect';
import type { DiscoveryFailure, SettingRow } from '@runlith/tagma/adapter/provider';
import { baseUrlOf } from './instance';

const LISTING_TIMEOUT_MS = 15_000;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

const candidateOf = (entry: unknown): SettingRow | null => {
  if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') return null;
  const window = entry.context_length ?? entry.context_window;
  const modalities =
    isRecord(entry.architecture) && Array.isArray(entry.architecture.input_modalities) ? entry.architecture.input_modalities : [];
  return {
    id: entry.id,
    ...(typeof entry.name === 'string' && entry.name !== entry.id ? { label: entry.name } : {}),
    ...(typeof window === 'number' && Number.isInteger(window) && window > 0 ? { context: window } : {}),
    ...(modalities.includes('image') ? { vision: true } : {}),
  };
};

export const discover = (values: SettingRow, secrets: SettingRow): Effect.Effect<readonly SettingRow[], DiscoveryFailure> => {
  const key = typeof secrets.key === 'string' && secrets.key !== '' ? secrets.key : null;
  const base = baseUrlOf(values.baseUrl);
  if (base === undefined) return Effect.fail({ message: 'Give the address first: an http or https URL.' });
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${base}/models`, {
        headers: key === null ? {} : { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${base}/models answered ${response.status}`);
      const body: unknown = await response.json();
      const listed = isRecord(body) && Array.isArray(body.data) ? body.data : [];
      return listed.flatMap((entry) => {
        const candidate = candidateOf(entry);
        return candidate === null ? [] : [candidate];
      });
    },
    catch: (cause): DiscoveryFailure => ({
      message: `The models could not be listed: ${cause instanceof Error ? cause.message : String(cause)}`,
    }),
  });
};
