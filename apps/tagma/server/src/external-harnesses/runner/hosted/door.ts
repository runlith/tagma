import { Effect, Predicate, Result, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { transportWebSchema } from '@runlith/agent/thread/record';
import { AGAIN_AFTER_SILENCE, transportOf, unanswered } from '../../../platform/cli/silence.js';
import { refusalOf, type Invocation } from '../../../platform/cli/verb.js';
import type { ServerCli } from '../../cli/server.js';
import {
  hostedContentSchema,
  hostedMessageSchema,
  hostedToolSchema,
  type HostedMessage,
  type HostedOperationId,
} from '../../contract/wire/hosted.js';

const Agent = Schema.Struct({ prompt: Schema.String, web: transportWebSchema });
const Listed = Schema.Struct({ tools: Schema.Array(hostedToolSchema), names: Schema.Array(Schema.String) });
const Held = Schema.Struct({ messages: Schema.Array(hostedMessageSchema) });
const Opened = Schema.Struct({
  context: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  web: transportWebSchema,
});
const Called = Schema.Struct({
  status: Schema.Literal('called'),
  content: Schema.Array(hostedContentSchema),
  failed: Schema.Boolean,
  offered: Schema.Boolean,
  words: Schema.Array(Schema.String),
});

const RUN_NOT_HELD = 'run-not-held';

const REFUSED_CONNECTION = 'ECONNREFUSED';

type Repeat = 'answered-again' | 'unsent-only';

const notYet =
  (repeat: Repeat) =>
  (cause: unknown): boolean => {
    if (refusalOf(cause)?.code === RUN_NOT_HELD) return true;
    if (repeat === 'answered-again') return unanswered(cause);
    const transport = transportOf(cause);
    return transport !== null && Predicate.hasProperty(transport.cause, 'code') && transport.cause.code === REFUSED_CONNECTION;
  };

export type HostedAgent = typeof Agent.Type;
export type HostedListed = typeof Listed.Type;
export type HostedOpened = typeof Opened.Type;
export type HostedCalled = typeof Called.Type;

export interface HostedDoor {
  agent(): Effect.Effect<HostedAgent, AgentFault>;
  tools(): Effect.Effect<HostedListed, AgentFault>;
  history(): Effect.Effect<readonly HostedMessage[], AgentFault>;
  turn(): Effect.Effect<HostedOpened, AgentFault>;
  call(toolCallId: string, name: string, input: unknown): Effect.Effect<HostedCalled, AgentFault>;
}

export class ServerDoor implements HostedDoor {
  constructor(
    private readonly server: ServerCli,
    private readonly at: Invocation,
  ) {}

  agent(): Effect.Effect<HostedAgent, AgentFault> {
    return this.perform('read_hosted_agent', {}, Agent, 'answered-again');
  }

  tools(): Effect.Effect<HostedListed, AgentFault> {
    return this.perform('read_hosted_tools', {}, Listed, 'answered-again');
  }

  history(): Effect.Effect<readonly HostedMessage[], AgentFault> {
    return Effect.map(this.perform('read_hosted_history', {}, Held, 'answered-again'), (read) => read.messages);
  }

  turn(): Effect.Effect<HostedOpened, AgentFault> {
    return this.perform('open_hosted_turn', {}, Opened, 'unsent-only');
  }

  call(toolCallId: string, name: string, input: unknown): Effect.Effect<HostedCalled, AgentFault> {
    return this.perform('call_hosted_tool', { toolCallId, name, input }, Called, 'answered-again');
  }

  private perform<A>(id: HostedOperationId, input: object, schema: Schema.Codec<A, unknown>, repeat: Repeat): Effect.Effect<A, AgentFault> {
    const decode = Schema.decodeUnknownResult(schema);
    return this.server
      .ask((door) =>
        door.operations.perform({
          params: { id },
          query: this.server.here(this.at),
          headers: {},
          payload: input,
        }),
      )
      .pipe(
        Effect.retry({ while: notYet(repeat), schedule: AGAIN_AFTER_SILENCE }),
        Effect.mapError((cause) => {
          const refusal = refusalOf(cause);
          if (refusal !== null)
            return new AgentFault({
              code: FAULT.internal,
              message: `${id} refused ${refusal.code}: ${refusal.reason}`,
              data: refusal.code,
            });
          return transportOf(cause) === null
            ? new AgentFault({ code: FAULT.internal, message: `the Tagma server failed ${id}: ${String(cause)}`, data: 'failed' })
            : new AgentFault({ code: FAULT.internal, message: `the Tagma server did not answer ${id}: ${String(cause)}`, data: 'failed' });
        }),
        Effect.flatMap((answer) => {
          const read = decode(answer);
          return Result.isFailure(read)
            ? Effect.fail(
                new AgentFault({
                  code: FAULT.internal,
                  message: `the Tagma server answered ${id} in a shape the runner cannot read`,
                  data: 'unreadable',
                }),
              )
            : Effect.succeed(read.success);
        }),
      );
  }
}
