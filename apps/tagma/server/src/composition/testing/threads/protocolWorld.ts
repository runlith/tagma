import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer, Queue } from 'effect';
import { eq, inArray, or } from 'drizzle-orm';
import { isAbsolute, join } from 'node:path';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { SHIPPED_HARNESSES } from '../../../external-harnesses/testing/builtin.js';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { makeDoorWorld, type DoorFixture } from '../doorFixture.js';
import { hostedChild } from './hostedChild.js';
import { SERVER_SRC } from '../repoRoot.js';
import type { VendorWire } from '../../../providers/accounts/signIns.js';
import type { ModelAccess } from '../../../providers/contract/service/access.js';

const AGENT = join(SERVER_SRC, 'external-harnesses', 'testing', 'acpAgent.ts');

type Input<E, R> = {
  readonly name: string;
  readonly own?: string;
  readonly vendorWire?: VendorWire;
  readonly models?: (standing: ModelAccess['Service']) => ModelAccess['Service'];
  readonly prepare?: (world: DoorFixture['Service']) => Effect.Effect<unknown, E, R>;
};

const makeProtocolWorld = Effect.fn('testing.protocolWorld')(function* <E, R>({ name, own, vendorWire, models, prepare }: Input<E, R>) {
  const files = yield* FileSystem.FileSystem;
  const installation = yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: `${name}-runner-` });
  for (const program of [WORLD_COMMAND, ...SHIPPED_HARNESSES.map(({ binary }) => binary)].filter((program) => !isAbsolute(program))) {
    yield* files.writeFileString(join(installation, program), '#!/bin/sh\nprintf "fixture\\n"\n', { mode: 0o755 });
  }
  const stood = process.env.PATH;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = `${installation}:${stood ?? ''}`;
    }),
    () =>
      Effect.sync(() => {
        if (stood === undefined) delete process.env.PATH;
        else process.env.PATH = stood;
      }),
  );
  const world = yield* makeDoorWorld({ own, vendorWire, models });
  if (prepare !== undefined) yield* prepare(world);
  const checkout = yield* world.directory(`${name}-project`);
  const projectId = yield* world.stealthProject(checkout);
  yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const kernel = Context.get(world.runtime.owners, ThreadHarness);
  const born = new Set<string>();
  const reports = new Set<string>();
  const resting = (state: Effect.Success<ReturnType<typeof kernel.reads.snapshot>>) =>
    state.activeRun === null &&
    state.pendingInput.queued.length === 0 &&
    state.pendingInput.steers.length === 0 &&
    (state.latestRun === null || state.latestRun.settledNotifiedAt !== null);
  const rest = Effect.fn('testing.protocolWorldRest')(function* (threadId: string) {
    const changed = yield* Queue.sliding<void>(1);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        kernel.reads.subscribe(threadId, () => {
          Queue.offerUnsafe(changed, undefined);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const thread = kernel.threads.handle(threadId, 'operator');
    yield* thread.stop();
    yield* thread.release();
    for (;;) {
      const state = yield* kernel.reads.snapshot(threadId);
      if (resting(state)) return;
      yield* Queue.take(changed);
    }
  }, Effect.scoped);
  const birth = Effect.fn('testing.protocolWorldBirth')(function* (parent?: string) {
    const threadId =
      parent === undefined
        ? (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'review' })).thread.id
        : (yield* hostedChild(world, parent, 'HOLD the turn')).threadId;
    born.add(threadId);
    return threadId;
  });
  const agent = Effect.fn('testing.protocolWorldAgent')(function* (label: string) {
    const report = join(installation, `${label}.report`);
    reports.add(report);
    yield* files.writeFileString(
      join(installation, WORLD_COMMAND),
      ['#!/bin/sh', `exec '${process.execPath}' '${AGENT}' --report '${report}' --mode tagma`].join('\n'),
      { mode: 0o755 },
    );
    return report;
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Effect.forEach(reports, (report) => files.writeFileString(`${report}.release`, 'release'), { discard: true });
      const db = Context.get(world.runtime.graph, MachineStore).db;
      const table = threadRecord();
      const members = () =>
        db
          .select({ id: table.id })
          .from(table)
          .where(born.size === 0 ? eq(table.projectId, projectId) : or(eq(table.projectId, projectId), inArray(table.id, [...born])));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const observed = new Set<string>();
          let revision = 0;
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              kernel.reads.subscribeStates((state) => {
                if (observed.has(state.thread.id)) revision++;
              }),
            ),
            (unsubscribe) => Effect.sync(unsubscribe),
          );
          for (;;) {
            const ids = (yield* members()).map((row) => row.id);
            for (const id of ids) observed.add(id);
            yield* Effect.forEach(ids, rest, { discard: true });
            const before = revision;
            const after = (yield* members()).map((row) => row.id);
            if (after.some((id) => !observed.has(id))) continue;
            const states = yield* Effect.forEach(after, (id) => kernel.reads.snapshot(id));
            if (revision === before && states.every(resting)) return;
          }
        }),
      );
    }).pipe(Effect.orDie),
  );
  return { world, projectId, checkout, birth, agent, rest, forget: (threadId: string) => born.delete(threadId) };
});

export class ProtocolWorld extends Context.Service<ProtocolWorld, Effect.Success<ReturnType<typeof makeProtocolWorld>>>()(
  'testing/ProtocolWorld',
) {}

export const protocolWorld = <E = never, R = never>(input: Input<E, R>) =>
  Layer.effect(ProtocolWorld, makeProtocolWorld(input)).pipe(Layer.provideMerge(BunFileSystem.layer));
