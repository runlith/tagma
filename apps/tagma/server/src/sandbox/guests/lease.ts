import { declare } from '@runlith/held/Held';
import { Context, Effect } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { uuidv7 } from 'uuidv7';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { SandboxManifest, SandboxRecord, SandboxSource } from '../contract/wire/sandbox.js';
import { SandboxFiles } from '../contract/service/files.js';
import { GuestWorlds } from '../contract/service/guests.js';
import { CommitUnreadable, type GuestPreparation } from '../contract/service/preparation.js';
import { PreparedTrees } from '../contract/service/preparedTrees.js';
import {
  type BoundThread,
  SandboxBindingConflict,
  SandboxHeldConflict,
  Sandboxes,
  SandboxUnavailable,
} from '../contract/service/sandboxes.js';
import type { GuestBackend } from '../contract/service/backends.js';
import { SandboxHolds } from '../contract/service/holds.js';
import type { SandboxStore } from '../store/sandboxes.js';
import { resolveCommit } from '../trees/snapshot.js';
import { buildGuest } from './build.js';
import { readGuestFile } from './reads.js';
import { releaseGuest } from './release.js';
import { type ThreadWorld, WorldUnavailable } from '../../executions/contract/service/worlds.js';

export function guestPreparation(checkoutOf: (projectId: number) => Effect.Effect<string, Error>): GuestPreparation['Service'] {
  return {
    commitOf: (projectId, name) =>
      checkoutOf(projectId).pipe(
        Effect.mapError((failure) => new CommitUnreadable({ commit: name, reason: `its project could not be read: ${failure.message}` })),
        Effect.flatMap((checkout) => resolveCommit(checkout, name)),
        Effect.mapError((failure) =>
          failure._tag === 'CommitUnreadable' ? failure : new CommitUnreadable({ commit: name, reason: failure.message }),
        ),
      ),
  };
}

