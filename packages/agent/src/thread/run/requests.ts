import { Context, Effect, Layer, PubSub, Stream } from 'effect';
import type { Usage } from '@runlith/llm/schema/events';
import type { ThreadCompositionEntry } from '../../transcript/entries';
import { compositionEntryId } from '../../transcript/entryNames';
import { coreEntry } from '../../transcript/kinds';
import { threadCompositionEvent, type ThreadEventBody } from '../events';
import type { ThreadRunRow } from '../rows';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadStore, type ThreadTx, type ThreadWriteTx } from '../ThreadPorts';
import { ThreadCompactor } from './ThreadCompaction';
import { ThreadRunAccounting } from './ThreadRunAccounting';

export type RunRequest = {
  readonly stepNumber: number;
  readonly attempt: number;
  readonly usage: Usage | null;
};

export type RequestLanded = RunRequest & { readonly run: ThreadRunRow };

export type RequestLanding = {
  readonly events: readonly ThreadEventBody[];
  readonly write: (tx: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>;
};

export class RunRequests extends Context.Service<
  RunRequests,
  {
    land(run: ThreadRunRow, request: RunRequest, tx?: ThreadTx): Effect.Effect<RequestLanding, ThreadPortFailure>;
    readonly landed: Stream.Stream<RequestLanded>;
  }
>()('@runlith/agent/RunRequests') {}

export function estimatedComposition(entry: ThreadCompositionEntry, billedInput: number, charsPerToken: number): ThreadCompositionEntry {
  const tokensOf = (chars: number): number => Math.round(chars / charsPerToken);
  const each = entry.tools.each.filter((tool) => tool.hidden !== true).map((tool) => ({ name: tool.name, tokens: tokensOf(tool.chars) }));
  return {
    ...entry,
    tokens: {
      total: billedInput,
      system: tokensOf(entry.system.chars),
      context: entry.context === null ? null : tokensOf(entry.context.chars),
      tools: each.reduce((sum, tool) => sum + tool.tokens, 0),
      each,
    },
  };
}

export const runRequestsLayer: Layer.Layer<RunRequests, never, ThreadStore | ThreadRunAccounting | ThreadCompactor> = Layer.effect(
  RunRequests,
  Effect.gen(function* () {
    const store = yield* ThreadStore;
    const accounting = yield* ThreadRunAccounting;
    const compactor = yield* ThreadCompactor;
    const landed = yield* PubSub.unbounded<RequestLanded>();
    const unestimated = Effect.fnUntraced(function* (run: ThreadRunRow, tx: ThreadTx | undefined) {
      const entry = yield* store.entryById(run.threadId, compositionEntryId(run.id), tx);
      return entry !== undefined && coreEntry(entry) && entry.type === 'composition' && entry.opening === true && entry.tokens === undefined
        ? entry
        : null;
    });
    return RunRequests.of({
      land: Effect.fnUntraced(function* (run, request, tx) {
        const published = (unit: ThreadWriteTx) => unit.afterCommit(Effect.asVoid(PubSub.publish(landed, { ...request, run })));
        if (run.status !== 'running')
          return {
            events: [],
            write: (unit) => Effect.andThen(accounting.chargeIn(run.id, { usage: request.usage, cost: null }, unit), published(unit)),
          };
        const billed = request.usage?.inputTokens ?? 0;
        const opening = billed > 0 ? yield* unestimated(run, tx) : null;
        const events =
          opening === null
            ? []
            : [threadCompositionEvent(estimatedComposition(opening, billed, compactor.charsPerToken(run.provider ?? '', run.model)))];
        return {
          events,
          write: (unit) => Effect.andThen(accounting.usageIn(run.id, request.usage, unit), published(unit)),
        };
      }),
      landed: Stream.fromPubSub(landed),
    });
  }),
);
