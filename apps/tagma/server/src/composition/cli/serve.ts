import { Effect } from 'effect';
import { Command } from 'effect/cli';
import { noting } from '../../platform/cli/verb.js';
import type { Build } from '../build.js';

export const serveCommand = (build: Build, server: () => Promise<unknown>) =>
  Command.make('serve', {}, () =>
    Effect.promise(() => Promise.all([import('../attempt.js'), import('../returning.js')])).pipe(
      Effect.flatMap(([{ arrival, beforeDoor }, { returnedBeforeServing }]) =>
        Effect.andThen(returnedBeforeServing(build), Effect.andThen(arrival(build.channel), beforeDoor(Effect.promise(server)))),
      ),
      Effect.asVoid,
    ),
  ).pipe(
    Command.withDescription(`start the ${build.channel.name} server on port ${build.channel.port} (TAGMA_PORT overrides)`),
    noting(`ONE process owns a data directory — its database, its thread rollouts and the event
positions it mints from memory — so a second server over the one another
process already holds refuses at exit 1, naming the pid that holds it.
\`TAGMA_DATABASE_PATH\` is the way out: a directory of one's own is a server of
one's own beside the standing one. No verb of this CLI ends a server; the pid
is named for whoever means to end that one by hand.`),
  );
