import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { isAbsolute, join } from 'node:path';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { HARNESSES } from '../../../external-harnesses/contract/service/table.js';
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
  for (const program of [WORLD_COMMAND, ...HARNESSES.map(({ binary }) => binary)].filter((program) => !isAbsolute(program))) {
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
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      born,
      (threadId) => {
        const thread = kernel.threads.handle(threadId, 'operator');
        return Effect.andThen(thread.stop(), thread.release()).pipe(Effect.orDie);
      },
      { discard: true },
    ),
  );
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
    yield* files.writeFileString(
      join(installation, WORLD_COMMAND),
      ['#!/bin/sh', `exec '${process.execPath}' '${AGENT}' --report '${report}' --mode tagma`].join('\n'),
      { mode: 0o755 },
    );
    return report;
  });
  return { world, projectId, checkout, birth, agent, forget: (threadId: string) => born.delete(threadId) };
});

export class ProtocolWorld extends Context.Service<ProtocolWorld, Effect.Success<ReturnType<typeof makeProtocolWorld>>>()(
  'testing/ProtocolWorld',
) {}

export const protocolWorld = <E = never, R = never>(input: Input<E, R>) =>
  Layer.effect(ProtocolWorld, makeProtocolWorld(input)).pipe(Layer.provideMerge(BunFileSystem.layer));
