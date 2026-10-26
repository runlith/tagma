import { Console, Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import { CHANNELS, type Channel } from '../contract/wire/channel.js';
import { InstalledChannel } from '../contract/service/channel.js';
import { migrationsFolder } from '../closure/read.js';
import { refuse, CurrentInvocation } from '../../platform/cli/verb.js';
import { transferWorld, type WorldParts } from '../move/transfer.js';

export const transfer = (parts: WorldParts) =>
  Command.make(
    'transfer',
    {
      from: Flag.ChoiceWithValue(
        'from',
        Object.values(CHANNELS).map((channel): readonly [string, Channel] => [channel.id, channel]),
      ).pipe(Flag.withDescription('the channel whose world this one is filled from')),
    },
    ({ from }) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const to = yield* InstalledChannel;
        const done = yield* Effect.result(transferWorld(from, to, at.env, parts, migrationsFolder));
        if (done._tag === 'Failure') return refuse(done.failure.code, done.failure.reason, [...done.failure.unblock]);
        const moved = done.success;
        yield* Console.log(`${moved.data.from} → ${moved.data.to}`);
        for (const path of moved.carried) yield* Console.log(`carried ${path}`);
        yield* Console.log(`${moved.rows.reduce((sum, row) => sum + row.rows, 0)} stored paths now name ${moved.data.to}`);
        for (const miss of moved.misses) yield* Console.log(`not carried (${miss.owner}): ${miss.path} — ${miss.detail}`);
        yield* Console.log(`${to.command} web — brings ${to.name} up on the world it was given`);
        if (moved.misses.length > 0) process.exitCode = 1;
      }),
  ).pipe(
    Command.withDescription(
      "fill this channel's empty world with a copy of another channel's: its database, thread rollouts and graphs; the source stays as it is",
    ),
  );
