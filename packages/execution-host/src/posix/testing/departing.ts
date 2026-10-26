import { join } from 'node:path';
import { Cause, Clock, Effect, FileSystem, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { CONTROL_VARIABLE, openHolder } from '../PosixHolder';
import { report } from './report';

const [library, state] = process.argv.slice(2) as [string, string];
const DEPARTED = join(state, 'departed');
const Departure = Schema.fromJsonString(Schema.Struct({ logic: Schema.Number, child: Schema.Number, at: Schema.Number }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};

const depart = Effect.scoped(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const holder = yield* openHolder(library, Number(process.env[CONTROL_VARIABLE]));
    const child = yield* holder.launch({
      id: 'held',
      path: '/bin/sh',
      argv: ['sh', '-c', 'read x'],
      env: [{ name: 'PATH', value: '/usr/bin:/bin' }],
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    yield* holder.ready;
    yield* files.writeFileString(
      DEPARTED,
      yield* Schema.encodeEffect(Departure)({
        logic: process.pid,
        child: child.pid,
        at: yield* Clock.currentTimeMillis,
      }),
    );
  }),
);

const follow = Effect.scoped(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const departed = yield* Schema.decodeUnknownEffect(Departure)(yield* files.readFileString(DEPARTED));
    const firstAlive = yield* Effect.try({
      try: () => alive(departed.logic),
      catch: (cause) => new Cause.UnknownError(cause, String(cause)),
    });
    const holder = yield* openHolder(library, Number(process.env[CONTROL_VARIABLE]));
    const held = holder.held.map((execution) => execution.pid);
    yield* report(state, {
      phase: 2,
      logic: process.pid,
      first: departed.logic,
      firstAlive,
      waited: (yield* Clock.currentTimeMillis) - departed.at,
      held,
      child: departed.child,
    });
    for (const execution of holder.held) {
      yield* execution.act('work', 'kill');
      yield* execution.exit;
      yield* execution.reap;
      yield* execution.release;
    }
    yield* holder.vacate;
  }),
);

const departed = await Effect.runPromise(
  Effect.flatMap(FileSystem.FileSystem, (files) => files.exists(DEPARTED)).pipe(Effect.provide(BunFileSystem.layer)),
);
if (!departed) {
  await Effect.runPromise(depart.pipe(Effect.provide(BunFileSystem.layer))).catch((error: unknown) =>
    Effect.runPromise(report(state, { failed: String(error) }).pipe(Effect.provide(BunFileSystem.layer))),
  );
  process.on('SIGTERM', () => {});
  await Effect.runPromise(Effect.forever(Effect.sleep(1 << 30)));
} else {
  await Effect.runPromise(follow.pipe(Effect.provide(BunFileSystem.layer))).catch(async (error: unknown) => {
    await Effect.runPromise(report(state, { failed: String(error) }).pipe(Effect.provide(BunFileSystem.layer)));
    process.kill(process.ppid, 'SIGKILL');
  });
}
