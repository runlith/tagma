import { dirname, join } from 'node:path';
import { Clock, Data, Effect, FileSystem, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Processes, type ProcessReader } from '@runlith/execution-host/ProcessReader';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { ASKED_EVERY_MS } from '../contract/wire/layout.js';
import {
  PROCESS_CHAIN,
  PROCESS_RECORD,
  type ProcessChain,
  type ProcessChainRecord,
  processChainRecordSchema,
  processChainSchema,
} from '../contract/wire/process.js';

export class ProcessChainRefused extends Data.TaggedError('ProcessChainRefused')<{
  readonly detail: string;
  readonly reason?: 'stopping' | 'replaced';
}> {}

const refused = (cause: unknown) => (cause instanceof ProcessChainRefused ? cause : new ProcessChainRefused({ detail: String(cause) }));
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(processChainRecordSchema));

export const inheritedChain = (env: NodeJS.ProcessEnv): ProcessChain | undefined => {
  const value = env[PROCESS_CHAIN];
  return value === undefined ? undefined : Schema.decodeUnknownSync(Schema.fromJsonString(processChainSchema))(value);
};

const read = Effect.fn('ProcessChain.read')(function* (reference: ProcessChain) {
  const files = yield* FileSystem.FileSystem;
  const record = yield* files.readFileString(reference.path).pipe(Effect.flatMap(decode), Effect.mapError(refused));
  if (record.id !== reference.id)
    return yield* new ProcessChainRefused({ detail: 'this process generation was replaced by another launch', reason: 'replaced' });
  return record;
});

const write = Effect.fn('ProcessChain.write')(function* (reference: ProcessChain, record: ProcessChainRecord) {
  const files = yield* FileSystem.FileSystem;
  const temporary = `${reference.path}.${process.pid}.writing`;
  yield* files.makeDirectory(dirname(reference.path), { recursive: true });
  yield* files.writeFileString(temporary, JSON.stringify(record));
  yield* files.rename(temporary, reference.path);
}, Effect.mapError(refused));

const locked = <A, E, R>(reference: ProcessChain, work: Effect.Effect<A, E, R>) =>
  withFileLock(`${reference.path}.lock`, Number.POSITIVE_INFINITY, () => work).pipe(
    Effect.mapError(refused),
    Effect.provide(BunFileSystem.layer),
  );

export const checkChain = (reference: ProcessChain): Effect.Effect<void, ProcessChainRefused> =>
  read(reference).pipe(
    Effect.flatMap((record) =>
      record.stopping
        ? Effect.fail(new ProcessChainRefused({ detail: 'this process generation is stopping', reason: 'stopping' }))
        : Effect.void,
    ),
    Effect.provide(BunFileSystem.layer),
  );

const witness = (reader: ProcessReader, pid: number): ProcessWitness | ProcessChainRefused => {
  const current = reader.identity(pid);
  return current._tag === 'Read' && !current.zombie
    ? { pid: current.pid, birth: current.birth }
    : new ProcessChainRefused({
        detail: current._tag === 'Unreadable' ? current.detail : `pid ${pid} left before its birth could be recorded`,
      });
};

const alive = (reader: ProcessReader, member: ProcessWitness): boolean | ProcessChainRefused => {
  const current = reader.identity(member.pid);
  if (current._tag === 'Unreadable') return new ProcessChainRefused({ detail: current.detail });
  return current._tag === 'Read' && !current.zombie && current.birth === member.birth;
};

export type Chain = Effect.Success<ReturnType<typeof makeProcessChain>>;

export const forkChain = <A extends { readonly pid: number }>(
  reader: ProcessReader,
  reference: ProcessChain,
  spawn: () => A,
): Effect.Effect<A, ProcessChainRefused> =>
  locked(
    reference,
    Effect.gen(function* () {
      const record = yield* read(reference);
      if (record.stopping) return yield* new ProcessChainRefused({ detail: 'this process generation is stopping', reason: 'stopping' });
      const members: ProcessChainRecord['members'][number][] = [];
      for (const member of record.members) {
        const current = alive(reader, member);
        if (current instanceof ProcessChainRefused) return yield* current;
        if (current) members.push(member);
      }
      const child = yield* Effect.try({ try: spawn, catch: refused });
      const childWitness = witness(reader, child.pid);
      if (childWitness instanceof ProcessChainRefused) {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') return yield* refused(cause);
        }
        return yield* childWitness;
      }
      yield* write(reference, { ...record, members: [...members, { ...childWitness, admitted: false }] }).pipe(
        Effect.onExit((exit) => (exit._tag === 'Failure' ? signalled(reader, childWitness, 'SIGKILL').pipe(Effect.orDie) : Effect.void)),
      );
      return child;
    }),
  ).pipe(Effect.provide(BunFileSystem.layer));

