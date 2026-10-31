import { Effect } from 'effect';
import { Command } from 'effect/cli';
import { noting } from '../../platform/cli/verb.js';
import type { Channel } from '../../installation/contract/wire/channel.js';

export const serveCommand = (channel: Channel, server: () => Promise<unknown>) =>
  Command.make('serve', {}, () =>
    Effect.promise(() => import('../attempt.js')).pipe(
      Effect.flatMap(({ arrival, beforeDoor }) => Effect.andThen(arrival(channel), beforeDoor(Effect.promise(server)))),
      Effect.asVoid,
    ),
  ).pipe(
    Command.withDescription(`start the ${channel.name} server on port ${channel.port} (TAGMA_PORT overrides)`),
    noting(`ONE process owns a data directory — its database, its thread rollouts and the event
positions it mints from memory — so a second server over the one another
process already holds refuses at exit 1, naming the pid that holds it.
\`TAGMA_DATABASE_PATH\` is the way out: a directory of one's own is a server of
one's own beside the standing one. No verb of this CLI ends a server; the pid
is named for whoever means to end that one by hand.`),
  );
