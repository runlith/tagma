import { Schema } from 'effect';
import { AgentPhase } from '@runlith/agent/AgentPhase';
import { QuotaObservation, QuotaFailure } from '@runlith/llm/schema/quota';
import { WireFailureFamily } from '@runlith/llm/schema/errors';

export const Said = Schema.Struct({ sessionId: Schema.String, messageId: Schema.String, toolCallIds: Schema.Array(Schema.String) });

export const STEER = '_tagma/steer';

export const WITHDRAW = '_tagma/withdraw';

export const COMPACT = '_tagma/compact';

export const FORK = '_tagma/fork';

export const REWIND = '_tagma/rewind';

export const ASIDE = '_tagma/aside';

export const Aside = Schema.Struct({ sessionId: Schema.String, question: Schema.String });

export const COMPACTED = '_tagma/compacted';

export const COMPACTING = '_tagma/compacting';

export const UNSTEPPED = -32010;

export const SAID = '_tagma/said';

export const EXECUTES = 'tagma/executes';

export const PHASE = '$/tagma/phase';

export const Phased = Schema.Struct({ sessionId: Schema.String, phase: AgentPhase.fields.phase });

export const FAILURE = 'tagma/failure';

export const MEASURED = 'tagma/measured';

export const Measured = Schema.Struct({
  message: Schema.String,
  sentAt: Schema.String,
  input: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.NullOr(Schema.Number),
  ttlSeconds: Schema.NullOr(Schema.Number),
  attempt: Schema.optionalKey(Schema.Number),
});
export type Measured = typeof Measured.Type;

export const INPUT = '$/tagma/input';

export const Input = Schema.Struct({ sessionId: Schema.String, toolCallId: Schema.String, name: Schema.String, delta: Schema.String });

export const RETRYING = '_tagma/retrying';

export const Retrying = Schema.Struct({
  sessionId: Schema.String,
  uuid: Schema.String,
  attempt: Schema.Number,
  of: Schema.Number,
  delayMs: Schema.Number,
  family: WireFailureFamily,
  httpStatus: Schema.NullOr(Schema.Number),
  message: Schema.String,
});

export const EXTENSIONS = [STEER, WITHDRAW, COMPACT, FORK, REWIND, ASIDE] as const;

export const QUOTA = '_tagma/quota';

export const QuotaReading = Schema.Union([
  Schema.Struct({ sessionId: Schema.String, observation: Schema.toCodecJson(QuotaObservation) }),
  Schema.Struct({ sessionId: Schema.String, failure: Schema.toCodecJson(QuotaFailure) }),
]);

export const BACKGROUND = '_tagma/background';

export const Background = Schema.Struct({ sessionId: Schema.String, running: Schema.Number });

export const NOTIFICATIONS = [COMPACTED, COMPACTING, SAID, BACKGROUND, QUOTA, RETRYING] as const;

export type Extension = (typeof EXTENSIONS)[number];

export type Notification = (typeof NOTIFICATIONS)[number];
