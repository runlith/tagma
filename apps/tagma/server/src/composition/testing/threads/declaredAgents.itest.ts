import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import type { ThreadAgent } from '@runlith/agent/thread/agents/ThreadAgent';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import { NATIVE_HARNESS, type ThreadRecord } from '@runlith/agent/thread/record';
import { EXTERNAL_CAPABILITIES, NATIVE_CAPABILITIES } from '../../../threads/testing/doubles.js';
import type { ThreadTypeCaller } from '@runlith/agent/thread/agents/ThreadTypeCatalog';
import { Effect, FileSystem } from 'effect';
import { ENTRY_KINDS } from '../../manifest.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { NativeAgents } from '../../../threads/contract/service/engine.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { graphFixture } from '../graphFixture.js';
import { asHarnessInstall } from '../../../threads/testing/doubles.js';
import { agentsOffered } from '../../../threads/testing/doubles.js';
import { HARNESS_AGENT_ID } from '../../../threads/testing/doubles.js';
import { DECLARED_BASE_ID, agentFilesOf, makePluginAgents, threadStore } from '../../../native-harness/testing/doubles.js';
import type { AgentPackages } from '../../../threads/contract/service/library.js';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';
import { EnabledPlugins, type LoadedAgent, type PluginLoaded } from '../../../plugins/contract/service/plugins.js';
import { enabledPlugins } from '../../../plugins/testing/enabled.js';
import { servedCapabilities } from '../native-harness/capabilities.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { declaredHarness } from '../../../external-harnesses/adapter/declared.js';
import { grok } from '@runlith/adapter-xai/harness';

import { declaredAgents, PERSONAL_AGENTS_DIRECTORY, PROJECT_AGENTS_DIRECTORY } from '../../../threads/testing/doubles.js';

const world = Effect.fnUntraced(function* (
  harnesses: readonly ReturnType<typeof asHarnessInstall>[] = [],
  packages: readonly AgentPackages[] = [],
) {
  const held = graphFixture();
  const demo = yield* Effect.map(
    Effect.acquireRelease(held.openEffect(), () => Effect.orDie(held.releaseEffect)),
    (demo) => demo.effects,
  );
  const home = yield* demo.fixture.directory('agents-home');
  const personal = join(home, PERSONAL_AGENTS_DIRECTORY());
  const project = join(demo.demoRoot, PROJECT_AGENTS_DIRECTORY());
  const fs = yield* Effect.provide(FileSystem.FileSystem, BunFileSystem.layer);
  yield* fs.makeDirectory(personal, { recursive: true });
  yield* fs.makeDirectory(project, { recursive: true });
  const agents = yield* registeredAgents([agent('tagma'), agent('code'), agent(HARNESS_AGENT_ID()), agent(DECLARED_BASE_ID())], 'test');
  const files = agentFilesOf()(yield* Effect.provide(servedCapabilities(), demo.context));
  const records = yield* Effect.provide(makeThreadRecords, demo.context);
  const rows = yield* threadStore(records, ENTRY_KINDS).pipe(Effect.provide(demo.context));
  const row = yield* rows.insert({ ownerId: 'operator', agentId: 'tagma' });
  yield* scopeRecord(demo.graph.store.db, row.id, { projectId: demo.projectId });
  const under: ThreadRecord = {
    id: row.id,
    projectId: demo.projectId,
    principal: row.ownerId,
    agentId: row.agentId,
    typeId: null,
    name: row.name,
    spawnRootId: row.spawnRootId,
    parentThreadId: null,
    spawnedByRunId: null,
    bornOf: null,
    createdBy: null,
    harness: NATIVE_HARNESS,
    host: null,
    authority: row.authority,
    plain: false,
    budgetTokens: null,
    capabilities: NATIVE_CAPABILITIES(),
    model: null,
    profile: null,
  };
  const catalog = yield* declaredAgents({
    harnesses: Effect.succeed(harnesses),
    storePath: join(home, 'tagma.sqlite'),
    files,
    packages,
  }).pipe(Effect.provideService(NativeAgents, agents), Effect.provideService(ThreadRecords, records), Effect.provide(demo.context));
  const write = (floor: string, name: string, frontmatter: string, body = 'Do the thing.') =>
    fs.writeFileString(join(floor, `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`);
  const offer = Effect.fnUntraced(function* (entries: readonly { type: string; to: 'operator' | 'agents' }[]) {
    yield* Effect.provide(
      demo.graph.settings.write({ scope: 'project', projectId: demo.projectId, key: agentsOffered().id, value: entries }),
      demo.context,
    );
  });
  return {
    demo,
    personal,
    project,
    write,
    offer,
    resolve: (typeId: string, caller: ThreadTypeCaller = 'agent') => catalog.resolve({ caller, under, typeId }),
    offered: (caller: ThreadTypeCaller = 'agent') => catalog.offered({ caller, under }),
    offeredIn: (caller: ThreadTypeCaller = 'agent') => catalog.offeredIn({ projectId: demo.projectId, caller }),
    files: () => catalog.filesOf(demo.projectId),
  };
});

it.live(
  'a file standing alone is an agent with its own prompt and set, born as the declared base',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(
      stand.project,
      'funny-stories',
      'description: Writes a funny story on a theme\ncapabilities: []',
      'You write one funny story per message, and nothing else.',
    );
    expect(yield* stand.resolve('funny-stories', 'operator')).toEqual({
      baseAgentId: DECLARED_BASE_ID(),
      profile: {
        id: 'funny-stories',
        baseAgentId: DECLARED_BASE_ID(),
        description: 'Writes a funny story on a theme',
        prompt: 'You write one funny story per message, and nothing else.',
        capabilities: [],
        runtimeSources: [],
      },
      harness: NATIVE_HARNESS,
      capabilities: NATIVE_CAPABILITIES(),
    });
    expect((yield* stand.offered('operator')).map((type) => type.id)).toEqual(['tagma', 'code', 'funny-stories']);
  }),
);

