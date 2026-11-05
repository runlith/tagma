import { unthreadedCaller } from '../callers';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join, posix } from 'node:path';
import { Agent } from '@runlith/agent/Agent';
import { type AgentRunner, makeAgentRunner } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import { builtinMode } from '../modes.js';
import { Message } from '@runlith/llm/schema/messages';
import { type WorkspaceInputSet, WorkspaceInputs } from '../../../native-harness/contract/service/inputs.js';
import {
  workspaceInputsLayer,
  agentLibrary,
  composeAgent,
  DECLARED_BASE_ID,
  agentFilesOf,
  DECLARATIONS,
  builtInSkills,
  asThreadContext,
  capabilitySources,
  threadRunStore,
  SCOPED_RUN,
} from '../../../native-harness/testing/doubles.js';
import { servedCapabilities } from './capabilities.js';
import { toolClaims, toolExecute } from '@runlith/agent/tool';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { threadAgent, type ThreadRunView } from '@runlith/agent/thread/agents/ThreadAgent';
import { noSources, registeredAgents } from '@runlith/agent/thread/conformance/agents';
import { isThreadRefused, asThreadRefused } from '../../../threads/testing/doubles.js';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { threadToolSources } from '@runlith/agent/thread/ThreadPorts';
import { versionedShelf } from '../../../artifacts/testing/doubles.js';
import { agentLibraryTag } from '../../../threads/testing/doubles.js';
import { NativeAgentDefinitions } from '../../../native-harness/contract/service/agents.js';
import { EnabledPlugins } from '../../../plugins/contract/service/plugins.js';
import { enabledPlugins } from '../../../plugins/testing/enabled.js';
import { CallerChangeWork, ChangeRecord } from '../../../change-record/contract/service/record.js';
import { idleCommands } from '../../../change-record/testing/doubles.js';
import { changeRecordOf, intakeOf } from '../../../change-record/testing/doubles.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { heldOfThread } from '../../../change-record/testing/doubles.js';
import { WorldFiles } from '../../../executions/contract/service/worlds.js';
import { type ThreadWorld } from '../../../executions/contract/service/worlds.js';
import { fixtureNativeCatalog as nativeCatalog } from '../nativeCatalog.js';
import { operationChecks } from '../../operationChecks.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { NO_RULES } from '../../../enforcement/testing/doubles.js';
import { graphFixture, demoGraphLayer, withDemo, type EffectDemo } from '../graphFixture.js';
import { Git } from '@runlith/git/Git';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import { acpTestSeat } from '../../../external-harnesses/testing/seats.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadStack, type ThreadParts } from '../threadParts.js';
import { makeWalks } from '../../../change-record/lines/walks.js';
const walks = makeWalks();
import { declaredAgents, teamLess } from '../../../threads/testing/doubles.js';
import { NativeAgents } from '../../../threads/contract/service/engine.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { CHECKOUT_FACTS } from '../../../executions/contract/service/worlds.js';
import { OPERATION_IDS } from '../catalog.js';
import { OperationId } from '../../../platform/contract/wire/ids.js';
import { commentPolicy } from '../../../graph/testing/doubles.js';
import { nativeOffers } from '../../../invocation/testing/native.js';
import { fixtureOperationCatalog } from '../nativeCatalog.js';
import { ENTRY_KINDS, NATIVE_AGENT_RULES } from '../composed.js';
import { AgentRuleRegistry } from '@runlith/agent/AgentRuntimePolicy';
import { builtinRegistry } from '../providerCatalog.js';
import { skillTarget } from '../../../external-harnesses/testing/doubles.js';
const world = Effect.fnUntraced(function* (demo: EffectDemo) {
  const operationCatalog = yield* fixtureOperationCatalog;
  const capabilityOffers = nativeOffers(operationCatalog);
  const { offers } = capabilityOffers;
  const records = yield* makeThreadRecords;
  const { store, threads } = yield* threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: ENTRY_KINDS });
  const capabilities = yield* servedCapabilities();
  const runner = yield* makeAgentRunner({
    idleMs: 5000,
    models: {
      request: () => {
        throw new Error('Reading a library must not invoke a model.');
      },
    },
  });
  const declarations = DECLARATIONS();
  const ruleRegistry = new AgentRuleRegistry(NATIVE_AGENT_RULES);
  const agents = declarations.map((declaration) =>
    composeAgent(ruleRegistry, declaration, capabilities, runner, threads.rows, threads.mandate, teamLess, () =>
      Effect.die('A library read must not prepare a thread context or connect a world.'),
    ),
  );
  const types = yield* declaredAgents({
    harnesses: Effect.succeed([]),
    storePath: join(demo.demoRoot, 'personal', 'tagma.sqlite'),
    files: agentFilesOf()(capabilities),
    packages: [],
  }).pipe(
    Effect.provideService(NativeAgents, yield* registeredAgents(agents, 'test')),
    Effect.provideService(ThreadRecords, records),
    Effect.provideService(Projects, demo.graph.projects),
    Effect.provideService(Settings, demo.graph.settings),
  );
  const sourceCache = Context.get(
    yield* Layer.build(workspaceInputsLayer((root) => [skillTarget(root)], [])).pipe(
      Effect.provideService(EnabledPlugins, (yield* enabledPlugins()).service),
    ),
    WorkspaceInputs,
  );
  const shipped = (yield* sourceCache.walk(demo.projectId, demo.demoRoot)).shipped;
  const artifacts = yield* versionedShelf(join(demo.demoRoot, 'artifacts'), 'http://localhost');
  const library = yield* agentLibrary({
    types,
    declarations,
    threads: threads.list,
    records,
    store,
    sourceCache,
    artifacts,
    graphs: {
      graph: demo.context,
      graphFor: () => Effect.succeed(demo.context),
      graphAt: () => Effect.die('a library read opens no thread graph'),
    },
    offers: capabilityOffers,
    world: machineWorld,
    capabilities,
  }).pipe(Effect.provideContext(yield* Layer.build(builtinRegistry)));
  return {
    library,
    types,
    store,
    threads,
    records,
    sourceCache,
    artifacts,
    shipped,
    declarations,
    runner,
    capabilities,
    capabilityOffers,
    offers,
    operationCatalog,
  };
});
const source = (body: string, capabilities: readonly string[] = []) =>
  `---\n${JSON.stringify({ description: 'A file agent', capabilities })}\n---\n${body}\n`;
layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('agent library', (it) => {
  it.effect('a project’s law and vocabulary are read from the graph that serves it, never from the graph the library was built over', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { types, store, threads, records, sourceCache, artifacts, declarations, capabilities, capabilityOffers } =
            yield* world(demo);
          const servedFixture = graphFixture();
          const served = yield* Effect.acquireRelease(servedFixture.openEffect(), () => servedFixture.releaseEffect.pipe(Effect.orDie));
          expect(served.projectId).toBe(demo.projectId);
          yield* served.graph.blocks
            .create({
              projectId: served.projectId,
              parentId: served.root,
              tags: ['rule'],
              title: 'The served graph is where this project’s law stands',
            })
            .pipe(Effect.provide(served.context));
          const asked: number[] = [];
          const library = yield* agentLibrary({
            types,
            declarations,
            threads: threads.list,
            records,
            store,
            sourceCache,
            artifacts,
            graphs: {
              graph: demo.context,
              graphFor: (projectId) => {
                asked.push(projectId);
                return Effect.succeed(served.context);
              },
              graphAt: () => Effect.die('a preview reads no thread graph'),
            },
            offers: capabilityOffers,
            world: machineWorld,
            capabilities,
          }).pipe(Effect.provideContext(yield* Layer.build(builtinRegistry)));
          const preview = yield* library.preview(demo.projectId, { id: 'tagma' });
          expect(asked).toEqual([demo.projectId]);
          const law = (preview.instructions?.entries ?? [])
            .filter((entry) => entry.kind === 'law')
            .map((entry) => entry.text)
            .join('\n');
          expect(law).toContain('The served graph is where this project’s law stands');
        }),
      ),
    ),
  );
  const PLAIN_WORDS: ReadonlySet<string> = new Set(['ask']);
  it.effect(
    'every agent this server ships is a read-only built-in of any project, whose prompt names only operations its capabilities mount',
    () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const { library, capabilities, operationCatalog, offers } = yield* world(demo);
            const builtins = (yield* library.list(demo.projectId)).definitions.filter((entry) => entry.origin.scope === 'builtin');
            expect(builtins.map((entry) => entry.id)).toEqual(
              DECLARATIONS()
                .filter((entry) => entry.id !== DECLARED_BASE_ID())
                .map((entry) => entry.id),
            );
            for (const builtin of builtins) {
              expect(builtin.editable).toBe(false);
              const preview = yield* library.preview(demo.projectId, { id: builtin.id });
              const held = capabilities.list().filter((capability) => preview.capabilities.includes(capability.id));
              const runtimeServed = OPERATION_IDS.filter((id) => {
                const door = operationCatalog.registry.entry(OperationId.make(id)).tool;
                return door?.runtime === true && preview.capabilities.includes(door.capability);
              });
              const mounted = new Set([
                ...held.flatMap((capability) =>
                  offers(capability.id, { world: CHECKOUT_FACTS, comments: commentPolicy().fallback, images: true }).map(
                    (offered) => offered.id,
                  ),
                ),
                ...runtimeServed,
              ]);
              const named = OPERATION_IDS.filter((id) =>
                new RegExp(PLAIN_WORDS.has(id) ? `\`${id}\`` : `\\b${id}\\b`).test(preview.prompt.text),
              );
              expect({ agent: builtin.id, unmounted: named.filter((id) => !mounted.has(id)) }).toEqual({
                agent: builtin.id,
                unmounted: [],
              });
            }
          }),
        ),
      ),
  );
  it.effect('a saved declaration is the same file resolved at birth, without automatically offering it to agents', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library, types, threads, records } = yield* world(demo);
          const text = source('Answer in one paragraph.');
          const saved = yield* library.save(demo.projectId, { name: 'reader', scope: 'project', source: text, revision: null });
          expect(yield* files.readFileString(saved.origin.path!)).toBe(text);
          const shown = yield* library.preview(demo.projectId, { id: 'reader' });
          expect(shown.definition).toEqual(saved);
          expect(shown.capabilities).toEqual([]);
          expect(shown.prompt.sections.map((part) => part.text).join('\n\n')).toBe(shown.prompt.text);
          const birth = yield* types.resolveIn({ projectId: demo.projectId, caller: 'operator', typeId: 'reader' });
          expect(birth).toMatchObject({ profile: { prompt: shown.definition.body } });
          expect(yield* types.resolveIn({ projectId: demo.projectId, caller: 'agent', typeId: 'reader' })).toHaveProperty('withheld');
          expect(yield* records.countIn(demo.projectId)).toBe(0);
        }),
      ),
    ),
  );
  it.effect(
    'a definition extending a built-in edits its prompt by section, is born with the edits, and a stale edit refuses the next preview',
    () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { library, types } = yield* world(demo);
            const base = (yield* library.preview(demo.projectId, { id: 'tagma' })).prompt.sections;
            const [, target, dropped] = base;
            const passage = target!.text.split('\n')[0]!;
            const sections = [
              { edit: target!.id, find: passage, with: `${passage} Edited.` },
              { drop: dropped!.id },
              { add: 'own', after: target!.id, text: '## Own\n\nAdded.' },
            ];
            const declaration = (edits: readonly object[]) => `---\n${JSON.stringify({ extends: 'tagma', sections: edits })}\n---\n`;
            const saved = yield* library.save(demo.projectId, {
              name: 'variant',
              scope: 'project',
              source: declaration(sections),
              revision: null,
            });
            const shown = (yield* library.preview(demo.projectId, { id: 'variant' })).prompt.sections;
            expect(shown.map((section) => section.id)).toEqual(
              base.flatMap((section) => (section.id === dropped!.id ? [] : section.id === target!.id ? [section.id, 'own'] : [section.id])),
            );
            expect(shown.find((section) => section.id === target!.id)?.text).toBe(target!.text.replace(passage, `${passage} Edited.`));
            const birth = yield* types.resolveIn({ projectId: demo.projectId, caller: 'operator', typeId: 'variant' });
            expect(birth).toMatchObject({ profile: { sections } });
            yield* library.save(demo.projectId, {
              name: 'variant',
              scope: 'project',
              source: declaration([{ edit: target!.id, find: `${passage} Gone.`, with: passage }]),
              revision: saved.origin.revision,
            });
            expect((yield* demo.refusal(library.preview(demo.projectId, { id: 'variant' }))).code).toBe('agent-invalid');
          }),
        ),
      ),
  );
  it.effect('a preview carries the section of a capability its setting enables, as the thread born now would', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { library } = yield* world(demo);
          const sectionIds = Effect.map(library.preview(demo.projectId, { id: 'tagma' }), (shown) =>
            shown.prompt.sections.map((section) => section.id),
          );
          expect(yield* sectionIds).not.toContain('code-navigation');
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'navigation.enabled', value: true });
          expect(yield* sectionIds).toContain('code-navigation');
        }),
      ),
    ),
  );
  it.effect('a tools whitelist narrows capability sections while preserving standing sources and the built-in composition', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { library } = yield* world(demo);
          const shown = yield* library.preview(demo.projectId, { id: 'tagma' });
          expect(shown.capabilities).toContain('browser');
          expect(shown.prompt.sections.map((section) => section.id)).toContain('browser-pages');
          const narrowed = yield* library.preview(demo.projectId, { source: '---\nextends: tagma\ntools: [bash]\n---\n' });
          const ids = narrowed.prompt.sections.map((section) => section.id);
          expect(ids).toContain('the-shared-checkout');
          expect(ids).toContain('keep-warm');
          expect(ids).toContain('mcp-servers');
          expect(ids).toContain('apps');
          expect(ids).not.toContain('browser-pages');
          expect(ids).not.toContain('held-processes');
          expect(narrowed.toolCatalog?.tools.map((tool) => tool.name)).toEqual(['ask_user', 'bash', 'tool_search']);
          const browser = yield* library.preview(demo.projectId, { source: '---\nextends: tagma\ntools: [open_page]\n---\n' });
          expect(browser.prompt.sections.map((section) => section.id)).toContain('browser-pages');
        }),
      ),
    ),
  );
  it.effect('a tools whitelist naming a tool no held capability can offer refuses and names the capability that offers it', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { library } = yield* world(demo);
          const definition = (capabilities: string) =>
            `---\ncapabilities: ${capabilities}\ntools: [read, grep, glob, search_blocks]\n---\nSearch.\n`;
          const refused = yield* demo.refusal(library.preview(demo.projectId, { source: definition('[files, graph]') }));
          expect(refused.code).toBe('agent-invalid');
          expect(refused.reason).toContain('grep, glob: add shell');
          const held = yield* library.preview(demo.projectId, { source: definition('[files, shell, graph]') });
          expect(held.toolCatalog?.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['grep', 'glob', 'search_blocks']));
        }),
      ),
    ),
  );
  it.effect('a native file source is read in the bound world while the declaration is saved by its library owner', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library, types } = yield* world(demo);
          const text = source('Instructions supplied by the guest.');
          let current = text;
          const guestFiles = FileSystem.makeNoop({
            readFileString: (path) =>
              path === '/guest/scratch/agent.md' ? Effect.succeed(current) : Effect.die(`Unexpected guest read: ${path}`),
            realPath: (path) => Effect.succeed(path.replace('/guest/scratch', '/guest/real')),
          });
          const guest: ThreadWorld = {
            kind: 'sandbox',
            facts: { shared: false, history: false, network: false },
            root: '/guest/work',
            scratch: '/guest/scratch',
            alive: () => true,
            world: {
              files: Layer.succeed(FileSystem.FileSystem, guestFiles),
              environment: { ...machineWorld.environment, platform: 'linux' },
            },
          };
          const paths = yield* fixedCheckoutPaths(demo.projectId, [{ checkout: 'demo', root: demo.demoRoot }]);
          const changes = yield* Effect.gen(function* () {
            return yield* changeRecordOf(
              demo.graph.store,
              demo.graph.units,
              paths,
              yield* intakeOf(demo.graph.store, demo.graph.units, yield* Git, paths),
              yield* idleCommands(),
              walks,
            );
          });
          const work = { work: { projectId: demo.projectId, threadId: 'native-writer' } };
          const vocabulary = yield* demo.graph.tags.reader(demo.projectId);
          const project = yield* demo.graph.projects.byId(demo.projectId);
          const tools = yield* nativeCatalog(
            {
              place: null,
              standing: { world: guest, projectRoot: demo.demoRoot },
              caller: {
                actor: { kind: 'operator' },
                files: {
                  path: guest.scratch,
                  resolve: (candidate) => posix.resolve(guest.scratch, candidate),
                },
              },
              project: { id: project.id, name: project.name },
              vocabulary,
              identity: testSessionIdentity,
              world: 'checkout',
              graphRoot: demo.demoRoot,
              owners: Context.merge(
                demo.context,
                Context.empty().pipe(
                  Context.add(
                    agentLibraryTag(),
                    agentLibraryTag().of({
                      list: library.list,
                      preview: library.preview,
                      offered: (projectId, caller) =>
                        Effect.all({ types: types.offeredIn({ projectId, caller }), rejected: types.rejectedIn(projectId) }),
                    }),
                  ),
                  Context.add(NativeAgentDefinitions, library),
                  Context.add(WorldFiles, { files: guest.world.files }),
                  Context.add(ChangeRecord, changes),
                  Context.add(CallerChangeWork, work),
                  Context.add(RuleChecks, NO_RULES),
                  Context.add(OperationChecks, operationChecks(NO_RULES)),
                ),
              ),
            },
            ['save_agent'],
          );
          const execute = toolExecute(tools.save_agent!);
          if (execute == null) return yield* Effect.die('The native save door is not executable.');
          yield* execute(
            { name: 'from-guest', scope: 'project', revision: null, sourceFile: 'agent.md' },
            { toolCallId: 'save', caller: unthreadedCaller, messages: [] },
          );
          const saved = yield* library.preview(demo.projectId, { id: 'from-guest' });
          expect(saved.definition.source).toBe(text);
          expect(yield* files.readFileString(saved.definition.origin.path!)).toBe(text);
          const held = yield* heldOfThread(demo.graph.units, demo.graph.store, demo.projectId, 'native-writer');
          expect(held).toHaveLength(1);
          expect(held[0]).toMatchObject({ path: '.agents/from-guest.md', origin: 'write', newText: text, mode: '100644' });
          current = source('Instructions the guest rewrote afterwards.');
          yield* execute(
            { name: 'from-guest', scope: 'project', revision: saved.definition.origin.revision, sourceFile: 'agent.md' },
            { toolCallId: 'resave', caller: unthreadedCaller, messages: [] },
          );
          const resaved = yield* library.preview(demo.projectId, { id: 'from-guest' });
          expect(resaved.definition.source).toBe(current);
          expect(resaved.definition.origin.revision).not.toBe(saved.definition.origin.revision);
          expect(
            yield* toolClaims(
              tools.save_agent!,
              { name: 'from-guest', scope: 'project', revision: null, sourceFile: 'agent.md' },
              { toolCallId: 'ordered', caller: unthreadedCaller },
            ),
          ).toEqual([{ on: { kind: 'file', path: '/guest/real/agent.md' }, access: 'read' }]);
        }),
      ),
    ),
  );
  it.effect('only one replacement of a revision lands, and the losing draft does not overwrite it', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library } = yield* world(demo);
          const first = yield* library.save(demo.projectId, { name: 'reader', scope: 'project', source: source('First.'), revision: null });
          const results = yield* Effect.all(
            ['Second.', 'Third.'].map((body) =>
              Effect.result(
                library.save(demo.projectId, {
                  name: 'reader',
                  scope: 'project',
                  source: source(body),
                  revision: first.origin.revision,
                }),
              ),
            ),
            { concurrency: 'unbounded' },
          );
          const winners = results.filter((result) => result._tag === 'Success');
          const losers = results.filter((result) => result._tag === 'Failure');
          expect(winners).toHaveLength(1);
          expect(losers).toHaveLength(1);
          expect(losers[0]!.failure).toMatchObject({ code: 'agent-changed' });
          expect(yield* files.readFileString(first.origin.path!)).toBe(winners[0]!.success.source);
          const duplicate = yield* demo.refusal(
            library.save(demo.projectId, { name: 'reader', scope: 'project', source: source('Overwrite.'), revision: null }),
          );
          expect(duplicate.code).toBe('agent-changed');
        }),
      ),
    ),
  );
  it.effect('a personal definition wins its project name and a later file edit invalidates an open editor', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library } = yield* world(demo);
          const project = yield* library.save(demo.projectId, {
            name: 'reader',
            scope: 'project',
            source: source('Project.'),
            revision: null,
          });
          const personal = yield* library.save(demo.projectId, {
            name: 'reader',
            scope: 'personal',
            source: source('Personal.'),
            revision: null,
          });
          const catalog = yield* library.list(demo.projectId);
          expect(catalog.definitions.find((entry) => entry.id === 'reader')?.origin).toEqual(personal.origin);
          expect(catalog.rejected.find((entry) => entry.path === project.origin.path)?.reason).toBe(`shadowed by ${personal.origin.path}`);
          yield* files.writeFileString(personal.origin.path!, source('Edited outside the library.'));
          const refusal = yield* demo.refusal(
            library.save(demo.projectId, {
              name: 'reader',
              scope: 'personal',
              source: source('Stale.'),
              revision: personal.origin.revision,
            }),
          );
          expect(refusal.code).toBe('agent-changed');
          expect(yield* files.readFileString(personal.origin.path!)).toBe(source('Edited outside the library.'));
        }),
      ),
    ),
  );
  it.effect('invalid names, built-in replacement and symlink writes refuse without changing the target', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library } = yield* world(demo);
          for (const [name, text, code] of [
            ['../escape', source('Escape.'), 'agent-name'],
            ['tagma', source('Replacement.'), 'agent-invalid'],
            ['invalid', source('Wrong capability.', ['telepathy']), 'agent-invalid'],
            ['empty', '---\ncapabilities: []\n---', 'agent-invalid'],
            ['two-forms', '---\nextends: tagma\nsections:\n  - drop: commits\n    text: Kept.\n---\n', 'agent-invalid'],
          ] as const) {
            expect((yield* demo.refusal(library.save(demo.projectId, { name, scope: 'project', source: text, revision: null }))).code).toBe(
              code,
            );
          }
          const directory = join(demo.demoRoot, '.agents');
          yield* files.makeDirectory(directory, { recursive: true });
          const target = join(demo.demoRoot, 'outside.md');
          yield* files.writeFileString(target, source('Do not replace me.'));
          yield* files.symlink(target, join(directory, 'linked.md'));
          const refused = yield* demo.refusal(
            library.save(demo.projectId, { name: 'linked', scope: 'project', source: source('Changed.'), revision: null }),
          );
          expect(refused.code).toBe('agent-path');
          expect(yield* files.readFileString(target)).toBe(source('Do not replace me.'));
        }),
      ),
    ),
  );
  it.effect('a thread keeps its exact prompt and birth overlay after its definition changes, behind the project gate', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library, types, store, threads } = yield* world(demo);
          const first = yield* library.save(demo.projectId, {
            name: 'reader',
            scope: 'project',
            source: source('Original.'),
            revision: null,
          });
          const offer = yield* types.resolveIn({ projectId: demo.projectId, caller: 'operator', typeId: 'reader' });
          if (offer === null || 'withheld' in offer || !offer.profile) return yield* Effect.die('The saved file did not resolve at birth.');
          const profile = { id: 'reader', overlay: offer.profile };
          const frozen = '  The exact prompt that was saved.\n\n## A section\nNot today’s file.\n';
          const row = yield* store.transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* store.insert(
                { ownerId: 'operator', agentId: offer.baseAgentId, provider: 'openai-oauth', profile, systemPrompt: frozen },
                tx,
              );
              yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, tx);
              return row;
            }),
          );
          yield* library.save(demo.projectId, {
            name: 'reader',
            scope: 'project',
            source: source('Current.'),
            revision: first.origin.revision,
          });
          const shown = yield* library.thread(demo.projectId, row.id);
          expect(shown.prompt.text).toBe(frozen);
          expect(shown.definition.body).toBe('Original.');
          expect(shown.frozen).toBe(true);
          const refused = yield* Effect.result(library.thread(demo.projectId + 1, row.id));
          if (refused._tag !== 'Failure') return yield* Effect.die('A foreign project read the thread.');
          expect(isThreadRefused(refused.failure)).toBe(true);
          expect((refused.failure as ReturnType<typeof asThreadRefused>).projectId).toBe(demo.projectId);
        }),
      ),
    ),
  );
  it.effect('skill completion uses the effective pool and cannot offer a loader the profile removed', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library, records, artifacts, shipped } = yield* world(demo);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.directories.global', value: [] });
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: ['disabled'] });
          for (const id of ['writer', 'disabled', 'artifacts', 'showcase']) {
            const directory = join(demo.demoRoot, '.agents/skills', id);
            yield* files.makeDirectory(directory, { recursive: true });
            yield* files.writeFileString(join(directory, 'SKILL.md'), `---\ndescription: ${id}\n---\nInstructions.\n`);
          }
          const shown = yield* library.skills(demo.projectId, { kind: 'draft' });
          expect(shown.skills.map((skill) => skill.id)).toEqual([...builtInSkills(artifacts, shipped).map((skill) => skill.id), 'writer']);
          expect(shown.available).toBe(true);
          expect(shown.basis).toBe('next-turn');
          yield* library.save(demo.projectId, { name: 'no-skills', scope: 'project', source: source('No tools.'), revision: null });
          expect(yield* library.skills(demo.projectId, { kind: 'draft', type: 'no-skills' })).toMatchObject({
            skills: [],
            available: false,
          });
          yield* library.save(demo.projectId, {
            name: 'no-loader',
            scope: 'project',
            source: '---\ncapabilities: [skills]\ntools: []\n---\nNo loader.\n',
            revision: null,
          });
          expect(yield* library.skills(demo.projectId, { kind: 'draft', type: 'no-loader' })).toMatchObject({
            skills: [],
            available: false,
          });
          expect(yield* records.countIn(demo.projectId)).toBe(0);
        }),
      ),
    ),
  );
  it.effect('a thread a harness hosts is offered the skills of the agent it hosts, and a harness that hosts none offers none', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library, store, threads, artifacts, shipped } = yield* world(demo);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.directories.global', value: [] });
          const directory = join(demo.demoRoot, '.agents/skills/writer');
          yield* files.makeDirectory(directory, { recursive: true });
          yield* files.writeFileString(join(directory, 'SKILL.md'), '---\ndescription: Writes.\n---\nWrite the result.\n');
          const seated = (agent: string | null) =>
            store.transaction((tx) =>
              Effect.gen(function* () {
                const row = yield* store.insert({ ownerId: 'operator', agentId: 'harness', provider: 'claude-code' }, tx);
                yield* threads.rows.attachFacet(
                  { threadId: row.id, projectId: demo.projectId, harness: acpTestSeat('claude-code', agent, undefined) },
                  tx,
                );
                return row.id;
              }),
            );
          const hosted = yield* library.skills(demo.projectId, { kind: 'thread', id: yield* seated('tagma') });
          expect(hosted.skills.map((skill) => skill.id)).toEqual([...builtInSkills(artifacts, shipped).map((skill) => skill.id), 'writer']);
          expect((yield* library.skills(demo.projectId, { kind: 'thread', id: yield* seated(null) })).available).toBe(false);
        }),
      ),
    ),
  );
  it.effect('skills.disabled hides built-in and discovered skills by name and enabling them restores the catalog', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library, artifacts, shipped } = yield* world(demo);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.directories.global', value: [] });
          const directory = join(demo.demoRoot, '.agents/skills/writer');
          yield* files.makeDirectory(directory, { recursive: true });
          yield* files.writeFileString(join(directory, 'SKILL.md'), '---\ndescription: Writes.\n---\nWrite the result.\n');
          const builtin = builtInSkills(artifacts, shipped).map((skill) => skill.id);
          yield* demo.graph.settings.write({
            scope: 'project',
            projectId: demo.projectId,
            key: 'skills.disabled',
            value: [...builtin, 'writer'],
          });
          const hidden = yield* library.skills(demo.projectId, { kind: 'draft' });
          expect(hidden.skills).toEqual([]);
          expect(hidden.available).toBe(false);
          yield* demo.graph.settings.write({
            scope: 'project',
            projectId: demo.projectId,
            key: 'skills.disabled',
            value: ['showcase', 'performance'],
          });
          const partial = yield* library.skills(demo.projectId, { kind: 'draft' });
          expect(partial.skills.map((skill) => skill.id)).toEqual([
            ...builtin.filter((id) => !['showcase', 'performance'].includes(id)),
            'writer',
          ]);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: [] });
          const restored = yield* library.skills(demo.projectId, { kind: 'draft' });
          expect(restored.skills.map((skill) => skill.id)).toEqual([...builtin, 'writer']);
          expect(restored.available).toBe(true);
        }),
      ),
    ),
  );
  it.effect('a running harness withdraws and restores disabled skills without replacing its run', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const {
            library,
            store,
            threads,
            records,
            sourceCache,
            artifacts,
            shipped,
            declarations,
            runner,
            capabilities,
            capabilityOffers,
          } = yield* world(demo);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.directories.global', value: [] });
          const row = yield* store.transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma', provider: 'openai-oauth' }, tx);
              yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, tx);
              return row;
            }),
          );
          const history: Message[] = [];
          const view = { ...row, history, transcript: [] };
          const runs = yield* threadRunStore({
            kinds: ENTRY_KINDS,
            records,
            ownerId: 'operator',
            scope: SCOPED_RUN(),
            lifecycle: { started: (id, at, tx) => threads.spells.begin(id, at, tx), settled: (id, tx) => threads.spells.end(id, tx) },
          });
          const start = () =>
            Effect.map(
              runs.createRun({
                startFrom: {
                  id: row.id,
                  ownerId: row.ownerId,
                  account: null,
                  provider: row.provider,
                  model: null,
                  reasoning: null,
                  switches: {},
                },
                kind: 'turn',
                approval: { mode: 'trust', interactive: false },
                progress: { stage: 'running', message: null },
              }),
              (started) => started.run.id,
            );
          const settle = Effect.fnUntraced(function* (id: string) {
            const at = new Date(yield* Clock.currentTimeMillis);
            return yield* runs.settleRun(id, {
              status: 'completed',
              progress: { stage: 'completed', message: null },
              finishedAt: at,
              heartbeatAt: at,
            });
          });
          const registry = threadToolSources();
          yield* capabilitySources(registry, capabilities);
          const aim = { threadId: row.id, projectId: demo.projectId, root: demo.demoRoot };
          const adapter = composeAgent(
            new AgentRuleRegistry(NATIVE_AGENT_RULES),
            { ...declarations.find((entry) => entry.id === 'tagma')!, capabilities: ['skills'], sources: [] },
            capabilities,
            runner,
            threads.rows,
            threads.mandate,
            teamLess,
            (_thread, use) =>
              Effect.map(
                sourceCache.resolve(aim, use, {
                  threadId: row.id,
                  runId: use.runId ?? row.id,
                  generation: WorkspaceGeneration.make(use.context?.generation ?? 0),
                }),
                (sources) =>
                  asThreadContext({
                    thread: view,
                    sources,
                    artifacts,
                    settings: demo.graph.settings,
                    projectId: demo.projectId,
                    graph: Effect.succeed(demo.context),
                    world: { facts: {} },
                    web: { source: 'none' },
                    unavailableCapabilities: [],
                    offers: capabilityOffers,
                    comments: () => commentPolicy().fallback,
                    execution: { tools: () => ({}) },
                  }),
              ),
          );
          const run = (id: string): ThreadRunView => ({
            id,
            status: 'running',
            account: null,
            provider: row.provider,
            model: null,
            reasoning: null,
            switches: {},
            approvalMode: 'trust',
            interactive: false,
          });
          const supply = { sources: (context: unknown) => registry.offers({ thread: row, context }, ['skills']), outputTools: {} };
          const catalog = (id: string) => adapter.toolCatalog({ thread: view, run: run(id), supply });
          const orient = Effect.fnUntraced(function* (id: string) {
            const oriented = yield* (yield* adapter.prepare({ thread: view, run: run(id), supply })).orient(view);
            if (oriented) {
              if (oriented.commit) yield* demo.graph.units.write('skills.turn', (tx) => oriented.commit!(tx));
              history.push(oriented.message);
            }
            return (yield* threads.rows.worldStateSnapshot(row.id)).snapshot;
          });
          const ids = builtInSkills(artifacts, shipped).map((skill) => skill.id);
          const enabledRun = yield* start();
          yield* orient(enabledRun);
          expect(Object.keys(yield* catalog(enabledRun)).sort()).toEqual(['load_skill', 'publish_artifact']);
          const prepared = yield* adapter.prepare({ thread: view, run: run(enabledRun), supply });
          const hosted = yield* prepared.host!({
            thread: view,
            run: run(enabledRun),
            stop: new RunStop(),
            model: { ownerId: row.ownerId, provider: row.provider!, model: row.model, reasoning: row.reasoning, switches: row.switches },
            instructions: 'Serve the skills.',
            modeOf: builtinMode('bypass'),
            toolOutputs: {
              project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
              projectMessages: (messages) => Effect.succeed(messages),
            },
          });
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: ids });
          yield* hosted.refresh();
          expect(Object.keys(hosted.catalog())).toEqual([]);
          expect(Object.keys(yield* catalog(enabledRun))).toEqual([]);
          const standing = yield* library.skills(demo.projectId, { kind: 'thread', id: row.id });
          expect(standing.basis).toBe('thread');
          expect(standing.skills.map((skill) => skill.id)).toEqual([]);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: [] });
          yield* hosted.refresh();
          expect(Object.keys(hosted.catalog()).sort()).toEqual(['load_skill', 'publish_artifact']);
          yield* hosted.close();
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: ids });
          yield* settle(enabledRun);
          const disabledRun = yield* start();
          const hidden = yield* orient(disabledRun);
          expect(hidden.skills).toBeUndefined();
          expect(Object.keys(yield* catalog(disabledRun))).toEqual([]);
          expect((yield* library.skills(demo.projectId, { kind: 'thread', id: row.id })).skills).toEqual([]);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.disabled', value: [] });
          yield* sourceCache.invalidate({ projectId: demo.projectId });
          yield* settle(disabledRun);
          const restoredRun = yield* start();
          const restored = yield* orient(restoredRun);
          expect(restored.skills).toEqual(
            builtInSkills(artifacts, shipped).map(({ id, description, references }) => ({
              id,
              description,
              references: references?.map(({ name, description }) => ({ name, description })),
            })),
          );
          expect(Object.keys(yield* catalog(restoredRun)).sort()).toEqual(['load_skill', 'publish_artifact']);
          yield* settle(restoredRun);
        }),
      ),
    ),
  );
  it.effect('an unreadable source identity is refused rather than reported as an empty catalog', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { library } = yield* world(demo);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.directories.global', value: [] });
          const directory = join(demo.demoRoot, '.agents/skills');
          yield* files.makeDirectory(directory, { recursive: true });
          yield* files.symlink('tagma', join(directory, 'tagma'));
          expect((yield* demo.refusal(library.skills(demo.projectId, { kind: 'draft' }))).code).toBe('source-unreadable');
        }),
      ),
    ),
  );
  it.effect('a context plug does not turn a tool inspection into a live source binding', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { store, threads, sourceCache, runner } = yield* world(demo);
          yield* demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: 'skills.directories.global', value: [] });
          const row = yield* store.transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* store.insert({ ownerId: 'reader', agentId: 'sources', provider: 'openai-oauth' }, tx);
              yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, tx);
              return row;
            }),
          );
          const aim = { threadId: row.id, projectId: demo.projectId, root: demo.demoRoot };
          const addressed = (use: {
            runId: string | null;
            context: {
              generation: number;
            } | null;
          }) => ({
            threadId: row.id,
            runId: use.runId ?? row.id,
            generation: WorkspaceGeneration.make(use.context?.generation ?? 0),
          });
          const view = { ...row, transcript: [] };
          const base = {
            agent: new Agent<WorkspaceInputSet>({
              id: 'sources',
              name: 'Sources',
              description: 'Source binding contract.',
              instructions: () => 'Read sources.',
              tools: () => ({}),
              stopWhen: [],
            }),
            runner,
            runPolicy: { userStartable: true, backgroundStartable: false },
          };
          const adapters = [
            threadAgent({
              ...base,
              context: (_thread, use) => sourceCache.resolve(aim, use, addressed(use)),
              turnContext: () => Effect.succeed({ message: Message.user('Prepared.') }),
            }),
          ];
          const directory = join(demo.demoRoot, '.agents/skills/writer');
          yield* files.makeDirectory(directory, { recursive: true });
          for (const [index, adapter] of adapters.entries()) {
            yield* files.writeFileString(join(directory, 'SKILL.md'), '---\ndescription: Before inspection.\n---\nInstructions.\n');
            const run: ThreadRunView = {
              id: `run-${index}`,
              status: 'running',
              account: null,
              provider: row.provider,
              model: null,
              reasoning: null,
              switches: {},
              approvalMode: 'trust',
              interactive: false,
            };
            yield* (yield* adapter.prepare({ thread: view, run, supply: { sources: noSources, outputTools: {} } })).orient(view);
            const prepared = yield* sourceCache.snapshot(row.id, run.id);
            expect(prepared?.skills.map((skill) => skill.description)).toEqual(['Before inspection.']);
            yield* files.writeFileString(join(directory, 'SKILL.md'), '---\ndescription: After inspection.\n---\nInstructions.\n');
            yield* sourceCache.invalidate({ threadId: row.id });
            const inspection = { ...run, id: `inspection-${index}` };
            yield* adapter.toolCatalog({ thread: view, run: inspection, supply: { sources: noSources, outputTools: {} } });
            expect(yield* sourceCache.snapshot(row.id, run.id)).toBe(prepared);
            expect(yield* sourceCache.snapshot(row.id, inspection.id)).toBeUndefined();
            yield* sourceCache.releaseRun(row.id, run.id);
          }
        }),
      ),
    ),
  );
});
