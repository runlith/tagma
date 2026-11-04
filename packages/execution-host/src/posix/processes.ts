import { Effect, type Scope } from 'effect';
import { ProcessesUnreadable, type ProcessReader, type ProcessProbe } from '../ProcessReader';
import type { LoadedLibrary } from './Library';
import { leaseProcessWorker, type WorkerUnanswered } from './ProcessWorker';
import type { Refused } from './refusal';

type ProcessSystem = {
  readonly compareBirth: ProcessReader['compareBirth'];
  readonly bornBetween: ProcessReader['bornBetween'];
  readonly worker: () => Worker;
};

const refusedRead = <A extends object>(read: A | Refused): read is Refused => !Array.isArray(read) && 'refusal' in read;

const answered = <A extends object>(read: A | Refused): Effect.Effect<A, ProcessesUnreadable> =>
  refusedRead(read)
    ? Effect.fail(new ProcessesUnreadable({ detail: read.detail === '' ? read.refusal : read.detail }))
    : Effect.succeed(read);

const unreadable = (failure: WorkerUnanswered) => new ProcessesUnreadable({ detail: failure.detail });

export const processReader = Effect.fnUntraced(function* (
  library: LoadedLibrary,
  system: ProcessSystem,
): Effect.fn.Return<ProcessReader, never, Scope.Scope> {
  const { compareBirth, bornBetween } = system;
  const worker = yield* leaseProcessWorker(library.path, system.worker);
  const scan = (request: ProcessProbe) =>
    Effect.flatMap(worker, (one) => one.scan(request)).pipe(
      Effect.mapError(unreadable),
      Effect.flatMap(answered),
      Effect.withSpan('Processes.scan'),
    );
  const table = scan({ _tag: 'Table' });
  const identity: ProcessReader['identity'] = (pid) => {
    const read = library.abi.processIdentity(pid);
    return 'refusal' in read ? { _tag: 'Unreadable', detail: read.detail || read.refusal } : read;
  };
  return {
    scan,
    table,
    members: (work) => Effect.map(table, (rows) => rows.filter((row) => row.work === work)),
    facts: (pids) =>
      Effect.flatMap(worker, (one) => one.facts(pids)).pipe(
        Effect.mapError(unreadable),
        Effect.flatMap(answered),
        Effect.withSpan('Processes.facts'),
      ),
    identity,
    resolve: (part) => {
      const read = identity(part.pid);
      if (read._tag !== 'Read' || read.pid !== part.pid) return 'unknown';
      const matched = bornBetween(read.birth, part.createdMs - part.precisionMs, part.createdMs + part.precisionMs);
      if (matched instanceof ProcessesUnreadable) return 'unknown';
      return matched ? { pid: read.pid, birth: read.birth } : 'different';
    },
    compareBirth,
    bornBetween,
  };
});