export const makeProcessChain = Effect.fnUntraced(function* (data: string, cli: string | null = null, admitted = true) {
  const reader = yield* Processes;
  const inherited = yield* Effect.try({ try: () => inheritedChain(process.env), catch: refused });
  delete process.env[PROCESS_CHAIN];
  const reference: ProcessChain = inherited ?? { id: crypto.randomUUID(), path: join(data, PROCESS_RECORD) };
  const own = witness(reader, process.pid);
  if (own instanceof ProcessChainRefused) {
    if (inherited !== undefined) return yield* own;
    yield* Effect.logWarning('process generation cannot prove its members', { detail: own.detail });
    return null;
  }
  yield* locked(
    reference,
    Effect.gen(function* () {
      const record = inherited === undefined ? { id: reference.id, stopping: false, cli, members: [] } : yield* read(reference);
      if (record.stopping) return yield* new ProcessChainRefused({ detail: 'this process generation is stopping', reason: 'stopping' });
      const members = record.members.filter((member) => member.pid !== own.pid);
      yield* write(reference, { ...record, members: [...members, { ...own, admitted }] });
    }),
  );
  const stop = locked(
    reference,
    Effect.gen(function* () {
      const record = yield* read(reference);
      const stopped = { ...record, stopping: true };
      yield* write(reference, stopped);
      return stopped.members;
    }),
  );
  return {
    reference,
    environment: { [PROCESS_CHAIN]: JSON.stringify(reference) },
    check: checkChain(reference),
    stop,
    fork: <A extends { readonly pid: number }>(spawn: () => A): Effect.Effect<A, ProcessChainRefused> =>
      forkChain(reader, reference, spawn),
  };
});

const signalled = (reader: ProcessReader, member: ProcessWitness, signal: NodeJS.Signals): Effect.Effect<void, ProcessChainRefused> =>
  Effect.try({
    try: () => {
      const current = alive(reader, member);
      if (current instanceof ProcessChainRefused) throw current;
      if (!current) return;
      try {
        process.kill(member.pid, signal);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
      }
    },
    catch: refused,
  });

export const chainAt = Effect.fn('ProcessChain.at')(function* (data: string) {
  const files = yield* FileSystem.FileSystem;
  const path = join(data, PROCESS_RECORD);
  return yield* files.readFileString(path).pipe(
    Effect.flatMap(decode),
    Effect.map((record) => ({ reference: { path, id: record.id }, cli: record.cli })),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.mapError(refused),
  );
}, Effect.provide(BunFileSystem.layer));

export const stopChain = Effect.fn('ProcessChain.stop')(function* (reference: ProcessChain) {
  const reader = yield* Processes;
  const members = yield* locked(
    reference,
    Effect.gen(function* () {
      const record = yield* read(reference);
      yield* write(reference, { ...record, stopping: true });
      return record.members;
    }),
  );
  const stopped = yield* stopMembers(reader, members);
  if (members.some((member) => !member.admitted))
    return yield* new ProcessChainRefused({
      detail: 'a successor did not confirm the cancellable process-generation protocol, so an automatic return may be unrecorded',
    });
  return stopped;
});

export const stopProcess = Effect.fn('ProcessChain.stopProcess')(function* (member: ProcessWitness) {
  return yield* stopMembers(yield* Processes, [member]);
});

const stopMembers = Effect.fnUntraced(function* (reader: ProcessReader, members: readonly ProcessWitness[]) {
  let running = false;
  for (const member of members) {
    const current = alive(reader, member);
    if (current instanceof ProcessChainRefused) return yield* current;
    running ||= current;
    yield* signalled(reader, member, 'SIGTERM');
  }
  const began = yield* Clock.currentTimeMillis;
  let killed = false;
  for (;;) {
    const staying: ProcessWitness[] = [];
    for (const member of members) {
      const current = alive(reader, member);
      if (current instanceof ProcessChainRefused) return yield* current;
      if (current) staying.push(member);
    }
    if (staying.length === 0) return { killed, members, running };
    if (!killed && (yield* Clock.currentTimeMillis) - began >= 90_000) {
      for (const member of staying) yield* signalled(reader, member, 'SIGKILL');
      killed = true;
    }
    yield* Effect.sleep(ASKED_EVERY_MS);
  }
});

export const waitingForStop = (reference: ProcessChain): Effect.Effect<never, ProcessChainRefused> =>
  Effect.forever(Effect.andThen(checkChain(reference), Effect.sleep(ASKED_EVERY_MS)));
