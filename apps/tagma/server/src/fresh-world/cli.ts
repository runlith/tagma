import { resolve } from 'node:path';
import { Console, Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import { refuse, noting, CurrentInvocation, print } from '../platform/cli/verb.js';
import { json } from '../installation/cli/server.js';
import type { ServerCli } from '../installation/cli/port.js';
import type { Standing } from './contract/service/world.js';
import { FRESH_OPERATIONS } from './contract/wire/operations.js';

const over = Flag.Boolean('over').pipe(
  Flag.withDefault(false),
  Flag.withDescription('quit the fresh world, remove everything it wrote and open the release on its first launch'),
);
const release = Flag.String('release').pipe(
  Flag.optional,
  Flag.withMetavar('version'),
  Flag.withDescription('start over on this release of the feed'),
);
const from = Flag.String('from').pipe(
  Flag.optional,
  Flag.withMetavar('path'),
  Flag.withDescription('start over on a local .app, .dmg or release archive'),
);
const status = Flag.Boolean('status').pipe(
  Flag.withDefault(false),
  Flag.withDescription('say where the fresh world stands, opening nothing'),
);

const said = (standing: Standing): string =>
  standing.release === null
    ? `no fresh world stands in ${standing.root}`
    : `release ${standing.release} in ${standing.root} — ${standing.running ? `running at ${standing.url}` : 'closed'}`;

export const fresh = ({ perform, baseUrl, healthOrNone, here }: ServerCli) =>
  Command.make('fresh', { json, over, release, from, status }, (o) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      if ((yield* healthOrNone()) === null) {
        return refuse('server-not-up', `nothing answers at ${baseUrl(at)}; the server opens the fresh world`, ['tagma web — start it']);
      }
      if (o.status) {
        if (o.over || Option.isSome(o.release) || Option.isSome(o.from)) {
          return refuse('fresh-status', 'reading the fresh world and opening it are two acts, and this verb runs one', [
            'tagma fresh --status',
            'tagma fresh --over',
          ]);
        }
        const read = yield* perform(FRESH_OPERATIONS.read_fresh_world, {}, here(at));
        if (read.status !== 'read') return yield* Effect.fail(new Error('read_fresh_world answered outside its read shape'));
        return yield* o.json ? print(read, true) : Console.log(said(read));
      }
      const opened = yield* perform(
        FRESH_OPERATIONS.open_fresh_world,
        {
          ...(o.over ? { over: true } : {}),
          ...Option.match(o.release, { onNone: () => ({}), onSome: (value) => ({ release: value }) }),
          ...Option.match(o.from, { onNone: () => ({}), onSome: (value) => ({ from: resolve(value) }) }),
        },
        here(at),
      );
      if (opened.status !== 'opened') return yield* Effect.fail(new Error('open_fresh_world answered outside its opened shape'));
      if (o.json) return yield* print(opened, true);
      yield* Console.log(opened.started ? `opened ${said(opened)}` : `brought forward ${said(opened)}`);
    }),
  ).pipe(
    Command.withDescription(
      'open the published release beside this Tagma in a world of its own, as a new user gets it; --over starts it over',
    ),
    noting(`The fresh world stands in ~/.tagma-fresh with a home of its own: its data, keychain,
junction and Claude Code and Codex configs belong to nobody else, and this Tagma keeps
running untouched. While it runs, the verb brings its window forward. \`--over\`,
\`--release\` and \`--from\` start it over: the world quits, everything it wrote and what
macOS keeps for its bundle are removed, and the release opens on its first launch. The
release is the newest of the release feed unless \`--release\` names another; a release
taken once is kept, so starting over downloads nothing.`),
  );
