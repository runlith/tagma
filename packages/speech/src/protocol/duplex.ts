import { framesOf } from '@runlith/audio/sound/format';
import { Context, Effect, Result, type Scope } from 'effect';
import type { SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Connection } from './adapter.ts';
import type { Act, SpeechProtocol } from './codec.ts';
import { drive, type Step } from './link.ts';
import type { DuplexTransport } from './transport.ts';

export type DuplexLimits = {
  readonly budgetMs: number;
  readonly readyMs: number;
};

export const DuplexLimits = Context.Reference<DuplexLimits>('speech/DuplexLimits', {
  defaultValue: () => ({ budgetMs: 10_000, readyMs: 15_000 }),
});

const stepOf = <State>(act: Act<State>): Step<State, SpeechEvent> => {
  const end = act.events.findIndex((event) => event._tag === 'Finished');
  return {
    state: act.state,
    send: act.send,
    out: end === -1 ? act.events : act.events.slice(0, end + 1),
    done: end !== -1,
  };
};

export const duplex = Effect.fnUntraced(function* <State, Frame>(
  protocol: SpeechProtocol<State, Frame>,
): Effect.fn.Return<Connection, never, Scope.Scope | DuplexTransport> {
  const limits = yield* DuplexLimits;
  const format = protocol.format;
  const budget = Math.max(1, Math.round((limits.budgetMs * format.rate) / 1000));
  const link = yield* drive({
    request: protocol.request,
    init: protocol.init,
    initial: protocol.initial,
    decode: protocol.decode,
    step: (state, frame) => Result.map(protocol.step(state, frame), stepOf),
    ready: protocol.ready,
    keepalive: protocol.keepalive,
    readyMs: limits.readyMs,
    bytesPerWeight: 2 * format.channels,
    ended: SpeechFailure.transport('the connection has finished'),
  });
  const commit = protocol.commit;
  const finalize = protocol.finalize;
  const connection: Connection = {
    format,
    send: (pcm) =>
      link.admit(framesOf(format, pcm), budget, (state) => Result.succeed({ state, send: [protocol.audio(pcm)], out: [], done: false })),
    commit: (id) =>
      commit === undefined
        ? Effect.fail(SpeechFailure.unsupported('this model takes no commit'))
        : link.act((state) => Result.succeed(stepOf(commit(state, id)))),
    finalize:
      finalize === undefined
        ? Effect.fail(SpeechFailure.unsupported('this model takes no finalize'))
        : link.act((state) => Result.succeed(stepOf(finalize(state)))),
    finish: link.act((state) => Result.succeed(stepOf(protocol.finish(state, link.accepted()))), true),
    delivered: link.delivered,
    events: link.out,
  };
  return connection;
});
