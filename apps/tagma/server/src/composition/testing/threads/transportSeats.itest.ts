import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { fakeAdapter, transportsOver } from '@runlith/agent/thread/conformance/fakeTransport';
import { Transports } from '@runlith/agent/thread/transport/Transports';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { NativeStorage, ThreadJournal } from '../../../threads/contract/service/engine.js';
import { ModelChanges } from '../../../threads/contract/service/modelChanges.js';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { makeHarnessAdapters } from '../../../external-harnesses/adapters.js';
import { isTransportEntry } from '../../../threads/contract/wire/harness/transportEntry.js';
import { kernelWrites, nativeTransitions } from '../../../native-harness/testing/doubles.js';
import { modelChanges, sqliteThreadJournal, threadRebinding, threadRun } from '../../../threads/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { terminalKernel, transportSwitch } from '../../../external-harnesses/testing/doubles.js';
import { providerCatalogOf, staticRegistry } from '../../../providers/testing/registry.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const uncalled = (): never => {
  throw new Error('Transport seating does not ask the native run/cache/settings ports.');
};

it.effect('SQL transport rebinding persists the hosted model default and both journal moves without opening a run', () =>
  Effect.gen(function* () {
    const demo = yield* threadStoreFixture;
    const changes = yield* Effect.provide(modelChanges(), demo.context);
    const journal = yield* Effect.provide(sqliteThreadJournal(), demo.context);
    const transitions = yield* Effect.provide(nativeTransitions(demo.store), demo.context);
    const native = NativeStorage.of({
      threads: demo.store,
      transitions,
      runs: uncalled,
      writes: kernelWrites(),
      get cacheObservations() {
        return uncalled();
      },
      get ownerSettings() {
        return uncalled();
      },
    });
    const context = demo.context.pipe(
      Context.add(NativeStorage, native),
      Context.add(ThreadJournal, journal),
      Context.add(ModelChanges, changes),
      Context.add(ThreadEntryKinds, demo.store.kinds),
    );
    const rebinding = yield* Effect.provide(threadRebinding(), context);
    const store = yield* sessionStoreOver(demo.db, demo.units, demo.threads.spells, demo.records, changes, () => Effect.void);
    const id = yield* demo.units.write('testing.transportSeats.birth', (unit) =>
      Effect.gen(function* () {
        const row = yield* demo.store.insert({ ownerId: 'operator', agentId: 'harness' }, unit);
        yield* demo.threads.rows.attachFacet(
          {
            threadId: row.id,
            projectId: demo.projectId,
            harness: {
              facet: harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))),
              kernel: terminalKernel(builtinHarness('claude-code'), undefined, false, {}),
            },
          },
          unit,
        );
        return row.id;
      }),
    );
    const description = DEFAULT_PROVIDER_DESCRIPTIONS.find((row) => row.id === 'claude-code');
    if (description === undefined) return yield* Effect.die('The built-in Claude Code provider has no description.');
    const provider: HarnessProvider = { ...description, kind: 'harness', auth: 'cli', environment: () => [] };
    const registry = Context.get(yield* Layer.build(transportsOver(fakeAdapter('terminal'), fakeAdapter('acp'))), Transports);
    const switching = transportSwitch(
      demo.records,
      demo.threads.list,
      store,
      rebinding,
      registry,
      staticRegistry(providerCatalogOf([provider])),
      yield* makeHarnessAdapters,
    );
    expect(yield* switching.to(id, demo.projectId, { kind: 'operator' }, 'acp')).toMatchObject({ status: 'switched', transport: 'acp' });
    expect(yield* demo.store.find(id)).toMatchObject({
      transport: { adapter: 'acp', profile: 'claude-code', agent: 'tagma' },
      provider: provider.id,
      model: provider.defaultTextModel,
      reasoning: provider.models[provider.defaultTextModel]?.defaultReasoning ?? null,
    });
    expect(yield* switching.to(id, demo.projectId, { kind: 'operator' }, 'terminal')).toMatchObject({
      status: 'switched',
      transport: 'terminal',
    });
    expect(yield* demo.store.find(id)).toMatchObject({ transport: { adapter: 'terminal', profile: 'claude-code', agent: null } });
    expect((yield* demo.store.transcriptOf(id))?.filter(isTransportEntry).map((entry) => [entry.from, entry.to])).toEqual([
      ['terminal', 'acp'],
      ['acp', 'terminal'],
    ]);
    const runs = threadRun();
    expect(yield* demo.units.read((unit) => unit.run(demo.db.select({ id: runs.id }).from(runs).where(eq(runs.threadId, id))))).toEqual([]);
  }),
);
