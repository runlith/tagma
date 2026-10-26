export const WAITING_REASONS = {
  graph: 'graph',
  setup: 'setup',
  process: 'process',
  stopping: 'stopping',
} as const;

export type WaitingReason = (typeof WAITING_REASONS)[keyof typeof WAITING_REASONS];
