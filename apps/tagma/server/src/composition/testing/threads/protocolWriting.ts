import { type ExecutionRef } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { Deferred, Effect } from 'effect';
import type { RunLaunch, TransportRuns } from '@runlith/agent/thread/transport/contract';
import type { ThreadRunSettledSubscriber } from '@runlith/agent/thread/run/ThreadRunSettlements';
import { TerminalWriting } from '../../../executions/contract/service/writing.js';
import type { HarnessAdapters } from '../../../external-harnesses/contract/service/adapters.js';

export type LaunchPause = { readonly entered: Deferred.Deferred<RunLaunch>; readonly released: Deferred.Deferred<void> };

export const delayedLaunches = (runs: TransportRuns, pause: LaunchPause): TransportRuns => ({
  ...runs,
  launch: (launch) =>
    Effect.andThen(Deferred.succeed(pause.entered, launch), Effect.andThen(Deferred.await(pause.released), runs.launch(launch))),
});

export type Floor = {
  readonly fails: number;
  readonly refuses: boolean;
  readonly adapters?: HarnessAdapters['Service'];
  readonly resting?: ReadonlySet<string>;
  readonly loses?: boolean;
  readonly losesSteers?: boolean;
  readonly steering?: Deferred.Deferred<void>;
  readonly delays?: boolean;
  readonly acknowledge?: Deferred.Deferred<void>;
  readonly pressure?: Deferred.Deferred<void>;
  readonly pressureAfter?: string;
  readonly relief?: Deferred.Deferred<void>;
  readonly pressing?: { readonly text: string; readonly met: Deferred.Deferred<void> };
  readonly stalls?: { readonly entered: Deferred.Deferred<void>; readonly released: Deferred.Deferred<void> };
  readonly answers?: 'refused' | 'lost';
  readonly missing?: boolean;
  readonly output?: Deferred.Deferred<'closed' | 'unavailable' | 'completed'>;
  readonly rereads?: Deferred.Deferred<void>;
  readonly threshold?: number;
  readonly dropsLaunch?: boolean;
  readonly launching?: LaunchPause;
  readonly settled?: ThreadRunSettledSubscriber;
  readonly notes?: string;
  readonly place?: { current: string };
  readonly refusing?: Deferred.Deferred<void>;
};

export const backpressured = Effect.fnUntraced(function* (
  pressure: Deferred.Deferred<void>,
  { pressureAfter: after = 'session/prompt', relief, pressing }: Floor,
) {
  const writing = yield* TerminalWriting;
  let blocked: ExecutionRef | null = null;
  return new Proxy(writing, {
    get: (target, key) => {
      if (key === 'input') {
        return Effect.fn('testing.backpressuredInput')(function* (...input: Parameters<TerminalWriting['Service']['input']>) {
          const act = input[2].act;
          if (act._tag !== 'Write') return yield* target.input(...input);
          const relieved = relief !== undefined && Deferred.isDoneUnsafe(relief);
          if (!relieved && blocked?.execution === input[0].execution && blocked.incarnation === input[0].incarnation) {
            yield* Deferred.succeed(pressure, undefined);
            if (pressing !== undefined && new TextDecoder().decode(act.bytes).includes(pressing.text))
              yield* Deferred.succeed(pressing.met, undefined);
            return {
              _tag: 'InputBackpressure' as const,
              frontier: { acceptedThrough: ByteOffset.make('16384'), pendingBytes: 16384 },
              pendingBytes: 16384,
              limit: 16384,
            };
          }
          const landed = yield* target.input(...input);
          if (new TextDecoder().decode(act.bytes).includes(after)) blocked = input[0];
          return landed;
        });
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
});

export const disrupted = Effect.fnUntraced(function* (options: Floor) {
  const writing = yield* TerminalWriting;
  let refusals = options.refusing === undefined ? 0 : 1;
  return new Proxy(writing, {
    get: (target, key) => {
      if (key === 'input') {
        return (...input: Parameters<TerminalWriting['Service']['input']>) => {
          const act = input[2].act;
          if (act._tag !== 'Write') return target.input(...input);
          const text = new TextDecoder().decode(act.bytes);
          if (options.losesSteers && text.includes('_tagma/steer'))
            return Effect.as(target.input(...input), { _tag: 'InputReceiptExpired' as const });
          if (options.steering !== undefined && text.includes('_tagma/steer'))
            return Effect.tap(target.input(...input), () => Deferred.await(options.steering!));
          if (options.answers !== undefined && text.includes('"selected"'))
            return options.answers === 'refused'
              ? Effect.succeed({ _tag: 'InputEnded' as const })
              : Effect.as(target.input(...input), { _tag: 'InputReceiptExpired' as const });
          if (options.refuses === true && text.includes('"_tagma/compact"')) return Effect.succeed({ _tag: 'InputEnded' as const });
          if (!text.includes('session/prompt')) return target.input(...input);
          if (options.refusing !== undefined && refusals > 0) {
            refusals -= 1;
            return Effect.as(Deferred.await(options.refusing), { _tag: 'InputEnded' as const });
          }
          if (options.delays) return Effect.andThen(target.input(...input), Effect.never);
          if (options.acknowledge !== undefined) return Effect.tap(target.input(...input), () => Deferred.await(options.acknowledge!));
          if (options.loses) return Effect.as(target.input(...input), { _tag: 'InputReceiptExpired' as const });
          return options.refuses ? Effect.succeed({ _tag: 'InputEnded' as const }) : target.input(...input);
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
});
