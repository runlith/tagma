import { Console, Effect } from 'effect';
import { print, refuse } from '../../platform/cli/verb.js';
import { steppedBack } from '../closure/moves.js';
import type { Channel } from '../contract/wire/channel.js';
import { installationRoot } from '../paths.js';

export const steppedBackAlone = Effect.fn('installation.steppedBackAlone')(function* (channel: Channel, json: boolean) {
  const root = installationRoot(channel);
  const stepped = yield* Effect.result(steppedBack(root, null, null, Effect.void, Effect.void));
  if (stepped._tag === 'Failure') {
    const failure = stepped.failure;
    switch (failure._tag) {
      case 'PreviousMissing':
        return refuse('no-previous', `no installation is kept beside ${failure.standing ?? 'nothing'} at ${failure.root}`, [
          `${channel.command} status`,
        ]);
      case 'AttemptStanding':
        return refuse('attempt-open', `the update onto ${failure.attempt.to} stands open, so nothing steps back before it ends`, [
          `${channel.command} web — it finishes the update or rolls it back`,
        ]);
      case 'RecordUnreadable':
        return refuse('attempt-open', `${failure.message}, so nothing steps back before it is set aside`, [
          `${channel.command} web — its start sets the record aside`,
        ]);
      case 'MoveFailed':
        return refuse('back-failed', `${failure.step}: ${failure.detail}`, ['try again']);
      case 'InstallHeld':
        return refuse('back-failed', `${failure.path} could not be held: ${failure.reason}`, ['try again']);
    }
  }
  if (json) return yield* print({ back: stepped.success }, true);
  yield* Console.log(
    `going back to ${stepped.success.build ?? stepped.success.version}; the next start returns the data and comes up there`,
  );
  yield* Console.log(`${channel.command} web starts it now`);
});