it.live(
  'a file extending a built-in appends its body and narrows the set; the planes follow the set',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(
      stand.project,
      'code-isolated',
      'description: Codes and nothing else\nextends: code\ncapabilities: [files, shell, skills, peers]',
      'Never reach for the web.',
    );
    expect(yield* stand.resolve('code-isolated', 'operator')).toEqual({
      baseAgentId: 'code',
      profile: {
        id: 'code-isolated',
        baseAgentId: 'code',
        description: 'Codes and nothing else',
        instructions: 'Never reach for the web.',
        capabilities: ['files', 'shell', 'skills', 'peers'],
        runtimeSources: ['collaboration'],
      },
      harness: NATIVE_HARNESS,
      capabilities: NATIVE_CAPABILITIES(),
    });
  }),
);

it.live(
  'a personal file shadows a project one of the same name, and the shadowed file is named',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(stand.personal, 'reviewer', 'description: mine\nextends: code');
    yield* stand.write(stand.project, 'reviewer', 'description: ours\nextends: code');
    expect(yield* stand.resolve('reviewer', 'operator')).toMatchObject({ profile: { description: 'mine' } });
    const found = yield* stand.files();
    expect(found.rejected).toEqual([
      { path: join(stand.project, 'reviewer.md'), reason: `shadowed by ${join(stand.personal, 'reviewer.md')}` },
    ]);
  }),
);

it.live(
  'a registered agent is offered to agents with no setting written; the declared base to nobody by name',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    expect(yield* stand.resolve('code')).toEqual({ baseAgentId: 'code', harness: NATIVE_HARNESS, capabilities: NATIVE_CAPABILITIES() });
    expect((yield* stand.offered()).map((type) => type.id)).toEqual(['tagma', 'code']);
    expect(yield* stand.resolve(DECLARED_BASE_ID(), 'operator')).toBeNull();
    expect((yield* stand.offered('operator')).map((type) => type.id)).not.toContain(DECLARED_BASE_ID());
  }),
);

it.live(
  'a project file agent stands in the operator menu and is withheld from agents until the setting opens it',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(stand.project, 'reviewer', 'description: Reads a change and reports.\nextends: code');
    expect(yield* stand.resolve('reviewer')).toHaveProperty('withheld');
    expect((yield* stand.offered()).map((type) => type.id)).toEqual(['tagma', 'code']);
    expect((yield* stand.offered('operator')).map((type) => type.id)).toContain('reviewer');
    yield* stand.offer([
      { type: 'reviewer', to: 'agents' },
      { type: 'code', to: 'operator' },
    ]);
    expect(yield* stand.resolve('reviewer')).toMatchObject({ baseAgentId: 'code' });
    expect(yield* stand.resolve('code')).toHaveProperty('withheld');
    expect((yield* stand.offered()).map((type) => type.id)).toEqual(['tagma', 'reviewer']);
    expect((yield* stand.offered('operator')).map((type) => type.id)).toEqual(['tagma', 'code', 'reviewer']);
  }),
);

it.live(
  "the operator's personal file agent is offered to agents with no setting written, until the setting withholds it",
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(stand.personal, 'scout', 'description: Looks around.\nextends: code');
    expect(yield* stand.resolve('scout')).toMatchObject({ baseAgentId: 'code', profile: { id: 'scout' } });
    expect((yield* stand.offered()).map((type) => type.id)).toEqual(['tagma', 'code', 'scout']);
    yield* stand.offer([{ type: 'scout', to: 'operator' }]);
    expect(yield* stand.resolve('scout')).toHaveProperty('withheld');
    expect((yield* stand.offered()).map((type) => type.id)).toEqual(['tagma', 'code']);
  }),
);

