import { Schema } from 'effect';

export const AgentHook = Schema.Literals(['beforeStep', 'beforeTool', 'afterTool', 'beforeClose']);
export type AgentHook = typeof AgentHook.Type;

export const AgentGuideSource = Schema.Struct({
  hook: AgentHook,
  ruleId: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  batchKey: Schema.optional(Schema.String),
  covers: Schema.optional(Schema.Array(Schema.String)),
  retell: Schema.optional(Schema.Literal(false)),
  toolName: Schema.optional(Schema.String),
  toolCallId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
});

export const PendingRuntimeGuide = Schema.Struct({ text: Schema.String, ...AgentGuideSource.fields });
export type PendingRuntimeGuide = typeof PendingRuntimeGuide.Type;

export const AgentRuntimeGuidance = Schema.Struct({
  type: Schema.tag('runtime-guidance'),
  id: Schema.String,
  runId: Schema.String,
  hook: Schema.Union([AgentHook, Schema.Literal('mixed')]),
  sequence: Schema.Number,
  texts: Schema.Array(Schema.String),
  sources: Schema.Array(AgentGuideSource),
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
  Schema.Struct({
    kind: Schema.tag('child-update'),
    child: AgentThreadRef,
    event: Schema.Literal('deleted'),
    by: Schema.String,
    at: Schema.String,
    ended: Schema.Struct({ run: Schema.Boolean, owed: Schema.Boolean }),
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
  guides: Schema.optional(Schema.Array(PendingRuntimeGuide)),
});
export type AgentCallEnding = typeof AgentCallEnding.Type;

export const AgentCommandExit = Schema.Union([
  Schema.Struct({ kind: Schema.tag('code'), code: Schema.Int }),
  Schema.Struct({ kind: Schema.tag('signal'), signal: Schema.String }),
]);
export type AgentCommandExit = typeof AgentCommandExit.Type;

export const AgentCommandEnding = Schema.Struct({
  kind: Schema.tag('command-ending'),
  execution: Schema.String,
  incarnation: Schema.Int,
  label: Schema.optional(Schema.String),
  command: Schema.NullOr(Schema.String),
  ending: Schema.Literals(['completed', 'stopped', 'expired', 'unknown']),
  exit: Schema.NullOr(AgentCommandExit),
  tail: Schema.NullOr(Schema.String),
});
export type AgentCommandEnding = typeof AgentCommandEnding.Type;

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

export const AgentSignalNotice = Schema.Union([AgentChildUpdate, AgentCallEnding, AgentCommandEnding, AgentThreadEvent]);
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

type ThreadReadDegraded = {
  readonly thread: string | null;
  readonly place: string;
  readonly why: string;
  readonly repeat: string;
  readonly failure: unknown;
};

export type ThreadReadWitness = (told: ThreadReadDegraded) => void;

export type DegradedReads = {
  readonly degraded: ThreadReadWitness;
  readonly witnessing: (witness: ThreadReadWitness) => () => void;
};

//! Reads made before the error list stands wait for it, and a reader in a worker, which nobody witnesses, stays bounded.
const UNWITNESSED_READS = 256;

export const degradedReads = (): DegradedReads => {
  const witnesses = new Set<ThreadReadWitness>();
  const unwitnessed: ThreadReadDegraded[] = [];
  return {
    degraded: (told) => {
      if (witnesses.size > 0) for (const witness of witnesses) witness(told);
      else if (unwitnessed.length < UNWITNESSED_READS) unwitnessed.push(told);
    },
    witnessing: (witness) => {
      witnesses.add(witness);
      for (const told of unwitnessed.splice(0)) witness(told);
      return () => void witnesses.delete(witness);
    },
  };
};
