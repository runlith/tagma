import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { Blocks } from '../contract/service/blocks.js';
import { Orientation } from '../contract/service/orientation.js';
import { ruleReach } from './reach.js';
import type { Instruction } from '../contract/wire/instructions.js';
import { globalRules, rulesOff } from '../settings.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { writes } from '../../platform/contract/service/writes.js';

const testActing = writes('test', []);

const card = Effect.fnUntraced(function* (projectId: number, id: string, root: string, parent?: number) {
  const blocks = yield* Blocks;
  const under = parent ?? (yield* blocks.rootBlockOf(projectId)).id;
  const [made] = yield* blocks.writeModules(projectId, [{ id, title: id, parent: under, root }], []);
  return yield* blocks.blockById(made!);
});

const rule = Effect.fnUntraced(function* (projectId: number, title: string, body: string, parentId?: number) {
  return (yield* (yield* Blocks).create({ projectId, tags: ['rule'], title, body, parentId })).id;
});

const law = Effect.fnUntraced(function* (projectId: number) {
  const set = yield* (yield* Orientation).instructions({ projectId, audience: 'graph' });
  return set.entries.filter((entry) => entry.kind === 'law');
});

const sources = (entries: readonly Instruction[]): string[] => entries.map((entry) => entry.source);

layer(demoGraphLayer(), { excludeTestServices: true })('law', (it) => {
  it.effect('a rule family rides whole, and a switched-off parent leaves its child standing', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const parent = yield* rule(projectId, 'Dialect law', 'The package speaks one dialect.');
        const parentName = yield* nameOf(parent);
        const childName = yield* nameOf(yield* rule(projectId, 'No timers', 'Time is the effect clock.', parent));
        expect(sources(yield* law(projectId))).toEqual([parentName, childName]);
        yield* graph.blocks.setEnabled({ id: parent, enabled: false });
        expect(sources(yield* law(projectId))).toEqual([childName]);
      }),
    ),
  );

  it.effect('a rule without sources under a module is a prompt rule: it rides the instruction set and no touch', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const area = yield* card(projectId, 'product', 'src');
        const zoned = yield* rule(projectId, 'Zone law', 'This zone speaks one way.', area.id);
        expect(sources(yield* law(projectId))).toEqual([yield* nameOf(zoned)]);
        const brief = (yield* graph.touches.touch({ projectId, shown: [{ path: 'src/thing.ts', as: 'read' }] }))[0]!;
        expect(brief.rules).toEqual([]);
      }),
    ),
  );

  it.effect('a code rule reaches touches under its sources alone, and set to prompt it rides the instruction set instead', () =>
    withDemo(({ graph, projectId, nameOf, demoRoot }) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await mkdir(join(demoRoot, 'kit'), { recursive: true });
          await writeFile(join(demoRoot, 'kit', 'helper.ts'), 'export const parse = () => 1;\n');
        });
        const coded = yield* graph.blocks.create({
          projectId,
          tags: ['rule'],
          title: 'Placed law',
          body: 'Only these places.',
          sources: [
            { kind: 'dir', ref: 'srv/graph' },
            { kind: 'file', ref: 'srv/one.ts' },
            { kind: 'symbol', ref: 'kit/helper.ts', symbol: 'parse' },
          ],
        });
        const name = yield* nameOf(coded.id);
        const onFile = (path: string) =>
          Effect.map(graph.touches.touch({ projectId, shown: [{ path, as: 'read' }] }), ([brief]) => brief!.rules.map((row) => row.name));
        expect(yield* onFile('srv/graph/deep/a.ts')).toEqual([name]);
        expect(yield* onFile('srv/one.ts')).toEqual([name]);
        expect(yield* onFile('kit/helper.ts')).toEqual([name]);
        expect(yield* onFile('srv/two.ts')).toEqual([]);
        expect(sources(yield* law(projectId))).toEqual([]);
        yield* graph.blocks.setDelivery({ id: coded.id, delivery: 'prompt' });
        expect(yield* onFile('srv/graph/deep/a.ts')).toEqual([]);
        expect(sources(yield* law(projectId))).toEqual([name]);
      }),
    ),
  );

  it.effect('a cyclic rule ancestry still delivers every rule once and terminates', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const a = yield* rule(projectId, 'Head', 'One.');
        const b = yield* rule(projectId, 'Tail', 'Two.', a);
        yield* graph.graphStore.db.update(block).set({ parentId: b }).where(eq(block.id, a));
        expect(sources(yield* law(projectId)).sort()).toEqual([yield* nameOf(a), yield* nameOf(b)].sort());
      }),
    ),
  );

  it.effect('the instruction set carries enabled standing law alone', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const binding = yield* rule(projectId, 'Bun only', 'No node.');
        const suspended = yield* rule(projectId, 'English titles', 'Latin script only.');
        const retired = yield* rule(projectId, 'Old law', 'Superseded by the one above.');
        yield* graph.standing.supersede({ oldId: retired, withId: binding });
        yield* graph.blocks.setEnabled({ id: suspended, enabled: false });
        expect(sources(yield* law(projectId))).toEqual([yield* nameOf(binding)]);
        yield* graph.blocks.setEnabled({ id: suspended, enabled: true });
        expect(sources(yield* law(projectId)).sort()).toEqual([yield* nameOf(binding), yield* nameOf(suspended)].sort());
      }),
    ),
  );

  it.effect('every standing GLOBAL prompt rule heads local law, including rules nested under a shelf', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const globalId = (yield* graph.projects.global())!.id;
        const shelf = (yield* graph.blocks.create({ projectId: globalId, tags: [], title: 'law' })).id;
        const deep = (yield* graph.blocks.create({
          projectId: globalId,
          tags: ['rule'],
          title: 'Answer first',
          body: 'A question takes the answer.',
          parentId: shelf,
        })).id;
        const off = yield* rule(globalId, 'Suspended', 'Not now.');
        yield* graph.blocks.setEnabled({ id: off, enabled: false });
        const coded = yield* rule(globalId, 'Coded', 'Set to code.');
        yield* graph.blocks.setDelivery({ id: coded, delivery: 'code' });
        const local = yield* rule(projectId, 'Bun only', 'No node.');
        const deepName = yield* nameOf(deep);
        const bare = yield* law(projectId);
        expect(sources(bare)).toEqual([deepName, yield* nameOf(local)]);
        expect(bare[0]?.scope).toBe('prompt · global');
        expect(bare[0]?.text).toContain('A question takes the answer.');
        expect(sources(yield* law(globalId))).toEqual([deepName]);
        yield* graph.blocks.setEnabled({ id: deep, enabled: false });
        expect(sources(yield* law(projectId))).toEqual([yield* nameOf(local)]);
      }),
    ),
  );

  it.effect('a project disables GLOBAL rules individually or together without changing the global graph', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const globalId = (yield* graph.projects.global())!.id;
        const kept = yield* nameOf(yield* rule(globalId, 'Answer first', 'Answer first.'));
        const dropped = yield* nameOf(yield* rule(globalId, 'Commits in English', 'Commits in English.'));
        yield* graph.settings.write({ scope: 'project', projectId, key: rulesOff.id, value: [dropped] });
        expect(sources(yield* law(projectId))).toEqual([kept]);
        yield* graph.settings.write({ scope: 'project', projectId, key: globalRules.id, value: false });
        expect(sources(yield* law(projectId))).toEqual([]);
        expect(sources(yield* law(globalId))).toEqual([kept, dropped]);
      }),
    ),
  );

  it.effect('rule reach answers while a writer unit holds its permit', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const held = yield* rule(projectId, 'Project law', 'Everyone.');
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holder = yield* Effect.forkScoped(
          graph.act.unit(
            testActing,
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }),
          ),
        );
        yield* Deferred.await(entered);
        const reached = yield* ruleReach(projectId).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        expect(reached.get(held)?.delivery).toBe('prompt');
        yield* Fiber.join(holder);
      }),
    ),
  );
});