it.live(
  'an edited file shapes the next birth',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(stand.project, 'reviewer', 'description: first\nextends: code');
    expect(yield* stand.resolve('reviewer', 'operator')).toMatchObject({ profile: { description: 'first' } });
    yield* stand.write(stand.project, 'reviewer', 'description: second\nextends: code', 'Do as I say now.');
    expect(yield* stand.resolve('reviewer', 'operator')).toMatchObject({
      profile: { description: 'second', instructions: 'Do as I say now.' },
    });
  }),
);

it.live(
  'a file this server cannot run is rejected by name, with its reason',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    yield* stand.write(stand.project, 'ghost', 'description: Over an agent this server never had.\nextends: absent');
    yield* stand.write(stand.project, 'tagma', 'description: Shadowing the product.\nextends: code');
    yield* stand.write(stand.project, 'wide', 'description: A capability nobody has.\ncapabilities: [files, telepathy]');
    yield* stand.write(stand.project, 'bare', 'description: Neither alone nor extending.');
    yield* stand.write(stand.project, 'noprompt', 'description: x\ncapabilities: []', '');
    const found = yield* stand.files();
    expect(found.agents).toEqual([]);
    const reasons = Object.fromEntries(found.rejected.map((entry) => [entry.path.split('/').pop(), entry.reason]));
    expect(reasons['ghost.md']).toContain('extends absent');
    expect(reasons['tagma.md']).toContain('cannot shadow');
    expect(reasons['wide.md']).toContain('telepathy');
    expect(reasons['bare.md']).toContain('names its capabilities');
    expect(reasons['noprompt.md']).toContain('empty body');
    expect(yield* stand.resolve('ghost', 'operator')).toBeNull();
    expect((yield* stand.offered('operator')).map((type) => type.id)).toEqual(['tagma', 'code']);
  }),
);

it.live(
  "an enabled plugin's agent stands in the library with its tool list, is offered to the operator alone, and leaves once the plugin is disabled",
  Effect.fnUntraced(function* () {
    const reviewer: LoadedAgent = {
      name: 'demo-reviewer',
      file: '/plugins/demo/agents/reviewer.md',
      description: 'Reviews a change.',
      prompt: Effect.succeed('Review the diff.'),
      tools: ['read', 'grep'],
    };
    const plugin: PluginLoaded = {
      id: 'demo',
      revision: 'first',
      title: 'Demo',
      place: { root: '/plugins/demo', data: '/plugins/demo', options: {}, project: '/project' },
      redact: [],
      skills: [],
      commands: [],
      agents: [reviewer],
      servers: [],
      hooks: [],
    };
    const plugins = yield* enabledPlugins([plugin]);
    const stand = yield* world([], [yield* makePluginAgents().pipe(Effect.provideService(EnabledPlugins, plugins.service))]);
    expect((yield* stand.files()).agents.map((file) => [file.id, file.origin])).toEqual([['demo-reviewer', 'plugin']]);
    expect(yield* stand.resolve('demo-reviewer', 'operator')).toEqual({
      baseAgentId: DECLARED_BASE_ID(),
      profile: {
        id: 'demo-reviewer',
        baseAgentId: DECLARED_BASE_ID(),
        description: 'Reviews a change.',
        prompt: 'Review the diff.',
        tools: ['read', 'grep'],
      },
      harness: NATIVE_HARNESS,
      capabilities: NATIVE_CAPABILITIES(),
    });
    expect(yield* stand.resolve('demo-reviewer')).toHaveProperty('withheld');
    expect((yield* stand.offered('operator')).map((type) => type.id)).toEqual(['tagma', 'code', 'demo-reviewer']);
    yield* plugins.set(stand.demo.projectId, []);
    expect(yield* stand.resolve('demo-reviewer', 'operator')).toBeNull();
    expect((yield* stand.offered('operator')).map((type) => type.id)).toEqual(['tagma', 'code']);
  }),
);

