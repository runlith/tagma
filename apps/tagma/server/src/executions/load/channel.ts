import { Effect, Stream } from 'effect';
import { refusing } from '../../platform/contract/service/body.js';
import { GateRefusal, type RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { LoadInterest, LoadInterestTaken, MachineLoadFrame } from '../contract/wire/load.js';
import type { LoadFeed } from '../contract/service/load.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import { terminalRefusal } from '../terminals/refusal.js';

const refused = <A>(stream: Stream.Stream<A, TerminalFailure>): Stream.Stream<A, RefusalBody> =>
  stream.pipe(
    Stream.mapError((failure: TerminalFailure) => terminalRefusal(failure)),
    Stream.catchIf(
      (failure): failure is GateRefusal => failure instanceof GateRefusal,
      (gate) => Stream.fromEffect(refusing(Effect.fail(gate))),
    ),
  );

export const loadChannel = (feed: LoadFeed['Service']) => ({
  'load.machine': (): Stream.Stream<MachineLoadFrame, RefusalBody> => refused(feed.machine()),
  'load.interest': (params: LoadInterest): Effect.Effect<LoadInterestTaken> =>
    Effect.map(feed.interest(params.reader, { interested: params.interested, others: params.others ?? false }), (taken) => ({ taken })),
});
