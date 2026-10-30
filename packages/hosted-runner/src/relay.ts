import { Cause, Effect } from 'effect';
import type { AgentFault } from '@runlith/acp/agent';
import type { HostedCalled, HostedDoor } from './door.js';
import type { Handed } from './handed.js';

const UNSURE: ReadonlySet<string> = new Set(['failed', 'unreadable']);

export type Relayed = { readonly content: HostedCalled['content']; readonly failed: boolean };
export type RelayHost = {
  readonly changed: () => Effect.Effect<void, AgentFault>;
  readonly queued: (words: readonly string[]) => Effect.Effect<void>;
  readonly stderr: (text: string) => void;
  readonly broke: (reason: string) => Effect.Effect<void>;
};

export class Relay {
  constructor(
    private readonly door: HostedDoor,
    private readonly handed: Handed,
    private readonly host: RelayHost,
  ) {}

  call(toolCallId: string, name: string, input: unknown): Effect.Effect<Relayed> {
    this.handed.add(toolCallId);
    return Effect.flatMap(this.door.call(toolCallId, name, input), (answer) =>
      Effect.as(
        Effect.andThen(
          answer.offered
            ? this.host
                .changed()
                .pipe(
                  Effect.catchTag('AgentFault', (fault) =>
                    Effect.sync(() => this.host.stderr(`Tagma's tool list could not be read again after ${name}: ${fault.message}\n`)),
                  ),
                )
            : Effect.void,
          this.host.queued(answer.words),
        ),
        { content: answer.content, failed: answer.failed },
      ),
    ).pipe(
      Effect.catchTag('AgentFault', (fault) =>
        Effect.sync(() => {
          if (!UNSURE.has(String(fault.data))) this.handed.taken(toolCallId);
          return { content: [{ type: 'text' as const, text: fault.message }], failed: true };
        }),
      ),
      Effect.tapDefect((defect) => this.host.broke(`the runner broke while calling ${name}: ${Cause.pretty(Cause.die(defect))}`)),
    );
  }
}
