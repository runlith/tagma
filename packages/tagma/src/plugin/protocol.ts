export type TickInput = {
  readonly name: string;
  readonly scheduledAt: number;
  readonly startedAt: number;
  readonly skipped: number;
};

export type EndingInput = {
  readonly threadId: string;
  readonly runId: string;
  readonly status: string;
  readonly failureReason: string | null;
};

export type NotificationInput = {
  readonly id: string;
  readonly title: string;
  readonly kind: 'answered' | 'dismissed';
  readonly answer: string | null;
  readonly at: number;
};

export type BuildStepInput = { readonly offer: 'head' | 'tree'; readonly checkout: string };

export type BuildVerdict =
  | { readonly verdict: 'go' }
  | { readonly verdict: 'pending' }
  | { readonly verdict: 'stop'; readonly reason: string; readonly thread?: string };

export const PLUGIN_ENVIRONMENT = {
  server: 'TAGMA_SERVER_URL',
  caller: 'TAGMA_CALLER',
  data: 'TAGMA_PLUGIN_DATA',
  revision: 'TAGMA_PLUGIN_REVISION',
} as const;

export const PROJECTS_META_KEY = 'runlith/projects';

export const RESERVED_PREFIX = '__';

export const handlerTools = {
  schedule: (name: string): string => `${RESERVED_PREFIX}schedule_${name}`,
  build: (name: string): string => `${RESERVED_PREFIX}build_${name}`,
  ended: `${RESERVED_PREFIX}ended`,
  notification: `${RESERVED_PREFIX}notification`,
} as const;
