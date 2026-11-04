import { Data, Effect, FileSystem } from 'effect';

class ProcUnreadable extends Data.TaggedError('ProcUnreadable')<{ readonly region: string; readonly detail: string }> {
  override get message(): string {
    return `${this.region}: ${this.detail}`;
  }
}

export const pids = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const names = yield* files
    .readDirectory('/proc')
    .pipe(Effect.mapError((error) => new ProcUnreadable({ region: '/proc', detail: error.message })));
  return names.filter((name) => /^[1-9]\d*$/u.test(name)).map(Number);
});

export const statusOf = Effect.fn('linux.proc.status')(function* (pid: number) {
  const files = yield* FileSystem.FileSystem;
  const path = `/proc/${pid}/status`;
  const read = yield* files.readFileString(path).pipe(
    Effect.map((text) => ({ _tag: 'Read' as const, text })),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed({ _tag: 'Gone' as const })),
    Effect.mapError((error) => new ProcUnreadable({ region: path, detail: error.message })),
  );
  if (read._tag === 'Gone') return read;
  const uid = /^Uid:\s+(\d+)/mu.exec(read.text);
  const state = /^State:\s+(\S+)/mu.exec(read.text);
  const threads = /^Threads:\s+(\d+)/mu.exec(read.text);
  if (uid === null || state === null || threads === null)
    return yield* new ProcUnreadable({ region: path, detail: 'the status has no readable UID, process state or thread count' });
  return { _tag: 'Read' as const, uid: Number(uid[1]), state: state[1]!, threads: Number(threads[1]) };
});

export const linksOf = Effect.fn('linux.proc.descriptors')(function* (pid: number) {
  const files = yield* FileSystem.FileSystem;
  const root = `/proc/${pid}/fd`;
  const listed = yield* files
    .readDirectory(root)
    .pipe(Effect.mapError((error) => new ProcUnreadable({ region: root, detail: error.message })));
  const links: string[] = [];
  for (const fd of listed) {
    const read = yield* files.readLink(`${root}/${fd}`).pipe(
      Effect.map((target) => ({ _tag: 'Read' as const, target })),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed({ _tag: 'Closed' as const })),
      Effect.mapError((error) => new ProcUnreadable({ region: `${root}/${fd}`, detail: error.message })),
    );
    if (read._tag === 'Read') links.push(read.target);
  }
  return links;
});
