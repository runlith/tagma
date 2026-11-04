import { Effect } from 'effect';
import { LibraryUnavailable, type LoadedLibrary } from '../Library';
import { processReader as readProcesses } from '../processes';
import { BirthClock } from './clock';

export const processWorker = () => new Worker(new URL('./processes.linux.worker.ts', import.meta.url), { type: 'module' });

export const processReader = Effect.fnUntraced(function* (library: LoadedLibrary) {
  const clock = yield* Effect.try({
    try: () => BirthClock.load(library.path),
    catch: (error) => new LibraryUnavailable({ path: library.path, reason: 'load-failed', detail: String(error) }),
  });
  return yield* readProcesses(library, { compareBirth: clock.compareBirth, bornBetween: clock.bornBetween, worker: processWorker });
});
