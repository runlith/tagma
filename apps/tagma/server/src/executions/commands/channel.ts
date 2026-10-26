import { Effect, Stream } from 'effect';
import { refusing } from '../../platform/contract/service/body.js';
import { GateRefusal, type RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { CommandFeedFrame, CommandFeedSubscription } from '../contract/wire/commandFeed.js';
import type { TerminalAdopters } from '../contract/service/adopters.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import type { CommandReader } from '../contract/service/commands.js';
import { terminalRefusal } from '../terminals/refusal.js';

export const commandChannel = (owners: {
  readonly feeds: Pick<CommandReader['Service'], 'follow'>;
  readonly adopters: TerminalAdopters['Service'];
}) => ({
  'commands.subscribe': (params: CommandFeedSubscription): Stream.Stream<CommandFeedFrame, RefusalBody> =>
    owners.feeds.follow(params.projectId, { ended: params.ended }, owners.adopters).pipe(
      Stream.mapError((failure: TerminalFailure) => terminalRefusal(failure)),
      Stream.catchIf(
        (failure): failure is GateRefusal => failure instanceof GateRefusal,
        (gate) => Stream.fromEffect(refusing(Effect.fail(gate))),
      ),
    ),
});
