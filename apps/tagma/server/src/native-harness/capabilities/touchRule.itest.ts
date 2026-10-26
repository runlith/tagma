import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join, relative } from 'node:path';
import { Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { agentRuntimeGuidanceMessage } from '@runlith/agent/AgentSignal';
import type { AgentDirective, AgentRuleContext } from '@runlith/agent/AgentRuntimePolicy';
import { demoGraphLayer, withDemo, type EffectDemo } from '../../composition/testing/graphFixture.js';
import { Act } from '../../graph/contract/service/acts.js';
import { Touches } from '../../graph/contract/service/orientation.js';
import type { ToolShown } from '@runlith/agent/tool';
import { signedBy } from '../../invocation/testing/call.js';
import type { ThreadExecution } from '../contract/service/execution.js';
import type { ThreadContext } from '../turns/context.js';
import { touchRule, touchMarks } from './touchRule.js';
import type { WorkPlaces } from '../../threads/contract/service/working.js';
import { instructionsTold } from '../turns/instructions.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { writes } from '../../platform/contract/service/writes.js';

const testActing = writes('test', []);
const SOURCE = 'export const alpha = 1;\n\nexport const beta = 2;\n';
const execution = {
  touched: (ctx, at, shown) =>
    Effect.flatMap(Touches, (touches) => touches.touch({ projectId: at.projectId, shown })).pipe(
      signedBy(ctx.session),
      Effect.provide(at.graph),
    ),
} as ThreadExecution['Service'];
const shown = (path: string, as: ToolShown['as'] = 'read'): ToolShown[] => [{ path, as }];
const guideText = Effect.fnUntraced(function* <E, R>(directive: Effect.Effect<AgentDirective | null, E, R>) {
  const answered = yield* directive;
  if (answered === null) return null;
  if (answered.type !== 'guide') return yield* Effect.die(`the rule answered ${answered.type}`);
  return answered.text;
});

const setup = Effect.fnUntraced(function* (demo: EffectDemo) {
  const { id: projectId, root } = demo.project('touched');
  const graph = demo.graph;
  const area = yield* graph.graphScopes.zoneByPlace(projectId, 'src');
  if (area === undefined) return yield* Effect.die('the touched source module was not prepared');
  const prepared = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
  const afterTool = (seen: readonly ToolShown[], thread: { id: string; transcript: { type: string; id: string }[] }, graphRoot = root) =>
    ({
      hook: 'afterTool',
      modelMessages: [
        agentRuntimeGuidanceMessage('Project instructions', { [instructionsTold(projectId)]: { ...prepared, root: graphRoot } }),
      ],
      tool: { name: 'bash', input: {}, toolCallId: 'call-1', shown: seen },
      thread,
      graph: Effect.succeed(demo.context),
      graphRoot,
      world: { facts: { shared: true }, root: graphRoot },
      places: {
        locate: (path: string) => Effect.succeed(path.startsWith(`${graphRoot}/`) ? { projectId, root: graphRoot } : null),
        resource: (path: string) =>
          Effect.succeed(path.startsWith(`${graphRoot}/`) ? { projectId, root: graphRoot, path: relative(graphRoot, path) } : null),
      } as unknown as WorkPlaces['Service'],
      projectId,
      target: { graph: { projectId, root: graphRoot } },
      session: { harness: 'tagma', key: thread.id },
      execution,
      identity: testSessionIdentity,
    }) as unknown as AgentRuleContext<ThreadContext>;
  return { graph, root, projectId, areaId: area.id, afterTool };
});

const graphs = demoGraphLayer({
  projects: ['touched'],
  prepareEffect: Effect.fnUntraced(function* (demo) {
    const { id, root } = demo.project('touched');
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(join(root, 'src'), { recursive: true });
    yield* files.writeFileString(join(root, 'src', 'cut.ts'), SOURCE);
    yield* files.writeFileString(join(root, 'src', 'plain.ts'), 'export const nothing = 0;\n');
    const parent = (yield* demo.graph.blocks.rootBlockOf(id)).id;
    const [areaId] = yield* demo.graph.blocks.writeModules(id, [{ id: 'touch', title: 'the region', parent, root: 'src' }], []);
    if (areaId === undefined) return yield* Effect.die('the touched source module was not created');
    for (const [title, body, symbol] of [
      ['About alpha', 'Alpha is the first constant.', 'alpha'],
      ['About beta', 'Beta is the second constant.', 'beta'],
    ])
      yield* demo.graph.blocks.create({
        projectId: id,
        tags: ['idea'],
        title: title!,
        body: body!,
        parentId: areaId,
        sources: [{ kind: 'symbol', ref: 'src/cut.ts', symbol: symbol! }],
      });
  }),
}).pipe(Layer.provideMerge(BunFileSystem.layer));

layer(graphs, { excludeTestServices: true })('touch guidance', (it) => {
  it.effect('the law that rides a touch is the code rule over that file, never a prompt rule', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, root, projectId, areaId, afterTool } = yield* setup(demo);
        yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Root law', body: 'MUST bind everywhere.' });
        yield* graph.blocks.create({
          projectId,
          tags: ['rule'],
          title: 'Zone law',
          body: 'MUST bind here.',
          parentId: areaId,
          sources: [{ kind: 'dir', ref: 'src' }],
        });
        const rule = touchRule(touchMarks(), () => 'graph');
        const thread = { id: 'thread-law', transcript: [] };
        const text = yield* guideText(rule(afterTool(shown(join(root, 'src', 'plain.ts')), thread)));
        expect(text).toContain('MUST bind here.');
        expect(text).not.toContain('MUST bind everywhere.');
        expect(yield* guideText(rule(afterTool(shown(join(root, 'src', 'other.ts')), thread)))).toBeNull();
      }),
    ),
  );

  it.effect('a note rides to the session that touches the code it is anchored to, once per thread, until it is replaced', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, root, projectId, areaId, afterTool } = yield* setup(demo);
        const note = (title: string, body: string, source: { kind: 'file' | 'dir'; ref: string }) =>
          graph.blocks.create({ projectId, tags: ['explanation'], title, body, parentId: areaId, sources: [source] });
        yield* note('The region keeps one reader', 'Two readers would race on the cursor.', { kind: 'dir', ref: 'src' });
        const plainNote = yield* note('Plain is read without a lock', 'A lock here would stall the writer.', {
          kind: 'file',
          ref: 'src/plain.ts',
        });
        const rule = touchRule(touchMarks(), () => 'graph');
        const plain = join(root, 'src', 'plain.ts');
        const cut = join(root, 'src', 'cut.ts');
        const thread = { id: 'thread-notes', transcript: [] };
        const first = yield* guideText(rule(afterTool(shown(plain), thread)));
        expect(first).toContain('Plain is read without a lock: A lock here would stall the writer.');
        expect(first).toContain('The region keeps one reader: Two readers would race on the cursor.');
        expect(yield* guideText(rule(afterTool(shown(plain), thread)))).toBeNull();
        expect(yield* guideText(rule(afterTool(shown(cut), thread)))).toBeNull();
        const other = yield* guideText(rule(afterTool(shown(cut), { id: 'thread-notes-other', transcript: [] })));
        expect(other).toContain('The region keeps one reader');
        expect(other).not.toContain('Plain is read without a lock');
        const replacement = yield* note('Plain is read under the shared lock', 'The writer now yields between pages.', {
          kind: 'file',
          ref: 'src/plain.ts',
        });
        yield* graph.standing.supersede({ oldId: plainNote.id, withId: replacement.id });
        const later = yield* guideText(rule(afterTool(shown(plain), { id: 'thread-notes-later', transcript: [] })));
        expect(later).toContain('Plain is read under the shared lock');
        expect(later).not.toContain('Plain is read without a lock');
      }),
    ),
  );

  it.effect('a file seen in search results brings its rules whole and points at its note, whose body rides once the file is read', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, root, projectId, areaId, afterTool } = yield* setup(demo);
        yield* graph.blocks.create({
          projectId,
          tags: ['rule'],
          title: 'Zone law',
          body: 'MUST bind here.',
          parentId: areaId,
          sources: [{ kind: 'dir', ref: 'src' }],
        });
        yield* graph.blocks.create({
          projectId,
          tags: ['explanation'],
          title: 'Plain is read without a lock',
          body: 'A lock here would stall the writer.',
          parentId: areaId,
          sources: [{ kind: 'file', ref: 'src/plain.ts' }],
        });
        const rule = touchRule(touchMarks(), () => 'graph');
        const thread = { id: 'thread-found', transcript: [] };
        const plain = join(root, 'src', 'plain.ts');
        const found = yield* guideText(rule(afterTool(shown(plain, 'found'), thread)));
        expect(found).toContain('MUST bind here.');
        expect(found).toContain('Plain is read without a lock');
        expect(found).not.toContain('A lock here would stall the writer.');
        expect(yield* guideText(rule(afterTool(shown(plain, 'found'), thread)))).toBeNull();
        const read = yield* guideText(rule(afterTool(shown(plain), thread)));
        expect(read).toContain('Plain is read without a lock: A lock here would stall the writer.');
        expect(read).not.toContain('MUST bind here.');
      }),
    ),
  );

  it.effect('a neighbour’s outstanding write opens a brief by itself, once', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, root, projectId, areaId, afterTool } = yield* setup(demo);
        const rule = touchRule(touchMarks(), () => 'graph');
        const thread = { id: 'thread-neighbour', transcript: [] };
        const plain = join(root, 'src', 'plain.ts');
        expect(yield* guideText(rule(afterTool(shown(plain), thread)))).toBeNull();
        const task = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Harden the door', parentId: areaId });
        yield* demo.as('peer', graph.tasks.claim({ id: task.id }));
        yield* demo.as('peer', graph.touches.touch({ projectId, shown: shown('src/plain.ts', 'wrote') }));
        expect(yield* guideText(rule(afterTool(shown(plain), thread)))).toBe(
          '<tagma over src/plain.ts>\nanother session writes this file: test:peer · Harden the door\n</tagma>',
        );
        expect(yield* guideText(rule(afterTool(shown(plain), thread)))).toBeNull();
        expect(yield* guideText(rule(afterTool(shown(plain, 'wrote'), thread)))).toBeNull();
        const reader = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Read it', parentId: areaId });
        yield* demo.as('peer', graph.tasks.claim({ id: reader.id }));
        yield* demo.as('peer', graph.touches.touch({ projectId, shown: shown('src/other.ts') }));
        expect(yield* guideText(rule(afterTool(shown(join(root, 'src', 'other.ts')), thread)))).toBeNull();
      }),
    ),
  );

  it.effect('the brief answers while a writer unit holds the permit', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { root, projectId } = yield* setup(demo);
        const act = yield* Act;
        const touches = yield* Touches;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holder = yield* Effect.forkChild(
          act.unit(
            testActing,
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }),
          ),
        );
        yield* Effect.gen(function* () {
          yield* Deferred.await(entered);
          const briefs = yield* touches.touch({ projectId, shown: shown(join(root, 'src', 'cut.ts')) });
          expect(briefs[0]?.place).toBe('src/cut.ts');
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        yield* Fiber.join(holder);
      }),
    ),
  );
});
