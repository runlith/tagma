import { Schema } from 'effect';

const Tokens = Schema.Struct({
  inputTokens: Schema.Finite,
  outputTokens: Schema.Finite,
  cachedTokens: Schema.Finite,
  cacheReadTokens: Schema.optional(Schema.Finite),
  cacheWriteTokens: Schema.optional(Schema.Finite),
  reasoningTokens: Schema.Finite,
});
export type Tokens = typeof Tokens.Type;

export const Item = Schema.Struct({
  itemId: Schema.String,
  kind: Schema.String,
  status: Schema.String,
  turnId: Schema.optional(Schema.NullOr(Schema.String)),
  commandId: Schema.optional(Schema.String),
  steered: Schema.optional(Schema.Boolean),
  text: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.Array(Schema.String)),
  tool: Schema.optional(Schema.String),
  callId: Schema.optional(Schema.String),
  args: Schema.optional(Schema.String),
  visibleOutput: Schema.optional(Schema.String),
  failureReason: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  trigger: Schema.optional(Schema.String),
  tokensBefore: Schema.optional(Schema.Finite),
  tokensAfter: Schema.optional(Schema.Finite),
});
export type Item = typeof Item.Type;

export const ItemEvent = Schema.Struct({ sessionId: Schema.String, item: Item });
export const ItemDelta = Schema.Struct({
  sessionId: Schema.String,
  itemId: Schema.String,
  delta: Schema.String,
  field: Schema.optional(Schema.String),
});
export const TurnStarted = Schema.Struct({ sessionId: Schema.String, turnId: Schema.String });
export const TurnCompleted = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  terminal: Schema.String,
  usage: Schema.optional(Schema.NullOr(Tokens)),
  error: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ kind: Schema.String, message: Schema.String, retryable: Schema.Boolean, quota: Schema.optional(Schema.Unknown) }),
    ),
  ),
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TurnCompleted = typeof TurnCompleted.Type;
export const TokenUsage = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  modelId: Schema.NullOr(Schema.String),
  usage: Tokens,
  promptTokens: Schema.Finite,
  cumulative: Schema.optional(Schema.Struct({ cost: Schema.optional(Schema.Struct({ usd: Schema.Finite, partial: Schema.Boolean })) })),
});
export type TokenUsage = typeof TokenUsage.Type;
export const ContextUsage = Schema.Struct({
  sessionId: Schema.String,
  usedTokens: Schema.Finite,
  windowTokens: Schema.optional(Schema.Finite),
});
export const Retry = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  attempt: Schema.Finite,
  maxAttempts: Schema.Finite,
  retryDelayMs: Schema.Finite,
  errorKind: Schema.optional(Schema.String),
  httpStatus: Schema.optional(Schema.Finite),
  reason: Schema.optional(Schema.String),
});
export const Approval = Schema.Struct({
  sessionId: Schema.String,
  approvalId: Schema.String,
  turnId: Schema.String,
  toolCallId: Schema.String,
  toolName: Schema.String,
  rawArgs: Schema.String,
  currentRequirementId: Schema.Unknown,
  availableChoices: Schema.Array(Schema.Struct({ choiceId: Schema.String, decision: Schema.String, scope: Schema.String })),
  subject: Schema.Struct({ kind: Schema.String, host: Schema.optional(Schema.String), origin: Schema.optional(Schema.Unknown) }),
});
export type Approval = typeof Approval.Type;
export const Quota = Schema.Struct({
  window: Schema.optional(
    Schema.Struct({
      usedPercent: Schema.Finite,
      windowDurationMins: Schema.optional(Schema.Finite),
      resetsAtMs: Schema.optional(Schema.Finite),
    }),
  ),
  weekly: Schema.optional(Schema.Struct({ usedPercent: Schema.Finite, resetsAtMs: Schema.optional(Schema.Finite) })),
  observedAtMs: Schema.optional(Schema.Finite),
  tier: Schema.optional(Schema.String),
});
export type Quota = typeof Quota.Type;
export const Started = Schema.Struct({ turnId: Schema.String, disposition: Schema.optional(Schema.String) });
export const Opened = Schema.Struct({
  session: Schema.Struct({
    sessionId: Schema.String,
    approvalMode: Schema.optional(Schema.Struct({ mode: Schema.String })),
  }),
});
export const Compact = Schema.Struct({ status: Schema.String, reason: Schema.optional(Schema.String) });

const Held = Schema.Struct({ kind: Schema.String, commandId: Schema.optional(Schema.String) });
const Ref = Schema.Struct({ turnId: Schema.String, commandId: Schema.String });
export const SessionRead = Schema.Struct({
  history: Schema.Struct({
    mode: Schema.String,
    noneReason: Schema.optional(Schema.String),
    items: Schema.NullOr(Schema.Array(Held)),
    snapshot: Schema.NullOr(
      Schema.Struct({
        state: Schema.Struct({ items: Schema.Array(Held), activeTurn: Schema.NullOr(Ref), queuedTurns: Schema.Array(Ref) }),
      }),
    ),
  }),
});
export const Models = Schema.Struct({
  providerId: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      modelId: Schema.String,
      displayLabel: Schema.String,
      providerId: Schema.String,
      isDefault: Schema.Boolean,
      contextLimit: Schema.NullOr(Schema.Finite),
      outputLimit: Schema.NullOr(Schema.Finite),
      variants: Schema.optional(Schema.Union([Schema.Array(Schema.String), Schema.Unknown])),
      defaultReasoningEffort: Schema.optional(Schema.String),
    }),
  ),
});
export type Models = typeof Models.Type;