it.live(
  'two package floors naming one id: the earlier floor wins in the library and at birth alike, and the later file is rejected naming it',
  Effect.fnUntraced(function* () {
    const fileOf = (origin: 'app' | 'plugin', path: string): AgentFile => ({
      id: 'demo-tools.reviewer',
      description: origin,
      extends: undefined,
      capabilities: [],
      tools: undefined,
      model: undefined,
      sections: undefined,
      body: 'Review.',
      path,
      directory: '/floors',
      origin,
      revision: origin,
      source: 'Review.',
    });
    const floor = (file: AgentFile): AgentPackages => ({
      agentsIn: () => Effect.succeed([file]),
      agentIn: (_, typeId) => Effect.succeed(typeId === file.id ? file : undefined),
    });
    const stand = yield* world([], [floor(fileOf('app', '/floors/app.md')), floor(fileOf('plugin', '/floors/plugin.md'))]);
    const found = yield* stand.files();
    expect(found.agents.map((file) => file.origin)).toEqual(['app']);
    expect(found.rejected).toEqual([{ path: '/floors/plugin.md', reason: 'shadowed by /floors/app.md' }]);
    expect(yield* stand.resolve('demo-tools.reviewer', 'operator')).toMatchObject({ profile: { description: 'app' } });
  }),
);

it.live(
  'a registered agent resolves with no overlay, and a name nobody holds resolves to nothing',
  Effect.fnUntraced(function* () {
    const stand = yield* world();
    expect(yield* stand.resolve('tagma')).toEqual({ baseAgentId: 'tagma', harness: NATIVE_HARNESS, capabilities: NATIVE_CAPABILITIES() });
    expect(yield* stand.resolve('researcher')).toBeNull();
  }),
);

it.live(
  'a harness type is offered per measured row, the base itself is no type, and a name outside the harness id grammar is no type',
  Effect.fnUntraced(function* () {
    const stand = yield* world([
      {
        harness: 'devin',
        presentation: harnessPresentation(builtinHarness('devin')),
        binary: '/usr/local/bin/devin',
        version: 'devin 1.4.0',
        unreadable: null,
        serves: null,
        searching: false,
        missing: null,
      },
      {
        harness: 'gemini',
        presentation: harnessPresentation(builtinHarness('gemini')),
        binary: null,
        version: null,
        unreadable: null,
        serves: null,
        searching: false,
        missing: null,
      },
      {
        harness: 'grok',
        presentation: harnessPresentation(declaredHarness(grok)!),
        binary: '/usr/local/bin/grok',
        version: null,
        unreadable: '--version exited 1',
        serves: null,
        searching: false,
        missing: null,
      },
    ]);
    const offered = yield* stand.offeredIn('operator');
    expect(offered.map((type) => type.id)).toEqual(['tagma', 'code', 'harness:devin', 'harness:gemini', 'harness:grok']);
    expect((yield* stand.offered()).map((type) => type.id)).toContain('harness:devin');
    expect(offered.find((type) => type.id === 'harness:devin')).toMatchObject({
      name: 'Devin',
      baseAgentId: HARNESS_AGENT_ID(),
      harness: { binary: '/usr/local/bin/devin', version: 'devin 1.4.0', unreadable: null, serves: null, searching: false, missing: null },
    });
    expect(offered.find((type) => type.id === 'harness:gemini')?.harness).toMatchObject({ binary: null, version: null });
    expect(offered.find((type) => type.id === 'harness:grok')?.harness).toMatchObject({
      binary: '/usr/local/bin/grok',
      version: null,
      unreadable: '--version exited 1',
    });
    expect(yield* stand.resolve('harness:devin')).toEqual({
      baseAgentId: HARNESS_AGENT_ID(),
      harness: 'devin',
      capabilities: EXTERNAL_CAPABILITIES(),
    });
    expect(yield* stand.resolve(HARNESS_AGENT_ID(), 'operator')).toBeNull();
    expect(yield* stand.resolve('harness:No Such CLI', 'operator')).toBeNull();
    expect(offered.map((type) => type.id)).not.toContain(HARNESS_AGENT_ID());
  }),
);

it.live(
  'a harness with no binary is still a name the birth resolves',
  Effect.fnUntraced(function* () {
    const stand = yield* world([
      {
        harness: 'gemini',
        presentation: harnessPresentation(builtinHarness('gemini')),
        binary: null,
        version: null,
        unreadable: null,
        serves: null,
        searching: false,
        missing: null,
      },
    ]);
    expect(yield* stand.resolve('harness:gemini')).toEqual({
      baseAgentId: HARNESS_AGENT_ID(),
      harness: 'gemini',
      capabilities: EXTERNAL_CAPABILITIES(),
    });
  }),
);

function agent(id: string): ThreadAgent {
  const unused = () => Effect.die('the declared-agent fixture never starts an agent');
  return {
    id,
    name: id,
    description: `The ${id} agent.`,
    grant: { sources: [] },
    runPolicy: { userStartable: true, backgroundStartable: true },
    prepare: unused,
    instructions: unused,
    toolCatalog: unused,
    toolDoor: unused,
  };
}
