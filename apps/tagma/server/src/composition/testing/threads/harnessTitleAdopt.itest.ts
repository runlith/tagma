import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { builtinRegistry } from '../providerCatalog.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import type { HarnessEvent } from '../../../threads/contract/wire/harness/observation.js';
import { Context, Effect, Layer } from 'effect';
import { graphFixture } from '../graphFixture.js';
import {
  unmeasuredObservation,
  asHarnessBinding,
  asHarnessField,
  asHarnessObservation,
  modelChanges,
} from '../../../threads/testing/doubles.js';
import type { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { adoptSessionTitle } from '../../../external-harnesses/titles.js';
import { threadStack, type ThreadParts } from '../threadParts.js';
import { HarnessObservations, terminalArgv } from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { ENTRY_KINDS } from '../../manifest.js';

const titleIdentity = (records: ThreadRecords['Service'], id: string) =>
  Effect.map(records.facts(id), (facts) =>
    facts === undefined ? undefined : { title: facts.title, origin: facts.titleProvenance, revision: facts.titleRevision },
  );

const setup = Effect.fnUntraced(function* () {
  const catalog = yield* (yield* ProviderRegistry).catalog;
  const lifetime = graphFixture();
  const demo = yield* Effect.map(
    Effect.acquireRelease(lifetime.openEffect(), () => Effect.orDie(lifetime.releaseEffect)),
    (demo) => demo.effects,
  );
  const raise = Effect.fnUntraced(function* (
    options: { readonly autoAdopt?: boolean; readonly sessionKey?: string | null; readonly name?: 'cursor' | 'devin' } = {},
  ) {
    const records = yield* Effect.provide(makeThreadRecords, demo.context);
    const { store, threads } = yield* Effect.provide(
      threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: ENTRY_KINDS }),
      demo.context,
    );
    const facetPublished: string[] = [];
    const titlePublished: string[] = [];
    const facets = yield* sessionStoreOver(
      demo.graph.store.db,
      demo.graph.units,
      threads.spells,
      records,
      yield* Effect.provide(modelChanges(), demo.context),
      (id) =>
        Effect.sync(() => {
          facetPublished.push(id);
        }),
    );
    const observations = new HarnessObservations(
      facets,
      demo.graph.store.db,
      demo.graph.units,
      records,
      (id) =>
        Effect.sync(() => {
          titlePublished.push(id);
        }),
      options.autoAdopt === undefined ? undefined : () => Effect.succeed(options.autoAdopt!),
    );
    const threadId = yield* demo.graph.units.write('harnessTitleAdopt.threadId', (unit) =>
      Effect.gen(function* () {
        const row = yield* store.insert({ ownerId: 'operator', agentId: 'harness' }, unit);
        yield* threads.rows.attachFacet(
          {
            threadId: row.id,
            projectId: demo.projectId,
            harness: {
              facet: {
                name: options.name ?? 'cursor',
                presentation: harnessPresentation(options.name ?? 'cursor'),
                sessionKey: options.sessionKey === undefined ? ROOT : options.sessionKey,
                execution: null,
                observation: unmeasuredObservation(),
              },
              kernel: null,
            },
          },
          unit,
        );
        return row.id;
      }),
    );
    yield* facets.open(threadId, '', 'owner', terminalArgv(catalog.models, ''));
    yield* facets.change(threadId, (facet) =>
      Effect.succeed({
        facet: {
          ...facet,
          execution: { execution: `exec-${threadId.slice(0, 8)}`, incarnation: 1 },
          session: facet.session === undefined ? facet.session : { ...facet.session, state: 'running' as const },
        },
        value: undefined,
      }),
    );
    const accept = Effect.fnUntraced(function* (minute: number, over: Partial<HarnessEvent> = {}) {
      const facet = yield* facets.read(threadId);
      return yield* facets.change(threadId, (standing) => {
        const admitted = observations.admit(standing, {
          occasion: 'session-start',
          observedAt: at(minute),
          sessionId: facet?.session?.id ?? null,
          rootKey: ROOT,
          turnId: null,
          receipt: null,
          atRevision: null,
          model: { _tag: 'NotRead' },
          ...over,
        });
        return Effect.succeed({ facet: admitted.facet, value: admitted });
      });
    });
    const reading = Effect.fnUntraced(function* () {
      return (yield* observations.read(threadId))!;
    });
    const meta = Effect.fnUntraced(function* (fields: ReturnType<typeof asHarnessObservation>['metadata']) {
      const before = yield* reading();
      return yield* observations.metadata(threadId, { binding: before.binding, revision: before.revision, fields });
    });
    const title = Effect.fnUntraced(function* (value: string, minute: number) {
      return yield* meta({ model: { _tag: 'NotRead' }, effort: { _tag: 'NotRead' }, title: titleValue(value, minute) });
    });
    const identity = () => titleIdentity(records, threadId);
    const setTitle = (title: string) =>
      demo.graph.units.write(writes('harnessTitleAdopt.setTitle', [threadRecord()]), (unit) =>
        records.setTitle(unit, threadId, title, 'manual'),
      );
    const name = (title: string, revision: number) =>
      demo.graph.units.write(writes('harnessTitleAdopt.name', [threadRecord()]), (unit) =>
        records.nameTitle(unit, threadId, title, revision),
      );
    const claim = (input: string) =>
      demo.graph.units.write(writes('harnessTitleAdopt.claim', [threadRecord()]), (unit) => records.claimTitleInput(unit, threadId, input));
    const adopt = (title: string, revision: number, binding: ReturnType<typeof asHarnessBinding>) =>
      adoptSessionTitle(demo.graph.store.db, demo.graph.units, records, threadId, title, revision, binding);
    const order = Effect.fnUntraced(function* () {
      return (yield* threads.list.summary(threadId))?.readerOrderAt ?? null;
    });
    return {
      store,
      threads,
      records,
      facets,
      observations,
      threadId,
      facetPublished,
      titlePublished,
      accept,
      reading,
      meta,
      title,
      identity,
      setTitle,
      name,
      claim,
      adopt,
      order,
    };
  });
  return { demo, raise, catalog };
});