export const makeSandboxes = Effect.fnUntraced(function* (input: {
  readonly store: SandboxStore;
  readonly runtime: GuestBackend;
  readonly checkoutOf: (projectId: number) => Effect.Effect<string, Error>;
  readonly exportsRoot: string;
}) {
  const { store, runtime, checkoutOf, exportsRoot } = input;
  const preparedTrees = yield* PreparedTrees;
  const holds = yield* SandboxHolds;
  const reading = new Map<string, number>();
  const gates = declare<string>({
    name: 'sandbox/gate',
    owner: 'sandbox',
    rank: 510,
    key: (id) => id,
    concurrency: 1,
    threshold: '1 second',
    ceilings: {
      hold: '30 seconds',
      wait: '1 minute',
      leaves: 'the birth or read waiting on this sandbox refuses, and a cut birth fails its unit, which rolls its binding back',
    },
    external: 'none',
  });
  const releasing = new Set<string>();

  const refuse = (said: string) => {
    const colon = said.indexOf(':');
    const code = colon > 0 ? said.slice(0, colon) : 'sandbox-refused';
    return Effect.fail(
      new ThreadCallBroke({
        cause: new GateRefusal(code, said, [
          'prepare a sandbox for this project and name the id it answers with',
          'read the sandbox to see what state it is in and who holds it',
        ]),
      }),
    );
  };

  const refuseRead = (id: string, reason: string) => new SandboxUnavailable({ sandbox: id, reason });

  const dropRead = (id: string): void => {
    const held = (reading.get(id) ?? 1) - 1;
    if (held <= 0) reading.delete(id);
    else reading.set(id, held);
  };

  const projectOf = (source: SandboxSource): Effect.Effect<number | null, ThreadStorageFailed> => {
    if (source.kind === 'project') return Effect.succeed(source.projectId);
    if (source.kind === 'empty') return Effect.succeed(null);
    return Effect.map(preparedTrees.byId(source.preparedTree), (artifact) => artifact?.projectId ?? null);
  };

  const guestOf = Effect.fnUntraced(function* (row: SandboxRecord, manifest: SandboxManifest) {
    const guest = yield* runtime.inspect(row.runtime, { limits: manifest.limits, image: manifest.image });
    const refused =
      guest.status === 'gone'
        ? 'its guest is gone'
        : guest.image !== manifest.image.digest
          ? `its guest runs ${guest.image ?? 'no image'}, not the ${manifest.image.digest} it was prepared against`
          : guest.mismatch !== null
            ? `its guest no longer stands at the boundary it was prepared with: ${guest.mismatch}`
            : null;
    if (refused !== null) return yield* new SandboxUnavailable({ sandbox: row.id, reason: refused });
    return guest;
  });

  const acquire = Effect.fn('Sandboxes.acquire')(function* (thread: BoundThread) {
    const named = thread.hostId;
    if (thread.hostKind !== 'sandbox' || named === null) {
      return yield* new SandboxUnavailable({
        sandbox: thread.id,
        reason: 'this thread is bound to no sandbox',
      });
    }
    const row = yield* store.byId(named);
    if (!row || row.manifest === null) {
      return yield* new SandboxUnavailable({
        sandbox: named,
        reason: 'no prepared sandbox stands under that name',
      });
    }
    if (row.boundThreadId !== thread.id) {
      return yield* new SandboxUnavailable({
        sandbox: named,
        reason: row.boundThreadId === null ? 'nothing holds it' : `thread ${row.boundThreadId} holds it`,
      });
    }
    if (row.state !== 'prepared') {
      return yield* new SandboxUnavailable({
        sandbox: named,
        reason: `its preparation is ${row.state}${row.failureReason ? `: ${row.failureReason}` : ''}`,
      });
    }
    const guest = yield* guestOf(row, row.manifest);
    if (guest.status === 'stopped') yield* runtime.start(row.runtime);
    return row;
  });

  const world = (thread: BoundThread) => Effect.flatMap(acquire(thread), (row) => runtime.world(row.runtime));

  const finishRelease = Effect.fnUntraced(function* (row: SandboxRecord) {
    if (releasing.has(row.id)) return yield* new SandboxHeldConflict({ sandbox: row.id, holder: 'a release already running' });
    releasing.add(row.id);
    return yield* releaseGuest(row, runtime, store, exportsRoot, reading.get(row.id) ?? 0).pipe(
      Effect.ensuring(Effect.sync(() => releasing.delete(row.id))),
    );
  });

  const sandboxes = Sandboxes.of({
    prepare: Effect.fn('Sandboxes.prepare')(function* (request) {
      const id = uuidv7();
      const receipt = runtime.receipt(id);
      const opened = yield* store.open({
        id,
        projectId: yield* projectOf(request.source),
        ownerId: request.ownerId,
        runtime: receipt,
      });
      const manifest = yield* buildGuest(opened, request, runtime, preparedTrees, checkoutOf).pipe(
        Effect.tapError((failure) => store.failed(id, failure.message)),
      );
      const prepared = yield* store.prepared(id, manifest);
      if (!prepared) {
        const now = yield* store.byId(id);
        return yield* new SandboxUnavailable({
          sandbox: id,
          reason: `it became ${now?.state ?? 'unknown'} while it was being prepared, so nothing was prepared`,
        });
      }
      return { ...opened, state: 'prepared' as const, manifest };
    }),

    byId: store.byId,

    ofThread: store.ofThread,

    records: store.standing,

    admit: Effect.fn('Sandboxes.admit')(function* (input, tx) {
      if (input.host.kind !== 'sandbox') {
        return yield* refuse(`host-unknown: this host admits no ${input.host.kind} binding; the one surface it binds is a sandbox.`);
      }
      const bind = Effect.gen(function* () {
        const reads = reading.get(input.host.id) ?? 0;
        if (reads > 0) {
          return yield* refuse(
            `sandbox-reading: ${input.host.id} is being read into a checkout by ${reads} call${reads === 1 ? '' : 's'}; a thread is not born onto a tree an import is sealing.`,
          );
        }
        const row = yield* store.byId(input.host.id, tx);
        if (!row) {
          return yield* refuse(
            new SandboxUnavailable({
              sandbox: input.host.id,
              reason: 'no such sandbox',
            }).message,
          );
        }
        if (input.carried !== 'fresh') {
          return yield* refuse(
            `sandbox-unavailable: ${row.id} — a bound thread starts fresh, and this birth carries ${input.carried} of its source's conversation.`,
          );
        }
        const wrong =
          row.projectId !== null && row.projectId !== input.projectId
            ? `it was prepared for project ${row.projectId}`
            : row.ownerId !== input.child.ownerId
              ? 'it was prepared by another owner'
              : row.state !== 'prepared'
                ? `its preparation is ${row.state}${row.failureReason ? `: ${row.failureReason}` : ''}`
                : row.manifest === null
                  ? 'it carries no manifest'
                  : null;
        if (wrong !== null) {
          return yield* refuse(new SandboxUnavailable({ sandbox: row.id, reason: wrong }).message);
        }
        if (row.boundThreadId !== null && row.boundThreadId !== input.child.id) {
          return yield* refuse(new SandboxBindingConflict({ sandbox: row.id, holder: row.boundThreadId }).message);
        }
        const took = yield* store.bind(row.id, input.child.id, tx);
        if (!took) return yield* refuse(`sandbox-taken: ${row.id} was bound by another birth while this one was writing.`);
        yield* holds.hold(row.id, input.child.id, tx);
      }).pipe(Effect.withSpan('Sandboxes.bind'));
      return yield* gates.hold(input.host.id, bind).pipe(
        Effect.catchTags({
          HoldStalled: () => refuse(`sandbox-busy: ${input.host.id} is being read or bound by another call; ask again.`),
          HoldCut: () => refuse(`sandbox-busy: binding ${input.host.id} ran past its ceiling and was cut.`),
        }),
      );
    }),

    ready: (thread) =>
      thread.hostKind !== 'sandbox'
        ? Effect.void
        : Effect.asVoid(
            Effect.mapError(acquire(thread), (failure) =>
              failure._tag === 'SandboxUnavailable'
                ? new ThreadCallBroke({
                    cause: new GateRefusal('sandbox-unavailable', failure.message, [
                      'read the sandbox: its state and reason say what stopped it',
                      'prepare a fresh sandbox and bind a new thread to it',
                    ]),
                  })
                : failure,
            ),
          ),

    acquire,

    release: Effect.fn('Sandboxes.release')(function* (id) {
      const row = yield* store.byId(id);
      if (!row)
        return yield* new SandboxUnavailable({
          sandbox: id,
          reason: 'no such sandbox',
        });
      if (row.boundThreadId !== null)
        return yield* new SandboxHeldConflict({
          sandbox: id,
          holder: `thread ${row.boundThreadId}`,
        });
      if (row.state === 'released') {
        if (row.exportPath !== null) return { sandbox: id, path: row.exportPath };
        return yield* new SandboxUnavailable({
          sandbox: id,
          reason: 'it was already released',
        });
      }
      const took = yield* store.releasingUnbound(id);
      if (!took) {
        const now = yield* store.byId(id);
        const holder = now?.boundThreadId;
        return yield* new SandboxHeldConflict({
          sandbox: id,
          holder: holder ? `thread ${holder}` : 'a thread admitted meanwhile',
        });
      }
      return yield* finishRelease({
        ...row,
        state: 'releasing',
        boundThreadId: null,
      });
    }),

    discard: (id, tx) => Effect.asVoid(store.releasing(id, tx)),

    cleanup: Effect.fn('Sandboxes.cleanup')(function* (ids) {
      const rows = ids === undefined ? yield* store.standing() : yield* Effect.forEach([...new Set(ids)], (id) => store.byId(id));
      const released: string[] = [];
      for (const row of rows) {
        if (row === null || row.state !== 'releasing') continue;
        const done = yield* finishRelease(row).pipe(
          Effect.map(() => true),
          Effect.catchTag('SandboxHeldConflict', () => Effect.succeed(false)),
          Effect.catchTag(['SandboxUnavailable', 'SandboxReadConflict'], (failure) =>
            store.failedRelease(row.id, failure.message).pipe(Effect.as(false)),
          ),
        );
        if (done) released.push(row.id);
      }
      return released;
    }),

    condemnUnfinished: Effect.fn('Sandboxes.condemnUnfinished')(function* () {
      const failed: string[] = [];
      for (const row of yield* store.standing()) {
        if (row.state !== 'preparing') continue;
        yield* store.failed(row.id, 'preparation did not finish before this process ended');
        yield* store.releasing(row.id);
        failed.push(row.id);
      }
      return failed;
    }),

    reconcile: Effect.fn('Sandboxes.reconcile')(function* () {
      const rows = yield* store.standing();
      if (rows.length === 0) return { engine: 'unasked' as const, checked: 0, failed: [], removed: [] };
      const inventory = yield* runtime.receipts().pipe(
        Effect.match({
          onFailure: () => ({ engine: 'unreachable' as const, standing: null }),
          onSuccess: (standing) => ({ engine: standing === null ? ('unreachable' as const) : ('read' as const), standing }),
        }),
      );
      const standing = inventory.standing;
      if (standing === null) return { engine: inventory.engine, checked: rows.length, failed: [], removed: [] };
      const names = new Set(standing.map((receipt) => receiptName(receipt)));
      const known = new Set(rows.map((row) => receiptName(row.runtime)));
      const failed: string[] = [];
      const removed: string[] = [];
      for (const row of rows) {
        const gone = row.state === 'prepared' && !names.has(receiptName(row.runtime));
        if (gone) {
          yield* store.failed(row.id, 'its guest is gone');
          failed.push(row.id);
        }
        if (gone || row.state === 'failed') {
          yield* store.releasing(row.id);
          removed.push(receiptName(row.runtime));
        }
      }
      for (const receipt of standing) {
        if (known.has(receiptName(receipt))) continue;
        yield* runtime.remove(receipt).pipe(
          Effect.match({
            onSuccess: () => {
              removed.push(receiptName(receipt));
            },
            onFailure: () => {
              failed.push(receiptName(receipt));
            },
          }),
        );
      }
      return { engine: 'read' as const, checked: rows.length, failed, removed };
    }),
  });

  const worlds = GuestWorlds.of({
    world,
    worldHost: () => ({
      kind: 'sandbox',
      world: (thread) =>
        world(thread).pipe(
          Effect.map((tree): ThreadWorld => ({
            kind: 'sandbox',
            facts: {
              shared: false,
              history: false,
              network: tree.world.egress !== undefined,
            },
            world: tree.world,
            root: tree.root,
            scratch: tree.scratch,
            alive: tree.alive,
          })),
          Effect.catchTag('ThreadStorageFailed', Effect.die),
          Effect.catchTag(
            'SandboxUnavailable',
            (cause) =>
              new WorldUnavailable({
                threadId: thread.id,
                hostKind: thread.hostKind,
                reason: cause.message,
              }),
          ),
        ),
    }),
  });

  const files = SandboxFiles.of({
    read: Effect.fn('SandboxFiles.read')(function* (id, path, owner, quiet) {
      yield* Effect.acquireRelease(
        gates
          .hold(
            id,
            Effect.sync(() => reading.set(id, (reading.get(id) ?? 0) + 1)),
          )
          .pipe(
            Effect.catchTags({
              HoldStalled: () => refuseRead(id, 'a birth is binding it, and this read could not wait for that'),
              HoldCut: () => refuseRead(id, 'counting this read ran past its ceiling'),
            }),
          ),
        () => Effect.sync(() => dropRead(id)),
      );
      const row = yield* store.byId(id);
      if (row === null) return yield* refuseRead(id, 'no such sandbox');
      if (row.ownerId !== owner.ownerId) return yield* refuseRead(id, 'it was prepared by another owner');
      if (row.projectId !== null && row.projectId !== owner.projectId) {
        return yield* refuseRead(id, `it was prepared for project ${row.projectId}`);
      }
      if (row.state !== 'prepared' || row.manifest === null) {
        return yield* refuseRead(id, `its preparation is ${row.state}${row.failureReason ? `: ${row.failureReason}` : ''}`);
      }
      const guest = yield* guestOf(row, row.manifest);
      const holder = row.boundThreadId;
      const stillness = yield* Effect.gen(function* () {
        if (holder === null) {
          if (guest.status === 'running') yield* runtime.stop(row.runtime);
          const sealed = yield* runtime.inspect(row.runtime);
          if (sealed.status !== 'stopped') {
            return yield* new SandboxUnavailable({ sandbox: row.id, reason: `its guest is ${sealed.status}, not sealed` });
          }
          return 'its guest was stopped for this read';
        }
        if (quiet === undefined) {
          return yield* new SandboxUnavailable({
            sandbox: row.id,
            reason: `thread ${holder} works in it, and this caller cannot hold that session still`,
          });
        }
        const held = yield* quiet(holder);
        if (!held.quiet) {
          return yield* new SandboxUnavailable({ sandbox: row.id, reason: held.reason });
        }
        return held.reason;
      }).pipe(Effect.withSpan('Sandboxes.stillness'));
      return yield* readGuestFile(id, row, path, stillness, runtime);
    }),
  });

  return Context.make(Sandboxes, sandboxes).pipe(Context.add(GuestWorlds, worlds), Context.add(SandboxFiles, files));
});

function receiptName(receipt: SandboxRecord['runtime']): string {
  return receipt.container;
}
