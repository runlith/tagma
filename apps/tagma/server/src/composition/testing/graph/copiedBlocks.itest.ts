import { expect } from 'bun:test';
import { basename, dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers.js';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { prepareTeamCopies } from './serving/fixture.js';
import { fixtureGraphMigrations } from '../migrations.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { onGraph, signedBy } from '../../../invocation/testing/call.js';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { block } from '../../../graph/store/tables.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { ProjectLifecycle, type ServedGraph } from '../../../graph/contract/service/serving.js';
import { RegisteredRoots } from '../../../graph/contract/service/registeredRoots.js';
import { blockName } from '../../../graph/contract/wire/references.js';
import { graphPool, machineGraphOf } from '../../../graph/testing/doubles.js';
import { routedContext } from '../../../graph/serving/routing.js';
import { runGit } from '../../../platform/git/ownGit.js';

const signed = signedBy({ harness: 'test', key: 'copied-blocks' });

const TOOLS = ['update_block', 'create_block', 'link_blocks', 'unlink_blocks', 'read_block'];

const toolsAt = Effect.fnUntraced(function* (
  routed: ReturnType<typeof routedContext>,
  served: ServedGraph,
  project: { readonly id: number; readonly name: string },
) {
  const vocabulary = yield* Effect.provide(
    Effect.flatMap(Tags, (tags) => tags.reader(project.id)),
    served.context,
  );
  const catalog = yield* fixtureNativeCatalog(
    {
      caller: { actor: { kind: 'operator' }, files: null },
      place: { root: served.checkout, origin: null },
      project,
      vocabulary,
      identity: sessionIdentity,
      world: 'checkout',
      graphRoot: served.layout.treeRoot,
      owners: routed,
      served,
    },
    TOOLS,
  );
  let calls = 0;
  return Effect.fnUntraced(function* (tool: string, input: Record<string, unknown>) {
    const entry = catalog[tool];
    if (entry === undefined) return yield* Effect.die(`no ${tool} tool`);
    const key = `${project.name}-${tool}-${++calls}`;
    const outcome = yield* Effect.result(
      Effect.gen(function* () {
        const prepared = yield* toolPrepare(entry)!(input, { toolCallId: key, caller: unthreadedCaller });
        return yield* toolExecute(entry)!(input, {
          toolCallId: key,
          caller: unthreadedCaller,
          messages: [],
          prepared: prepared?.prepared,
        });
      }),
    );
    if (outcome._tag === 'Failure') return outcome.failure as unknown as Record<string, unknown>;
    const answered = outcome.success;
    return (answered instanceof ToolAnswer ? answered.value : answered) as Record<string, unknown>;
  });
});

const landed = (routed: ReturnType<typeof routedContext>, name: string, rootPath: string) =>
  Effect.provide(
    signed(Effect.flatMap(ProjectLifecycle, (lifecycle) => lifecycle.create({ name, rootPath, storage: 'team' }))),
    Context.add(routed, RegisteredRoots, RegisteredRoots.of({ joined: () => Effect.void, left: () => Effect.void })),
  );

layer(demoGraphLayer({ repos: ['law'], prepareEffect: prepareTeamCopies(['law']) }).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('a block copied into another project', (it) => {
  it.effect('is refused by its name alone with an address per copy, and the address or the project reaches the copy from any field', () =>
    withDemo(({ graph, context, project, demoRoot, projectId }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const law = project('law');
          const machine = machineGraphOf(context);
          const pool = yield* Effect.acquireRelease(
            graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
            (held) => held.dispose(),
          );
          const routed = routedContext(machine, pool);
          const servedLaw = yield* pool.resolve({ projectId: law.id });
          const rule = yield* Effect.provide(
            onGraph(servedLaw)(
              signed(Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: law.id, tags: ['rule'], title: 'Law' }))),
            ),
            routed,
          );
          const clone = join(demoRoot, 'law-copy');
          yield* files.copy(law.root, clone, { overwrite: true });
          yield* runGit(graph.git, 'fork', ['checkout', '-q', '--orphan', 'fork'], { cwd: clone });
          yield* runGit(graph.git, 'fork', ['-c', 'user.name=fork', '-c', 'user.email=fork@tagma', 'commit', '-q', '-m', 'fork'], {
            cwd: clone,
          });
          const copy = yield* landed(routed, 'law-copy', clone);
          yield* pool.birth(copy.id);
          const servedCopy = yield* pool.resolve({ projectId: copy.id });
          const call = yield* toolsAt(routed, yield* pool.resolve({ projectId }), { id: projectId, name: 'home' });
          const addressIn = (refused: Record<string, unknown>, projectId: number) => {
            expect(refused).toMatchObject({ code: 'ambiguous-name' });
            const ways = (refused.unblock as readonly string[]).filter((way) => way.startsWith(`${projectId}/`));
            expect(ways).toHaveLength(1);
            return ways[0]!.split(' ')[0]!;
          };
          const name = blockName(rule.uuid);

          const retitle = { blockId: name, title: 'Law of the copy' };
          const alone = yield* call('update_block', retitle);
          const atCopy = addressIn(alone, copy.id);
          expect(addressIn(alone, law.id)).not.toBe(atCopy);
          expect(yield* call('update_block', { ...retitle, project: copy.id })).toMatchObject({ status: 'ok' });

          const citing = ((yield* call('create_block', { tags: ['idea'], title: 'Cites the law' })) as { block: { name: string } }).block
            .name;
          const link = { fromId: citing, kind: 'relates', toId: name };
          const linked = { ...link, toId: addressIn(yield* call('link_blocks', link), law.id) };
          expect(yield* call('link_blocks', linked)).toMatchObject({ status: 'ok' });
          expect(yield* call('read_block', { blockIds: [citing] })).toMatchObject({
            reads: [{ edgesOut: [{ kind: 'relates', toName: name }] }],
          });
          expect(yield* call('unlink_blocks', linked)).toMatchObject({ status: 'ok' });
          expect(yield* call('read_block', { blockIds: [citing] })).toMatchObject({ reads: [{ edgesOut: [] }] });
          expect(yield* call('update_block', { blockId: atCopy, title: 'Law of the copy, by address' })).toMatchObject({ status: 'ok' });
          const titleIn = (served: ServedGraph) =>
            Effect.provide(
              Effect.gen(function* () {
                const id = yield* (yield* BlockNames).idOfName(name);
                return (yield* (yield* Blocks).blockById(id)).title;
              }),
              served.context,
            );
          expect(yield* titleIn(servedCopy)).toBe('Law of the copy, by address');
          expect(yield* titleIn(servedLaw)).toBe('Law');
        }),
      ),
    ),
  );

  it.effect('moved away and pulled source first, is named by the project holding it live, from its old project and from a third', () =>
    withDemo(({ graph, context, project, demoRoot, projectId }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const law = project('law');
          const machine = machineGraphOf(context);
          const pool = yield* Effect.acquireRelease(
            graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
            (held) => held.dispose(),
          );
          const routed = routedContext(machine, pool);
          const servedLaw = yield* pool.resolve({ projectId: law.id });
          const idea = yield* Effect.provide(
            onGraph(servedLaw)(
              signed(Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: law.id, tags: ['idea'], title: 'Moving idea' }))),
            ),
            routed,
          );
          const committed = (cwd: string, message: string) =>
            Effect.andThen(
              runGit(graph.git, message, ['add', '-A'], { cwd }),
              runGit(
                graph.git,
                message,
                ['-c', 'user.name=team', '-c', 'user.email=team@tagma', 'commit', '-q', '--allow-empty', '-m', message],
                {
                  cwd,
                },
              ),
            );
          yield* committed(law.root, 'pushed by a colleague');
          const landing = join(demoRoot, 'law-landing');
          yield* files.makeDirectory(landing, { recursive: true });
          yield* runGit(graph.git, 'landing', ['init', '-q', '-b', 'main'], { cwd: landing });
          yield* committed(landing, 'seed');
          const moved = yield* landed(routed, 'law-landing', landing);
          yield* pool.birth(moved.id);
          const servedLanding = yield* pool.resolve({ projectId: moved.id });
          yield* Effect.provide(
            onGraph(servedLanding)(
              signed(Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: moved.id, tags: ['idea'], title: 'Already here' }))),
            ),
            routed,
          );

          const pathIn = (served: ServedGraph, uuid: string) =>
            Effect.map(
              Context.get(served.context, GraphStore).db.select({ path: block.path }).from(block).where(eq(block.uuid, uuid)).get(),
              (row) => row?.path ?? '',
            );
          const leaving = yield* pathIn(servedLaw, idea.uuid);
          const rooted = yield* Effect.provide(
            Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(moved.id)),
            servedLanding.context,
          );
          const arriving = join(dirname(yield* pathIn(servedLanding, rooted.uuid)), basename(leaving));
          const text = yield* files.readFileString(join(servedLaw.layout.treeRoot, leaving));
          yield* files.remove(join(servedLaw.layout.treeRoot, leaving));
          yield* servedLaw.settled(true);
          yield* files.writeFileString(join(servedLanding.layout.treeRoot, arriving), text);
          yield* servedLanding.settled(true);

          const name = blockName(idea.uuid);
          const fromLaw = yield* toolsAt(routed, servedLaw, { id: law.id, name: 'law' });
          const fromHome = yield* toolsAt(routed, yield* pool.resolve({ projectId }), { id: projectId, name: 'home' });
          for (const call of [fromLaw, fromHome]) {
            expect(yield* call('read_block', { blockIds: [name] })).toMatchObject({ reads: [{ name, projectId: moved.id }] });
          }
        }),
      ),
    ),
  );
});
