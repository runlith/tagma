import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ACTIVATE_EXIT, type HeldExecution } from '../../holder/Holder';
import { readUntil, writeAll } from '../../holder/testing/Adapter';
import { CONTROL_VARIABLE, openHolder } from '../PosixHolder';
import { report } from './report';
import { testSystem } from '../../composition/testing/system';

const [library, state, HOLDER_PART] = process.argv.slice(2) as [string, string, string];
const ENTERED = 'entered';
const Phase = Schema.fromJsonString(Schema.Struct({ phase: Schema.optional(Schema.Number) }));

const exchange = (execution: HeldExecution, line: string) => {
  if (execution.channels._tag !== 'pipes') return Effect.die(new Error(`${execution.id} is not on pipes`));
  const { stdin, stdout } = execution.channels;
  return Effect.flatMap(writeAll(stdin!, `${line}\n`), () =>
    Effect.map(readUntil(stdout, `out:${line}`), (bytes) => bytes.includes(Buffer.from(`out:${line}`))),
  );
};

const candidate = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const next = join(state, 'bundle.next');
  yield* files.makeDirectory(join(next, 'native'), { recursive: true });
  yield* files.makeDirectory(join(next, 'runtime'), { recursive: true });
  yield* files.makeDirectory(join(next, 'host'), { recursive: true });
  yield* files.copyFile(join(state, 'bundle', HOLDER_PART), join(next, HOLDER_PART));
  yield* files.chmod(join(next, HOLDER_PART), 0o755);
  yield* files.symlink(process.execPath, join(next, 'runtime/bun'));
  yield* files.writeFileString(join(next, 'host/entry.ts'), `await import(${JSON.stringify(import.meta.path)});\n`);
  yield* files.writeFileString(
    join(next, 'holder.entry'),
    [
      `holder ${HOLDER_PART}`,
      'bundle runtime/bun',
      'bundle host/entry.ts',
      `text ${library}`,
      `text ${state}`,
      `text ${HOLDER_PART}`,
      `text ${ENTERED}`,
      '',
    ].join('\n'),
  );
});

const visit = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const holder = yield* openHolder(library, Number(process.env[CONTROL_VARIABLE]), (yield* testSystem).processWorker);
  const reported = yield* files
    .readFileString(join(state, 'report.jsonl'))
    .pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('')));
  const phases = yield* Effect.forEach(reported.trim().split('\n').filter(Boolean), (line) => Schema.decodeUnknownEffect(Phase)(line));

  if (phases.length === 0) {
    const echo = yield* holder.launch({
      id: 'echo',
      path: '/bin/sh',
      argv: ['sh', '-c', 'while IFS= read -r line; do echo "out:$line"; done'],
      env: [{ name: 'PATH', value: '/usr/bin:/bin' }],
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    yield* holder.ready;
    const before = yield* exchange(echo, 'one');
    yield* candidate;
    yield* report(state, { phase: 1, pid: echo.pid, before });
    process.exit(ACTIVATE_EXIT);
  }

  const echo = holder.held.find((execution) => execution.id === 'echo')!;
  const after = yield* exchange(echo, 'two');
  yield* report(state, { phase: 2, pid: echo.pid, after, entered: process.argv.includes(ENTERED) });
  if (echo.channels._tag === 'pipes') yield* echo.closeInput;
  yield* echo.exit;
  yield* echo.reap;
  yield* echo.release;
  yield* holder.vacate;
});

await Effect.runPromise(visit.pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))).catch(async (error: unknown) => {
  await Effect.runPromise(report(state, { failed: String(error) }).pipe(Effect.provide(BunFileSystem.layer)));
  process.kill(process.ppid, 'SIGKILL');
});