const at = (minute: number): string => new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();
const ROOT = 'vendor-root-1';

const titleValue = (value: string, minute: number, rootKey: string = ROOT): ReturnType<typeof asHarnessField> => ({
  _tag: 'Value',
  value,
  claim: 'last-recorded',
  source: 'transcript',
  scope: { rootKey, turnId: null },
  observedAt: at(minute),
});

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/HarnessTitleWorld') {}

layer(Layer.effect(World, setup()).pipe(Layer.provide(builtinRegistry)), { excludeTestServices: true })('harness title adoption', (it) => {
  it.effect(
    'a random root adopts the bound vendor title and follows its later revision',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const world = yield* raise();
      yield* world.accept(0);
      const before = yield* world.identity();
      expect(before?.origin).toBe('random');
      const orderBefore = yield* world.order();
      const first = yield* world.title('Fix login bug', 1);
      expect(first.outcome).toBe('admitted');
      expect(yield* world.identity()).toMatchObject({ title: 'Fix login bug', origin: 'harness' });
      expect(world.titlePublished).toEqual([world.threadId]);
      expect(yield* world.order()).toEqual(orderBefore);
      expect(yield* world.claim('entry-1')).toBeUndefined();
      const second = yield* world.title('Fix login bug v2', 2);
      expect(second.outcome).toBe('admitted');
      expect(yield* world.identity()).toMatchObject({ title: 'Fix login bug v2', origin: 'harness' });
      expect(world.titlePublished).toHaveLength(2);
      const explicit = yield* world.name('Operator asked', (yield* world.identity())!.revision);
      expect(explicit.outcome).toBe('written');
      expect(yield* world.identity()).toMatchObject({ title: 'Operator asked', origin: 'generated' });
    }),
  );

  it.effect(
    'a racing identical-text manual rename wins over an in-flight adoption',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const world = yield* raise();
      yield* world.accept(0);
      const before = yield* world.reading();
      yield* world.setTitle('Same words');
      const receipt = yield* world.observations.metadata(world.threadId, {
        binding: before.binding,
        revision: before.revision,
        fields: { model: { _tag: 'NotRead' }, effort: { _tag: 'NotRead' }, title: titleValue('Same words', 1) },
      });
      expect(receipt.outcome).toBe('admitted');
      expect((yield* world.reading()).metadata.title).toMatchObject({ _tag: 'Value', value: 'Same words' });
      expect(yield* world.identity()).toMatchObject({ title: 'Same words', origin: 'manual' });
      expect(world.titlePublished).toHaveLength(0);
    }),
  );

  it.effect(
    'manual, generated and child names are never adopted over',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const manual = yield* raise();
      yield* manual.accept(0);
      yield* manual.setTitle('Kept by hand');
      yield* manual.title('Vendor words', 1);
      expect(yield* manual.identity()).toMatchObject({ title: 'Kept by hand', origin: 'manual' });
      const generated = yield* raise();
      yield* generated.accept(0);
      const claim = yield* generated.claim('entry-1');
      yield* generated.name('Model words', claim!.revision);
      yield* generated.title('Vendor words', 1);
      expect(yield* generated.identity()).toMatchObject({ title: 'Model words', origin: 'generated' });
      const parent = yield* raise();
      const childId = yield* parent.facets.read(parent.threadId).pipe(
        Effect.andThen(() =>
          demo.graph.units.write('harnessTitleAdopt.childId', (unit) =>
            Effect.gen(function* () {
              const row = yield* parent.store.insertChild(parent.threadId, { ownerId: 'operator', agentId: 'tagma' }, unit);
              yield* parent.threads.rows.inheritFacet({ threadId: row.id, fromThreadId: parent.threadId, agentId: 'tagma' }, unit);
              return row.id;
            }),
          ),
        ),
      );
      const childFacet = yield* parent.facets.read(parent.threadId);
      expect(childFacet).not.toBeNull();
      expect(yield* titleIdentity(parent.records, childId)).toMatchObject({ title: 'tagma', origin: 'agent' });
      const childBefore = yield* titleIdentity(parent.records, childId);
      const adopted = yield* adoptSessionTitle(
        demo.graph.store.db,
        demo.graph.units,
        parent.records,
        childId,
        'Vendor words',
        childBefore!.revision,
        {
          sessionId: 'session-1',
          execution: { execution: 'exec-1', incarnation: 1 },
          rootKey: ROOT,
        },
      );
      expect(adopted).toBe(false);
      expect(yield* titleIdentity(parent.records, childId)).toMatchObject({ title: 'tagma', origin: 'agent' });
      expect(manual.titlePublished).toHaveLength(0);
      expect(generated.titlePublished).toHaveLength(0);
    }),
  );

  it.effect(
    'a replacement process cannot apply the previous process pending title read',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const world = yield* raise();
      yield* world.accept(0);
      const pending = yield* world.reading();
      yield* world.facets.change(world.threadId, (facet) =>
        Effect.succeed({
          facet: facet.session === undefined ? facet : { ...facet, session: { ...facet.session, state: 'ended' as const } },
          value: undefined,
        }),
      );
      yield* world.facets.open(world.threadId, '', 'owner', terminalArgv((yield* World).catalog.models, ''));
      yield* world.facets.change(world.threadId, (facet) =>
        Effect.succeed({
          facet: {
            ...facet,
            execution: { execution: `exec-replaced-${world.threadId.slice(0, 4)}`, incarnation: 1 },
            session: facet.session === undefined ? facet.session : { ...facet.session, state: 'running' as const },
          },
          value: undefined,
        }),
      );
      const receipt = yield* world.observations.metadata(world.threadId, {
        binding: pending.binding,
        revision: pending.revision,
        fields: { model: { _tag: 'NotRead' }, effort: { _tag: 'NotRead' }, title: titleValue('Old words', 1) },
      });
      expect(receipt.outcome).toBe('refused');
      expect(yield* world.identity()).toMatchObject({ origin: 'random' });
      expect(world.titlePublished).toHaveLength(0);
    }),
  );

  it.effect(
    'a missing or unreadable vendor title never clears the standing name',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const world = yield* raise();
      yield* world.accept(0);
      yield* world.title('First words', 1);
      expect(yield* world.identity()).toMatchObject({ title: 'First words', origin: 'harness' });
      world.titlePublished.length = 0;
      const scope = { rootKey: ROOT, turnId: null };
      const absent = yield* world.meta({
        model: { _tag: 'NotRead' },
        effort: { _tag: 'NotRead' },
        title: { _tag: 'Absent', source: 'transcript', scope, observedAt: at(2) },
      });
      expect(absent.outcome).toBe('admitted');
      const unreadable = yield* world.meta({
        model: { _tag: 'NotRead' },
        effort: { _tag: 'NotRead' },
        title: {
          _tag: 'Unreadable',
          source: 'transcript',
          scope,
          observedAt: at(3),
          reason: 'the store could not be opened',
          lastKnown: null,
        },
      });
      expect(unreadable.outcome).toBe('admitted');
      expect(yield* world.identity()).toMatchObject({ title: 'First words', origin: 'harness' });
      expect(world.titlePublished).toHaveLength(0);
      const empty = yield* world.adopt('   ', (yield* world.identity())!.revision, (yield* world.reading()).binding);
      expect(empty).toBe(false);
    }),
  );

  it.effect(
    'a work-bound session adopts its vendor title before any root binds',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const world = yield* raise({ sessionKey: null, name: 'devin' });
      yield* world.accept(0);
      expect((yield* world.reading()).binding).toMatchObject({ rootKey: null, workKey: ROOT });
      const receipt = yield* world.title('Work words', 1);
      expect(receipt.outcome).toBe('admitted');
      expect(yield* world.identity()).toMatchObject({ title: 'Work words', origin: 'harness' });
      expect(world.titlePublished).toEqual([world.threadId]);
    }),
  );

  it.effect(
    'the harness-title setting gates adoption while the field still lands',
    Effect.fnUntraced(function* () {
      const { demo, raise } = yield* World;
      const gated = yield* raise({ autoAdopt: false });
      yield* gated.accept(0);
      const receipt = yield* gated.title('Held words', 1);
      expect(receipt.outcome).toBe('admitted');
      expect((yield* gated.reading()).metadata.title).toMatchObject({ _tag: 'Value', value: 'Held words' });
      expect(yield* gated.identity()).toMatchObject({ origin: 'random' });
      expect(gated.titlePublished).toHaveLength(0);
      const open = yield* raise({ autoAdopt: true });
      yield* open.accept(0);
      yield* open.title('Taken words', 1);
      expect(yield* open.identity()).toMatchObject({ title: 'Taken words', origin: 'harness' });
      expect(open.titlePublished).toEqual([open.threadId]);
    }),
  );
});
