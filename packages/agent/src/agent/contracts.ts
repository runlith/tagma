import { Schema } from 'effect';

export const AgentHook = Schema.Literals(['beforeStep', 'beforeTool', 'afterTool', 'beforeClose']);
export type AgentHook = typeof AgentHook.Type;

export const AgentRuntimeGuidance = Schema.Struct({
  type: Schema.tag('runtime-guidance'),
  id: Schema.String,
  runId: Schema.String,
  hook: Schema.Union([AgentHook, Schema.Literal('mixed')]),
  sequence: Schema.Number,
  texts: Schema.Array(Schema.String),
  sources: Schema.Array(
    Schema.Struct({
      hook: AgentHook,
      ruleId: Schema.optional(Schema.String),
      state: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      retell: Schema.optional(Schema.Literal(false)),
      toolName: Schema.optional(Schema.String),
      toolCallId: Schema.optional(Schema.String),
      taskId: Schema.optional(Schema.String),
    }),
  ),
  ruleIds: Schema.optional(Schema.Array(Schema.String)),
  stepNumber: Schema.optional(Schema.Number),
  occurredAt: Schema.optional(Schema.String),
});
export type AgentRuntimeGuidance = typeof AgentRuntimeGuidance.Type;

export const ThreadSignalAddressee = Schema.Literals(['reader', 'transport']);
export type ThreadSignalAddressee = typeof ThreadSignalAddressee.Type;

export type AgentSignalPart =
  | { readonly type: 'media'; readonly mediaType: string; readonly data: string; readonly filename?: string }
  | { readonly type: 'text'; readonly text: string };

export const USER_MESSAGE_SIGNAL_TYPE = 'user-message';

export function isReaderWords(signal: AgentSignal): boolean {
  return signal.addressee === 'reader' && signal.type === USER_MESSAGE_SIGNAL_TYPE;
}

export const REPORT_SIGNAL_TYPE = 'report';

export const AGENT_CHILD_UPDATE_SIGNAL_TYPE = 'child-agent-update';

export function isReport(signal: AgentSignal): boolean {
  return signal.addressee === 'transport' && signal.type === REPORT_SIGNAL_TYPE;
}

export type AgentSignalContext = { readonly tokens: number; readonly warmUntil?: string };

export const WakeCost = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('warm'), tokens: Schema.NullOr(Schema.Number), until: Schema.String }),
  Schema.Struct({ kind: Schema.Literals(['cold', 'likely-warm', 'estimated-cold', 'unknown']), tokens: Schema.NullOr(Schema.Number) }),
]);
export type WakeCost = typeof WakeCost.Type;

export const AgentThreadRef = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.optional(Schema.Number),
  name: Schema.NullOr(Schema.String),
});
export type AgentThreadRef = typeof AgentThreadRef.Type;

export const ThreadModelChoice = Schema.Struct({
  provider: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
});
export type ThreadModelChoice = typeof ThreadModelChoice.Type;

export const AgentChildUpdate = Schema.Union([
  Schema.Struct({
    kind: Schema.tag('child-update'),
    child: AgentThreadRef,
    event: Schema.Literals(['ran', 'compacted', 'cooled']),
    forOperator: Schema.Boolean,
    cost: WakeCost,
  }),
  Schema.Struct({
    kind: Schema.tag('child-update'),
    child: AgentThreadRef,
    event: Schema.Literal('model-changed'),
    from: ThreadModelChoice,
    to: ThreadModelChoice,
    forOperator: Schema.Boolean,
    cost: WakeCost,
  }),
  Schema.Struct({
    kind: Schema.tag('child-update'),
    child: AgentThreadRef,
    event: Schema.Literal('tasks'),
    forOperator: Schema.Boolean,
    cost: WakeCost,
  }),
]);
export type AgentChildUpdate = typeof AgentChildUpdate.Type;

export const AgentCallEnding = Schema.Struct({
  kind: Schema.tag('call-ending'),
  runId: Schema.String,
  toolCallId: Schema.String,
  tool: Schema.String,
  outcome: Schema.Literals(['completed', 'failed', 'stopped', 'interrupted']),
  threads: Schema.Array(AgentThreadRef),
});
export type AgentCallEnding = typeof AgentCallEnding.Type;

export const THREAD_EVENT_SIGNAL_TYPE = 'thread-event';

export const THREAD_EVENT_KINDS = [
  'rested',
  'failed',
  'stalled',
  'awaiting',
  'addresses-human',
  'stopped',
  'committed',
  'task-closed',
] as const;
export type ThreadEventKind = (typeof THREAD_EVENT_KINDS)[number];

export const WAKING_THREAD_EVENTS = [
  'rested',
  'failed',
  'stalled',
  'awaiting',
  'addresses-human',
] as const satisfies readonly ThreadEventKind[];
export type WakingThreadEvent = (typeof WAKING_THREAD_EVENTS)[number];

export const AgentThreadEvent = Schema.Struct({
  kind: Schema.tag('thread-event'),
  thread: AgentThreadRef,
  event: Schema.Literals(THREAD_EVENT_KINDS),
  wakes: Schema.Boolean,
  forOperator: Schema.optional(Schema.Boolean),
});
export type AgentThreadEvent = typeof AgentThreadEvent.Type;

export const AgentSignalNotice = Schema.Union([AgentChildUpdate, AgentCallEnding, AgentThreadEvent]);
export type AgentSignalNotice = typeof AgentSignalNotice.Type;

export type AgentSignal = {
  readonly id: string;
  readonly type: string;
  readonly text: string;
  readonly addressee?: ThreadSignalAddressee;
  readonly from?: string;
  readonly senderThreadId?: string;
  readonly senderProjectId?: number;
  readonly envelopeId?: string;
  readonly context?: AgentSignalContext;
  readonly notice?: AgentSignalNotice;
  readonly attached?: readonly AgentSignalPart[];
  readonly readerPosition?: number;
  readonly occurredAt: string;
};

export const AgentApprovalMode = Schema.String.check(Schema.isMinLength(1));
export type AgentApprovalMode = typeof AgentApprovalMode.Type;

export type AgentApproval = {
  readonly mode: AgentApprovalMode;
  readonly interactive: boolean;
};

export type ToolConfirmationFact = { label: string; value: string };

export type ThreadBindings = Readonly<Record<string, string>>;

export type ToolCallerThread = {
  readonly threadId: string;
  readonly runId: string;
  readonly bindings: ThreadBindings;
};

export type ToolCaller = {
  readonly agentId: string;
  readonly ownerId: string;
  readonly thread: ToolCallerThread | null;
};
