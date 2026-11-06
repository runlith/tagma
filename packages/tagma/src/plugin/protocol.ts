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

export type AskedPrompt = {
  readonly id: string;
  readonly prompt: string;
  readonly header?: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly description?: string }[];
  readonly freeform: boolean;
  readonly multiple: boolean;
};

export type AskedInput = {
  readonly threadId: string;
  readonly questionId: string;
  readonly summary: string;
  readonly prompts: readonly AskedPrompt[] | null;
  readonly deadlineAt: string | null;
};

export const ASKED_LEFT = { question: 'left' } as const;

export type AskedLeft = typeof ASKED_LEFT;

export type NotificationInput = {
  readonly id: string;
  readonly title: string;
  readonly kind: 'answered' | 'dismissed';
  readonly answer: string | null;
  readonly at: number;
};

export type BuildStepInput = { readonly offer: 'head' | 'tree'; readonly checkout: string };

export type ActionInput = { readonly args: string };

export const HOOK_POINTS = ['beforeTool', 'afterTool', 'beforeStep', 'beforeClose', 'threadStarted', 'threadEnded'] as const;

export type HookPoint = (typeof HOOK_POINTS)[number];

export type HookCall =
  | { readonly at: 'beforeTool'; readonly tool: string; readonly input: unknown; readonly callId: string }
  | { readonly at: 'afterTool'; readonly tool: string; readonly input: unknown; readonly output: unknown; readonly callId: string }
  | { readonly at: 'beforeStep'; readonly text: string }
  | { readonly at: 'beforeClose'; readonly answer: string | null; readonly continued: boolean }
  | { readonly at: 'threadStarted'; readonly resumed: boolean }
  | { readonly at: 'threadEnded'; readonly reason: 'archive' | 'delete' };

export type HookSession = { readonly threadId: string; readonly cwd: string };

export type HookInput = HookCall & HookSession;

export const TAGMA_REASONS = {
  schedule: 'schedule',
  build: 'build',
  ended: 'ended',
  asked: 'asked',
  notification: 'notification',
  hook: 'hook',
} as const;

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
  action: (name: string): string => `${RESERVED_PREFIX}action_${name}`,
  hook: (name: string): string => `${RESERVED_PREFIX}hook_${name}`,
  ended: `${RESERVED_PREFIX}ended`,
  asked: `${RESERVED_PREFIX}asked`,
  notification: `${RESERVED_PREFIX}notification`,
} as const;
