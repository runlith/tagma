import { Effect, Layer } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { ChildLedger } from '../contract/service/children.js';
import type { ChildRole } from '../contract/wire/children.js';
import { ThreadId } from '../contract/wire/thread.js';
import { NATIVE_HARNESS } from '../contract/wire/session.js';
import { SignedSession } from '../contract/service/writers.js';

export const ledgeredSpawner = (
  role: ChildRole,
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.map(ChildProcessSpawner.ChildProcessSpawner, (base) =>
      ChildProcessSpawner.make((command) =>
        Effect.gen(function* () {
          const ledger = yield* ChildLedger;
          const session = yield* SignedSession;
          const handle = yield* base.spawn(command);
          const release = ledger.record({
            pid: handle.pid,
            role,
            thread: session?.harness === NATIVE_HARNESS ? ThreadId.make(session.key) : undefined,
          });
          yield* Effect.addFinalizer(() => Effect.sync(release));
          return handle;
        }),
      ),
    ),
  );
