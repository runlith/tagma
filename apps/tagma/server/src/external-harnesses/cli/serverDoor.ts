import { Effect, Result, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import {
  HostedAgentSchema,
  HostedCalledSchema,
  HostedClosedSchema,
  HostedHeldSchema,
  HostedListedSchema,
  HostedOpenedSchema,
  type HostedAgent,
  type HostedCalled,
  type HostedDoor,
  type HostedListed,
  type HostedOpened,
} from '@runlith/hosted-runner/door';
import type { HostedMessage } from '@runlith/hosted-runner/wire/messages';
import { AGAIN_AFTER_SILENCE, transportOf, unanswered } from '../../platform/cli/silence.js';
import { refusalOf, type Invocation } from '../../platform/cli/verb.js';
import type { ServerCli } from './server.js';
import type { HostedOperationId } from '../contract/wire/hosted.js';

const RUN_NOT_HELD = 'run-not-held';

const notYet = (cause: unknown): boolean => refusalOf(cause)?.code === RUN_NOT_HELD || unanswered(cause);

export class ServerDoor implements HostedDoor {
  constructor(
    private readonly server: ServerCli,
    private readonly at: Invocation,
  ) {}

  agent(): Effect.Effect<HostedAgent, AgentFault> {
    return this.perform('read_hosted_agent', {}, HostedAgentSchema);
  }

  tools(): Effect.Effect<HostedListed, AgentFault> {
    return this.perform('read_hosted_tools', {}, HostedListedSchema);
  }

  history(): Effect.Effect<readonly HostedMessage[], AgentFault> {
    return Effect.map(this.perform('read_hosted_history', {}, HostedHeldSchema), (read) => read.messages);
  }

  turn(): Effect.Effect<HostedOpened, AgentFault> {
    return this.perform('open_hosted_turn', {}, HostedOpenedSchema);
  }

  call(toolCallId: string, name: string, input: unknown): Effect.Effect<HostedCalled, AgentFault> {
    return this.perform('call_hosted_tool', { toolCallId, name, input }, HostedCalledSchema);
  }

  close(id: string, text: string | null): Effect.Effect<string | null, AgentFault> {
    return Effect.map(this.perform('close_hosted_turn', { id, text }, HostedClosedSchema), (closed) => closed.guide);
  }

  private perform<A>(id: HostedOperationId, input: object, schema: Schema.Codec<A, unknown>): Effect.Effect<A, AgentFault> {
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
        Effect.retry({ while: notYet, schedule: AGAIN_AFTER_SILENCE }),
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
