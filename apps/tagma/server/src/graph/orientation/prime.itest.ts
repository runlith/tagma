import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { Doctrine } from '../../platform/contract/service/sections.js';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { ProjectPolicy } from '../contract/service/serving.js';
import { Orientation } from '../contract/service/orientation.js';
import { orientationLayer } from './prime.js';
import { Blocks } from '../contract/service/blocks.js';
import { mapBudget } from '../settings.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

const region = Effect.fnUntraced(function* (projectId: number, title: string, dir: string, parentId?: number) {
  const blocks = yield* Blocks;
  const under = parentId ?? (yield* blocks.rootBlockOf(projectId)).id;
  return (yield* blocks.create({ projectId, tags: ['zone'], title, parentId: under, sources: [{ kind: 'dir', ref: dir }] })).id;
});

layer(demoGraphLayer(), { excludeTestServices: true })('prime', (it) => {
  it.effect('the orientation carries the law whole only when handed it, bare or scoped', () =>
    withDemo(({ graph, projectId, nameOf, root: home }) =>
      Effect.gen(function* () {
        const area = yield* region(projectId, 'product', 'src');
        const root = yield* graph.blocks.create({ projectId, parentId: home, tags: ['rule'], title: 'Bun only', body: 'No node.' });
        const nested = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Svelte runes', body: 'No stores.', parentId: area });
        for (const scopeId of [undefined, area]) {
          const bare = yield* graph.orientation.render({ projectId, scopeId });
          expect(bare).not.toContain(yield* nameOf(root.id));
          expect(bare).not.toContain(yield* nameOf(nested.id));
          const law = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
          const lawful = yield* graph.orientation.render({ projectId, scopeId, law });
          expect(lawful.startsWith(bare)).toBe(true);
          expect(lawful).toContain('No node.');
          expect(lawful).toContain('No stores.');
        }
      }),
    ),
  );

  it.effect('only a private project receives the doctrine absent from its checkout alongside its instruction set', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const doctrine = yield* Doctrine;
        if (doctrine === null) return yield* Effect.die('The graph fixture provides its doctrine.');
        const policy = yield* ProjectPolicy;
        const row = (yield* policy.read([projectId])).get(projectId);
        if (row === undefined) return yield* Effect.die('The graph fixture provides its project policy.');
        const law = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
        const marker = `fixture doctrine ${crypto.randomUUID()}`;
        for (const privateProject of [false, true]) {
          const selected = ProjectPolicy.of({
            ...policy,
            read: (ids) =>
              Effect.map(policy.read(ids), (rows) => {
                const changed = new Map(rows);
                if (ids.includes(projectId)) changed.set(projectId, { ...row, private: privateProject });
                return changed;
              }),
          });
          const services = yield* Layer.build(Layer.fresh(orientationLayer)).pipe(
            Effect.provideService(Doctrine, { ...doctrine, law: () => [marker] }),
            Effect.provideService(ProjectPolicy, selected),
            Effect.provideService(SessionIdentity, testSessionIdentity),
          );
          const rendered = yield* Context.get(services, Orientation).render({ projectId, law });
          if (privateProject) expect(rendered).toContain(marker);
          else expect(rendered).not.toContain(marker);
        }
      }),
    ),
  );

  it.effect('the map is cut to the configured budget', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const control = mapBudget.control;
        if (control?.kind !== 'number') return yield* Effect.fail('the map budget has no numeric control');
        const budget = control.minimum;
        const top = yield* region(projectId, 'region', 'src/region');
        const part = yield* region(projectId, 'p'.repeat(budget), 'src/region/part', top);
        yield* graph.settings.write({ scope: 'project', projectId, key: mapBudget.id, value: budget });
        const text = yield* graph.orientation.render({ projectId });
        expect(text).toContain(yield* nameOf(top));
        expect(text).not.toContain(yield* nameOf(part));
        expect(text).not.toContain('src/region');
      }),
    ),
  );

  it.effect('GLOBAL is identified, and global work stays outside project reads', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const globalId = (yield* graph.projects.global())!.id;
        const globalRoot = yield* graph.blocks.rootBlockOf(globalId);
        const before = yield* graph.orientation.render({ projectId });
        const beforeReady = yield* graph.selection.ready({ projectId });
        expect(before).toContain(yield* nameOf(globalRoot.id));
        for (const [tag, title] of [
          ['task', 'cross work'],
          ['spec', 'cross decision'],
          ['idea', 'cross region'],
        ] as const) {
          yield* graph.blocks.create({ projectId: globalId, parentId: globalRoot.id, tags: [tag], title });
        }
        expect(yield* graph.orientation.render({ projectId })).toBe(before);
        expect(yield* graph.selection.ready({ projectId })).toEqual(beforeReady);
      }),
    ),
  );

  it.effect('work in progress is named once claimed, and a scope names only its own', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const area = yield* region(projectId, 'product', 'src');
        const inside = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'inside', parentId: area })).id;
        const outside = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'outside' })).id;
        const open = yield* graph.orientation.render({ projectId });
        expect(open).not.toContain(yield* nameOf(inside));
        expect(open).not.toContain(yield* nameOf(outside));
        yield* graph.tasks.claim({ id: inside });
        yield* graph.tasks.claim({ id: outside });
        const whole = yield* graph.orientation.render({ projectId });
        expect(whole).toContain(yield* nameOf(inside));
        expect(whole).toContain(yield* nameOf(outside));
        const narrowed = yield* graph.orientation.render({ projectId, scopeId: area });
        expect(narrowed).toContain(yield* nameOf(inside));
        expect(narrowed).not.toContain(yield* nameOf(outside));
      }),
    ),
  );

  it.effect('the map names every container, and a scope draws the directories of its own branch', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const area = yield* region(projectId, 'product', 'src');
        const engine = yield* region(projectId, 'engine', 'src/engine', area);
        const store = yield* region(projectId, 'store', 'src/store', area);
        const task = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'grind', parentId: engine });
        const doc = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'The grind', parentId: engine, body: 'x' });
        const whole = yield* graph.orientation.render({ projectId });
        for (const id of [area, engine, store]) expect(whole).toContain(yield* nameOf(id));
        expect(whole).not.toContain('src/engine');
        expect(whole).not.toContain(yield* nameOf(task.id));
        expect(whole).not.toContain(yield* nameOf(doc.id));
        const scoped = yield* graph.orientation.render({ projectId, scopeId: engine });
        expect(scoped).toContain('src/engine');
        expect(scoped).not.toContain('src/store');
        const part = (yield* graph.blocks.create({
          projectId,
          title: 'Payments',
          parentId: area,
          sources: [{ kind: 'dir', ref: 'src/pay' }],
        })).id;
        yield* region(projectId, 'ledger', 'src/pay/ledger', part);
        expect(yield* graph.orientation.render({ projectId, scopeId: part })).toMatch(/Payments · src\/pay(\s|$)/m);
      }),
    ),
  );

  it.effect('the map removes a replaced region and keeps its standing descendants', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const retired = yield* region(projectId, 'the old shape', 'src/old');
        const inside = yield* region(projectId, 'engine', 'src/old/engine', retired);
        const heir = yield* region(projectId, 'the new shape', 'src/new');
        yield* graph.standing.supersede({ oldId: retired, withId: heir });
        const whole = yield* graph.orientation.render({ projectId });
        expect(whole).not.toContain(yield* nameOf(retired));
        expect(whole).toContain(yield* nameOf(heir));
        expect(whole).toContain(yield* nameOf(inside));
      }),
    ),
  );

  it.effect('a trashed scope falls back to the whole project', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const area = yield* region(projectId, 'product', 'src');
        yield* graph.trash.delete({ id: area });
        expect(yield* graph.orientation.render({ projectId, scopeId: area })).toBe(yield* graph.orientation.render({ projectId }));
      }),
    ),
  );
});
