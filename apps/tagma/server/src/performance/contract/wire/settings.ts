import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';

const TELEMETRY_SCOPES = ['user'] as const;

export const performanceStorageLimit = settingKey({
  id: 'telemetry.maxStoredBytes',
  order: 770,
  title: 'Performance storage',
  description: 'How much performance evidence is retained in performance.sqlite.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'bytes' },
  fallback: 8 * 1024 * 1024 * 1024,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const performancePendingLimit = settingKey({
  id: 'telemetry.maxPendingBytes',
  order: 780,
  title: 'Performance pending queue',
  description: 'How much may wait for the performance worker before it is dropped.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'bytes' },
  fallback: 64 * 1024 * 1024,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const performanceSpanMinMicros = settingKey({
  id: 'telemetry.spanFloorMicros',
  order: 790,
  title: 'Span record floor',
  description: 'Inside a trace kept by sampling alone, a successful span shorter than this is counted in metrics but not stored.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  control: { kind: 'number', minimum: 0, step: 1, unit: 'microseconds' },
  fallback: 1_000,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const performanceKeepOneTraceIn = settingKey({
  id: 'telemetry.keepOneTraceIn',
  order: 800,
  title: 'Trace sampling',
  description: 'One ordinary trace in this many is stored, over and above every slow, failed and stalled one.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'traces' },
  fallback: 100,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const vitalsIntervalMs = settingKey({
  id: 'telemetry.vitalsIntervalMs',
  order: 810,
  title: 'Vitals interval',
  description: 'How often the process vitals are sampled.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'milliseconds' },
  fallback: 5_000,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const cpuSampler = settingKey({
  id: 'telemetry.cpuSampler',
  order: 815,
  title: 'Standing CPU sampler',
  description:
    'Keep a CPU profile running so every loop stall carries the code that held it. It costs CPU and pauses the server while it runs; a manual profile capture works without it.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const metricsIntervalMs = settingKey({
  id: 'telemetry.metricsIntervalMs',
  order: 820,
  title: 'Metrics interval',
  description: 'How often a metric snapshot is taken.',
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'milliseconds' },
  fallback: 60_000,
  scopes: TELEMETRY_SCOPES,
  merge: 'replace',
});

export const PERFORMANCE_SETTING_SECTIONS = [
  {
    id: 'telemetry',
    order: 80,
    title: 'Telemetry',
    description: 'Storage bounds and sampling cadence for local performance evidence.',
  },
] as const;

export const PERFORMANCE_SETTING_KEYS = [
  performanceStorageLimit,
  performancePendingLimit,
  performanceSpanMinMicros,
  performanceKeepOneTraceIn,
  vitalsIntervalMs,
  cpuSampler,
  metricsIntervalMs,
] as const;
