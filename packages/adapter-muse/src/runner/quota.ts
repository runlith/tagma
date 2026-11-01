import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import type { Quota } from './frames.js';

const WEEK_MINUTES = 10_080;

const seconds = (ms: number | undefined) => (ms === undefined ? undefined : ms / 1000);

export const observationOf = ({ window, weekly, observedAtMs, tier }: Quota, now: number): QuotaObservation | null => {
  const windows = [
    ...(window === undefined
      ? []
      : [
          new QuotaWindow({
            kind: 'session',
            usedPercent: window.usedPercent,
            windowMinutes: window.windowDurationMins,
            resetsAt: seconds(window.resetsAtMs),
          }),
        ]),
    ...(weekly === undefined
      ? []
      : [
          new QuotaWindow({
            kind: 'weekly',
            usedPercent: weekly.usedPercent,
            windowMinutes: WEEK_MINUTES,
            resetsAt: seconds(weekly.resetsAtMs),
          }),
        ]),
  ];
  return windows.length === 0
    ? null
    : new QuotaObservation({ observedAt: new Date(observedAtMs ?? now), source: 'usage', windows, plan: tier });
};
