import { Effect, Queue, Stream } from 'effect';
import { type WatchEvent, watchAll } from '../../platform/watch/tree.js';
import type { CheckoutShift, Following, PathMove, ShiftRescan } from '../../workspace/contract/service/watch.js';

const POLL_MS = 2_000;

const makeShifts = () => {
  let paths = new Map<string, PathMove>();
  let rescan: ShiftRescan | null = null;
  let named = false;

  const widen = (reason: ShiftRescan): void => {
    rescan ??= reason;
    paths = new Map();
    named = true;
  };

  const name = (held: readonly string[], move: PathMove): void => {
    named = true;
    if (rescan !== null) return;
    for (const path of held) if (move === 'rename' || paths.get(path) !== 'rename') paths.set(path, move);
  };

  const shifts = {
    wake: null as (() => void) | null,

    get waiting() {
      return named;
    },

    add: (event: WatchEvent): void => {
      if ('rescan' in event) {
        if (event.rescan === 'opened') return;
        if (event.rescan === 'rename' && event.paths !== undefined) name(event.paths, 'rename');
        else widen(event.rescan === 'rename' ? 'unnamed' : event.rescan);
      } else name(event.paths, 'change');
      shifts.wake?.();
    },

    widen,

    take: (): CheckoutShift | null => {
      if (!named) return null;
      const taken: CheckoutShift = { movements: ['tree'], paths, rescan };
      paths = new Map();
      rescan = null;
      named = false;
      return taken;
    },
  };
  return shifts;
};

export const makeFolderWatches = (pollMs: number = POLL_MS) => ({
  follow: Effect.fnUntraced(function* (dir: string) {
    const shifts = makeShifts();
    let poll: ReturnType<typeof setInterval> | null = null;
    let released = false;
    const polling = (): void => {
      if (poll !== null || released) return;
      poll = setInterval(() => {
        shifts.widen('polling');
        shifts.wake?.();
      }, pollMs);
      poll.unref();
    };
    const watch = yield* watchAll([
      {
        at: dir,
        recursive: false,
        required: true,
        listen: (event) => {
          shifts.add(event);
          if ('rescan' in event && (event.rescan === 'error' || event.rescan === 'lost' || event.rescan === 'polling')) polling();
        },
      },
    ]);
    if (!watch.watching()) polling();
    return {
      shifts: Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              shifts.wake = () => void Queue.offerUnsafe(queue, undefined);
              if (shifts.waiting) shifts.wake();
            }),
            () => Effect.sync(() => void (shifts.wake = null)),
          ),
        { bufferSize: 1, strategy: 'sliding' },
      ).pipe(
        Stream.map(() => shifts.take()),
        Stream.filter((shift): shift is CheckoutShift => shift !== null),
      ),
      watching: () => !released && watch.watching(),
      release: () => {
        if (released) return;
        released = true;
        if (poll !== null) clearInterval(poll);
        watch.close();
      },
    } satisfies Following;
  }),
});

export type FolderWatches = ReturnType<typeof makeFolderWatches>;
