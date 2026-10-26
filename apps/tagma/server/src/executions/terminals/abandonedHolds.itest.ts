import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, FileSystem, Layer, Path } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { project } from '../../projects/store/table.js';
import { command, commandWait, terminal, terminalRequestKey } from '../store/terminal.js';
import { rootUse } from '../../workspace/store/tables.js';
import { UseId } from '../../workspace/contract/wire/ids.js';
import { fileRootStore, rootRegistry, rootUseLedger, rootUseStore } from '../../workspace/testing/doubles.js';
import { collectAbandonedHolds, releaseAbandonedHolds } from './abandonedHolds.js';

const namespaceId = NamespaceId.make('test-once');
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer);

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* fileRootStore(db, units);
  const roots = yield* rootRegistry(records, files, paths, namespaceId, { holding: () => Effect.succeed(new Map()) });
  const uses = yield* rootUseLedger(rootUseStore(db), roots, records, units);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const [created] = yield* units.write('releaseAbandonedHolds.fixture', (unit) =>
    unit.run(db.insert(project).values({ name: 'once', repoKey: '/once', rootPath: '/once', createdAt }).returning({ id: project.id })),
  );
  return { db, units, uses, projectId: created?.id ?? 0 };
});

const hold = (useId: string, consumer: { readonly kind: string; readonly id: string }) => ({
  useId,
  namespaceId: 'test-once',
  path: '/once',
  consumerKind: consumer.kind,
  consumerId: consumer.id,
  mode: 'shared' as const,
  state: 'held' as const,
});

it.live('the migration releases exactly the holds whose consumer is gone', () =>
  Effect.gen(function* () {
    const { db, units, uses, projectId } = yield* fixture;
    const terminalDead = 'use-terminal-dead';
    const terminalLive = 'use-terminal-live';
    const commandDead = 'use-command-dead';
    const commandLive = 'use-command-live';
    yield* units.write('releaseAbandonedHolds', (unit) =>
      Effect.gen(function* () {
        const stampedAt = new Date(yield* Clock.currentTimeMillis);
        yield* unit.run(
          db
            .insert(rootUse)
            .values([
              hold(terminalDead, { kind: 'terminal', id: 'op-t-dead' }),
              hold(terminalLive, { kind: 'terminal', id: 'op-t-live' }),
              hold(commandDead, { kind: 'command', id: 'op-c-dead' }),
              hold(commandLive, { kind: 'command', id: 'op-c-live' }),
            ]),
        );
        const row = (executionId: string, useId: string, discharged: boolean): typeof terminal.$inferInsert => ({
          executionId,
          incarnation: 0,
          projectId,
          transport: 'pipes',
          lifetime: 'call',
          targetKey: 'k',
          holder: 'operator',
          origin: 'operator',
          revision: 0,
          rootUseId: useId,
          acceptedAt: stampedAt,
          dischargedAt: discharged ? stampedAt : undefined,
        });
        yield* unit.run(db.insert(terminal).values([row('exec-t-dead', terminalDead, true), row('exec-t-live', terminalLive, false)]));
        const operation = (operationId: string, executionId: string) => ({
          projectId,
          operationId,
          requester: 'operator',
          mutation: 'start' as const,
          targetKey: 'k',
          executionId,
          incarnation: 0,
          outcome: 'settled' as const,
          at: stampedAt,
        });
        yield* unit.run(
          db
            .insert(terminalRequestKey)
            .values([
              operation('op-t-dead', 'exec-t-dead'),
              operation('op-t-live', 'exec-t-live'),
              operation('op-c-dead', 'exec-c-dead'),
              operation('op-c-live', 'exec-c-live'),
            ]),
        );
        const launched = (executionId: string, useId: string) => ({
          executionId,
          incarnation: 0,
          projectId,
          owner: 'op',
          createdBy: 't',
          policyIdentity: 'p',
          targetKey: 'k',
          rootUseId: useId,
          admittedAt: stampedAt,
        });
        yield* unit.run(db.insert(command).values([launched('exec-c-dead', commandDead), launched('exec-c-live', commandLive)]));
        yield* unit.run(
          db.insert(commandWait).values({
            executionId: 'exec-c-live',
            incarnation: 0,
            mode: 'foreground',
            revision: 0,
            movedAt: new Date(yield* Clock.currentTimeMillis),
          }),
        );
      }),
    );

    const holds = yield* collectAbandonedHolds(db, units, 'test-once');

    expect([...holds.map((hold) => hold.useId)].sort()).toEqual([UseId.make(commandDead), UseId.make(terminalDead)].sort());
    expect(holds.find((hold) => hold.useId === terminalDead)).toMatchObject({ from: 'terminal' });
    expect(holds.find((hold) => hold.useId === commandDead)).toMatchObject({ from: 'command' });

    const report = yield* releaseAbandonedHolds(uses, units, holds);

    expect(report.failed).toEqual([]);
    expect([...report.released].sort()).toEqual([UseId.make(commandDead), UseId.make(terminalDead)].sort());
    const states = yield* units.read((unit) => unit.run(db.select({ useId: rootUse.useId, state: rootUse.state }).from(rootUse)));
    expect(new Map(states.map((row) => [row.useId, row.state] as const))).toEqual(
      new Map([
        [terminalDead, 'released'],
        [terminalLive, 'held'],
        [commandDead, 'released'],
        [commandLive, 'held'],
      ]),
    );
    expect(yield* collectAbandonedHolds(db, units, 'test-once')).toEqual([]);
  }).pipe(Effect.provide(layers)),
);
