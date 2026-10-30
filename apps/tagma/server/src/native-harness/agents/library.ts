import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { gitMode } from '@runlith/agent-tools/changes/measure';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import { withFileWriteLock } from '@runlith/agent-tools/workspace/runtime';
import { rootCollaborationPrompt } from '@runlith/agent/collaboration/CollaborationVoice';
import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { WorkspaceInputs, type WorkspaceInputSet } from '../contract/service/inputs.js';
import { skillPool } from '../skills/pool.js';
import { instructionsTold, instructionSnapshot } from '../turns/instructions.js';
import { ThreadGraphs } from '../contract/service/graphs.js';
import { CapabilityOffers } from '../contract/service/execution.js';
import { approves, defaultType } from '../../threads/contract/wire/settings.js';
import { gateProject } from '../../threads/projectGate.js';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { agentOf } from '@runlith/agent/thread/rows';
import { threadPrompt } from '@runlith/agent/thread/agents/threadPrompt';
import { Clock, Context, Effect, FileSystem, Option, Result, Schema } from 'effect';
import { Orientation } from '../../graph/contract/service/orientation.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Doctrine } from '../../platform/contract/service/sections.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { DoctrineFacts } from '../../platform/contract/service/facts.js';
import { turnFacts } from '../turns/facts.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { autoCommit, checkoutMode, commentPolicy } from '../../graph/settings.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { agentNameSchema, type AgentDefinition, type AgentFrontmatter } from '../../threads/contract/wire/agentLibrary.js';
import type { AgentLibrary } from '../../threads/contract/service/library.js';
import type { AgentSkills, NativeAgentDefinitions } from '../contract/service/agents.js';
import type { ThreadStore } from '../rows/threadRow.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { CapabilityDefinitions } from '../capabilities/definitions.js';
import type { AgentDeclaration } from './declaration.js';
import { agentPrompt, canLoadSkills, instructionAudience } from './effectiveAgent.js';
import { parseAgentFile } from './declared/files.js';
import type { AgentFile } from '../../threads/contract/wire/agentLibrary.js';
import { DECLARED_BASE_ID } from './declared/base.js';
import { MachineWorld } from '../../executions/contract/service/worlds.js';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { definitionFacts, definitionToolCatalog } from './toolCatalog.js';
import { commandDescription } from '../contract/wire/settings.js';
import type { DeclaredAgents } from '../../threads/library/declared.js';
import { namable, profileOf } from './declared/agentFiles.js';
import { toolChars } from '@runlith/agent/thread/composition/entry';
import { renderWorldState } from '@runlith/agent/WorldState';
import { deferredToolsSection } from '@runlith/agent/AgentDeferredTools';
import type { StartCosts, StartPricing } from '../../platform/contract/service/start.js';
import type { StartMoves, StartPrice } from '../../platform/contract/wire/start.js';
import type { Capability } from '../capabilities/contract.js';
import { inventoryChars, startCost } from './start.js';
import { capabilityInventory } from '../capabilities/inventory.js';

const unmeasured = (failure: unknown): string =>
  failure instanceof GateRefusal ? `${failure.code}: ${failure.reason}` : failure instanceof Error ? failure.message : String(failure);

type ParsedFile = Omit<AgentFile, 'path' | 'directory' | 'origin'>;
const decodeName = Schema.decodeUnknownResult(agentNameSchema);
function frontmatter(file: ParsedFile): AgentFrontmatter {
  return {
    description: file.description,
    extends: file.extends,
    capabilities: file.capabilities,
    tools: file.tools,
    model: file.model,
    sections: file.sections,
  };
}

function fileDefinition(file: AgentFile): AgentDefinition {
  return {
    id: file.id,
    name: file.id,
    description: file.description,
    origin: { scope: file.origin, path: file.path, revision: file.revision },
    config: frontmatter(file),
    body: file.body,
    source: file.source,
    editable: file.origin === 'project' || file.origin === 'personal',
  };
}

function builtinDefinition(declaration: AgentDeclaration, capabilities: readonly string[]): AgentDefinition {
  return {
    id: declaration.id,
    name: declaration.name,
    description: declaration.description,
    origin: { scope: 'builtin', path: null, revision: null },
    config: { description: declaration.description, capabilities },
    body: declaration.identity,
    source: declaration.identity,
    editable: false,
  };
}

const io = <A, E, R>(work: Effect.Effect<A, E, R>, path: string) =>
  work.pipe(
    Effect.mapError(
      (cause) =>
        new GateRefusal('agent-file-io', `${path}: ${String(cause)}`, ['Check the file permissions and read the agent library again.']),
    ),
  );

export type AgentLibraryInput = {
  readonly types: DeclaredAgents;
  readonly declarations: readonly AgentDeclaration[];
  readonly store: ThreadStore;
  readonly capabilities: CapabilityDefinitions;
};

export const agentLibrary = Effect.fn('AgentLibrary.make')(function* ({ types, declarations, store, capabilities }: AgentLibraryInput) {
  const threads = yield* ThreadLookup;
  const records = yield* ThreadRecords;
  const sourceCache = yield* WorkspaceInputs;
  const artifacts = yield* ArtifactStore;
  const graphs = yield* ThreadGraphs;
  const capabilityOffers = yield* CapabilityOffers;
  const machine = yield* MachineWorld;
  const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer));
  const projects = yield* Projects;
  const settings = yield* Settings;
  const providers = yield* ProviderRegistry;
  const sections = (yield* Doctrine)?.contributed ?? null;
  const factsOption = yield* Effect.serviceOption(DoctrineFacts);
  const factsOf = turnFacts(factsOption._tag === 'Some' ? factsOption.value : null, sections);
  const registered = new Map(declarations.map((entry) => [entry.id, entry]));
  const held = (declaration: AgentDeclaration): readonly string[] =>
    capabilities.effective(declaration).declared.map((capability) => capability.id);

  const parsed = Effect.fnUntraced(function* (name: string, source: string) {
    const file = parseAgentFile(name, source, namable(capabilities));
    if ('reason' in file)
      return yield* new GateRefusal('agent-invalid', file.reason, ['Correct the definition’s frontmatter or instructions.']);
    const reason = types.validate(file);
    if (reason !== undefined)
      return yield* new GateRefusal('agent-invalid', reason, ['Use a new name and extend a built-in agent offered by this server.']);
    return file;
  });

  const list: AgentLibrary['Service']['list'] = Effect.fnUntraced(function* (projectId) {
    const found = yield* types.filesOf(projectId);
    const floors = yield* types.directoriesOf(projectId);
    const comments = yield* settings.value(commentPolicy, projectId);
    return {
      definitions: [
        ...declarations.filter((entry) => entry.id !== DECLARED_BASE_ID).map((entry) => builtinDefinition(entry, held(entry))),
        ...found.agents.map(fileDefinition),
      ].map(({ id, name, description, origin, config, editable }) => ({ id, name, description, origin, config, editable })),
      rejected: found.rejected,
      floors: { project: floors[0], personal: floors[1] },
      capabilities: capabilities.list().map((capability) => ({
        id: capability.id,
        description: capability.description,
        tools: capabilityInventory(capability, capabilityOffers, definitionFacts(comments)).tools.map(({ name, description }) => ({
          name,
          description,
        })),
        runtimeSources: capability.runtimeSources ?? [],
      })),
    };
  });

  const skills: AgentSkills['Service']['list'] = Effect.fnUntraced(function* (projectId, aim) {
    let baseId: string;
    let overlay: AgentProfile | undefined;
    let resolved: WorkspaceInputSet | undefined;
    let basis: 'thread' | 'next-turn' = 'next-turn';
    if (aim.kind === 'thread') {
      yield* gateProject(records, aim.id, projectId);
      const row = yield* store.metadata(aim.id);
      if (!row) return yield* Effect.fail(new ThreadNotFoundError(aim.id));
      baseId = agentOf(row);
      overlay = row.profile?.overlay;
    } else {
      const typeId = aim.type ?? (yield* settings.value(defaultType, projectId));
      const offer = yield* types.resolveIn({ projectId, caller: 'operator', typeId });
      if (!offer || 'withheld' in offer)
        return yield* new GateRefusal('unknown-type', `No agent is offered here as ${typeId}.`, ['Choose a type this project offers.']);
      baseId = offer.baseAgentId;
      overlay = offer.profile;
    }
    const base = registered.get(baseId);
    if (!base)
      return yield* new GateRefusal('agent-not-found', `Agent ${baseId} is not registered.`, ['Choose an agent available on this server.']);
    if (!canLoadSkills(capabilities.effective(base, overlay), overlay))
      return { skills: [], basis, available: false, note: 'This agent does not offer load_skill.' };
    const project = yield* projects.byId(projectId);
    if (aim.kind === 'thread') {
      const current = yield* threads.summary(aim.id);
      if (!current) return yield* Effect.fail(new ThreadNotFoundError(aim.id));
      const runId = current.activeRun?.id;
      const snapshot = runId === undefined ? undefined : yield* sourceCache.snapshot(aim.id, runId);
      if (snapshot) {
        resolved = snapshot;
        basis = 'thread';
      } else resolved = yield* sourceCache.preview({ threadId: aim.id, projectId, root: project.rootPath });
    }
    const sources = resolved ?? (yield* sourceCache.walk(projectId, project.rootPath));
    const skills = skillPool(artifacts, sources);
    const brought = new Map(sources.inventory.flatMap((entry) => (entry.plugin === null ? [] : [[entry.name, entry.plugin] as const])));
    return {
      skills: skills.map((skill) => ({ id: skill.id, description: skill.description, plugin: brought.get(skill.id) ?? null })),
      basis,
      available: skills.length > 0,
      note: basis === 'thread' ? 'Skills from this thread’s resolved sources. Reloaded sources apply to its next turn.' : null,
    };
  });

  const preview: AgentLibrary['Service']['preview'] = Effect.fnUntraced(function* (projectId, input) {
    let definition: AgentDefinition;
    let file: AgentFile | undefined;
    if (input.source !== undefined) {
      const draft = yield* parsed(input.id ?? 'new-agent', input.source);
      const floors = yield* types.directoriesOf(projectId);
      file = { ...draft, directory: floors[0], origin: 'project', path: join(floors[0], `${draft.id}.md`) };
      definition = fileDefinition(file);
    } else {
      const builtin = input.id === DECLARED_BASE_ID ? undefined : registered.get(input.id ?? '');
      if (builtin !== undefined) definition = builtinDefinition(builtin, held(builtin));
      else {
        file = (yield* types.filesOf(projectId)).agents.find((entry) => entry.id === input.id);
        if (file === undefined)
          return yield* new GateRefusal('agent-not-found', `No definition named ${input.id ?? '(none)'} stands in this project.`, [
            'Read the agent library and name one of its definitions.',
          ]);
        definition = fileDefinition(file);
      }
    }
    const overlay = file === undefined ? undefined : profileOf(capabilities, file);
    const base = registered.get(file === undefined ? definition.id : (file.extends ?? DECLARED_BASE_ID))!;
    const composition = yield* composed(projectId, base, overlay);
    const { document, addition, sources } = composition;
    return {
      instructions: composition.instructions,
      instructionBasis: 'current',
      definition,
      toolCatalog: composition.catalog.wire,
      start: composition.cost,
      prompt: {
        text: composition.text,
        sections: [
          ...document.sections,
          ...(addition
            ? [{ id: 'overlay', title: 'Additional instructions', source: definition.origin.path ?? definition.id, text: addition }]
            : []),
          ...sources.map((text) => ({
            id: 'collaboration-source',
            title: 'Collaboration',
            source: 'Kernel · collaboration source',
            text,
          })),
        ],
      },
      capabilities: composition.selected.map((capability) => capability.id),
      context: composition.context,
      frozen: false,
      notes: [
        'Preview for a new root thread in this project’s checkout. No thread, guest or MCP connection was started.',
        'toolCatalog sizes provider-neutral JSON input schemas in characters; atBirth sources resolve for the thread, model, skills and connections at birth.',
        'start counts what this definition composes; its tools leave out the atBirth sources, and the workspace note is composed only for a thread.',
      ],
    };
  });

  const composed = Effect.fnUntraced(function* (projectId: number, base: AgentDeclaration, overlay: AgentProfile | undefined) {
    const project = yield* projects.byId(projectId);
    const effective = capabilities.effective(base, overlay);
    const selected = effective.held;
    const context = {
      project: project.name,
      world: { root: project.rootPath, platform: process.platform, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' },
    };
    const served = yield* graphs.graphFor(projectId);
    const disabled = new Set<string>();
    for (const capability of selected) {
      if (capability.enabledBy !== undefined && !(yield* settings.value(capability.enabledBy, projectId))) disabled.add(capability.id);
    }
    const edited = agentPrompt(
      base.id,
      effective,
      (capability) => !disabled.has(capability.id),
      capabilityOffers,
      definitionFacts(yield* settings.value(commentPolicy, projectId)),
      {
        checkout: yield* settings.value(checkoutMode, projectId),
        autoCommit: yield* settings.value(autoCommit, projectId),
        comments: yield* settings.value(commentPolicy, projectId),
        facts: yield* factsOf({ projectId, root: project.rootPath }),
        graphOverCode: (yield* Context.get(served, Tags).of(projectId)).bindsCode(),
        contributed: sections,
        world: context.world,
      },
      overlay,
    );
    if (Result.isFailure(edited)) return yield* edited.failure;
    const document = edited.success;
    const sources = effective.sources.includes('collaboration')
      ? [
          rootCollaborationPrompt((yield* providers.catalog).models, yield* types.offeredIn({ projectId, caller: 'agent' }), {
            summarizerChoice: true,
            approves: yield* settings.value(approves, projectId),
          }),
        ]
      : [];
    const addition = overlay?.instructions?.trim();
    const { instructions, graph } = yield* orientationParts(projectId, served, selected, 'all');
    const catalog = definitionToolCatalog({
      declaration: base,
      effective,
      overlay,
      offers: capabilityOffers,
      workspace: selected.some((capability) => capability.workspaceTools !== undefined)
        ? createTools({
            cwd: project.rootPath,
            world: machine.world,
            commandTimes: unruledTimes,
            searchMs: LONGEST_ACT_MS,
            commandDescription: yield* settings.value(commandDescription, projectId),
          })
        : {},
      comments: yield* settings.value(commentPolicy, projectId),
    });
    const inventory = yield* renderWorldState([deferredToolsSection(catalog.resolved)], {});
    const text = threadPrompt(document.text, addition, sources).trim();
    const cost = startCost({
      system: text.length,
      tools: toolChars(catalog.resolved),
      instructions,
      notes: {
        workspace: null,
        graph: graph === null ? null : graph.length,
        deferred: inventory.kind === 'changed' ? inventoryChars(inventory.content) : 0,
      },
    });
    return { selected, context, document, sources, addition, instructions, catalog, text, cost };
  });

  const priced: StartCosts['Service']['priced'] = Effect.fnUntraced(function* <A, E, R>(
    pricing: StartPricing,
    write: Effect.Effect<A, E, R>,
  ) {
    const { projectId, moves } = pricing;
    const before = yield* Effect.result(
      Effect.gen(function* () {
        const one = yield* defaultAgent(projectId);
        return { one, chars: yield* movedChars(projectId, one, moves) };
      }),
    );
    const done = yield* write;
    if (Result.isFailure(before)) return [done, { unmeasured: unmeasured(before.failure) }] as const;
    const { one } = before.success;
    const measured = yield* Effect.result(
      Effect.gen(function* () {
        const delta = (yield* movedChars(projectId, one, moves)) - before.success.chars;
        if (pricing.quiet && delta === 0) return undefined;
        return { agent: one.agent, chars: (yield* composed(projectId, one.base, one.overlay)).cost.chars, delta };
      }),
    );
    const price: StartPrice | undefined = Result.isFailure(measured) ? { unmeasured: unmeasured(measured.failure) } : measured.success;
    return [done, price] as const;
  });

  type DefaultAgent = { readonly agent: string; readonly base: AgentDeclaration; readonly overlay: AgentProfile | undefined };

  const defaultAgent = Effect.fnUntraced(function* (projectId: number) {
    const typeId = yield* settings.value(defaultType, projectId);
    const offer = yield* types.resolveIn({ projectId, caller: 'operator', typeId });
    if (!offer || 'withheld' in offer)
      return yield* new GateRefusal('unknown-type', `No agent is offered here as ${typeId}.`, ['Choose a type this project offers.']);
    const base = registered.get(offer.baseAgentId);
    if (base === undefined)
      return yield* new GateRefusal('agent-not-found', `Agent ${offer.baseAgentId} is not registered.`, [
        'Choose an agent available on this server.',
      ]);
    return { agent: typeId, base, overlay: offer.profile } satisfies DefaultAgent;
  });

  const movedChars = Effect.fnUntraced(function* (projectId: number, one: DefaultAgent, moves: StartMoves) {
    const parts = yield* orientationParts(
      projectId,
      yield* graphs.graphFor(projectId),
      capabilities.effective(one.base, one.overlay).held,
      moves,
    );
    return startCost({
      system: 0,
      tools: [],
      instructions: parts.instructions,
      notes: { workspace: null, graph: parts.graph === null ? null : parts.graph.length, deferred: null },
    }).chars;
  });

  const orientationParts = Effect.fnUntraced(function* (
    projectId: number,
    served: Effect.Success<ReturnType<typeof graphs.graphFor>>,
    selected: readonly Capability[],
    moves: StartMoves | 'all',
  ) {
    const orientation = Context.get(served, Orientation);
    const instructions =
      moves === 'graph'
        ? null
        : yield* orientation.instructions({ projectId, audience: instructionAudience(selected) }).pipe(Effect.provide(served));
    const graph =
      moves !== 'law' && instructionAudience(selected) === 'graph'
        ? yield* orientation.render({ projectId }).pipe(Effect.provide(served))
        : null;
    return { instructions, graph };
  });

  const instructions: NativeAgentDefinitions['Service']['instructions'] = Effect.fnUntraced(function* (projectId, threadId, graph) {
    yield* gateProject(records, threadId, projectId);
    const row = yield* store.metadata(threadId);
    if (row === undefined) return yield* Effect.fail(new ThreadNotFoundError(threadId));
    const definition = row.pendingDefinition ?? { agentId: agentOf(row), profile: row.profile };
    const agentId = definition.agentId;
    const base = registered.get(agentId);
    if (base === undefined) {
      return yield* new GateRefusal(
        'agent-not-found',
        `Agent ${agentId} is not registered on this server, so its instructions are not resolved here.`,
        ['read the thread’s saved prompt with read_thread_agent'],
      );
    }
    const selected = capabilities.effective(base, definition.profile?.overlay).held;
    const served = (yield* graphs.graphAt(graph)).context;
    const told = yield* store.toldTailOf(threadId, instructionsTold(projectId));
    const delivered = instructionSnapshot(told ?? [], projectId) ?? null;
    const current = yield* Context.get(served, Orientation)
      .instructions({ projectId, audience: instructionAudience(selected) })
      .pipe(Effect.provide(served));
    return { delivered, current };
  });

  const thread: NativeAgentDefinitions['Service']['thread'] = Effect.fnUntraced(function* (projectId, threadId) {
    yield* gateProject(records, threadId, projectId);
    const row = yield* store.metadata(threadId);
    if (row === undefined) return yield* Effect.fail(new ThreadNotFoundError(threadId));
    const prompt = yield* store.systemPromptOf(threadId);
    const project = yield* projects.byId(projectId);
    const agentId = agentOf(row);
    const base = registered.get(agentId);
    const overlay = row.profile?.overlay;
    const id = row.profile?.id ?? agentId;
    const config: AgentFrontmatter = {
      extends: overlay?.instructions === undefined ? undefined : agentId,
      capabilities: overlay?.capabilities === undefined ? undefined : overlay.capabilities,
      tools: overlay?.tools === undefined ? undefined : overlay.tools,
      model: overlay?.model === undefined ? undefined : overlay.model,
      sections: overlay?.sections,
    };
    const body = overlay?.prompt ?? overlay?.instructions ?? '';
    const text = prompt?.systemPrompt ?? '';
    const told = yield* store.toldTailOf(threadId, instructionsTold(projectId));
    const delivered = instructionSnapshot(told ?? [], projectId);
    return {
      instructions: delivered ?? null,
      instructionBasis: delivered === undefined ? 'unavailable' : 'delivered',
      definition: {
        id,
        name: id,
        description: overlay?.description ?? '',
        origin: { scope: 'thread', path: null, revision: null },
        body,
        config,
        source: overlay === undefined ? '' : `---\n${JSON.stringify(config, null, 2)}\n---\n${body}`,
        editable: false,
      },
      prompt: { text, sections: text ? [{ id: 'frozen', title: 'Saved system prompt', source: `Thread ${threadId}`, text }] : [] },
      toolCatalog: null,
      start: null,
      capabilities: overlay?.capabilities ?? [],
      context: { project: project.name, world: null },
      frozen: true,
      notes: [
        text
          ? 'These are the exact saved bytes, not a reconstruction from current definitions.'
          : 'This thread has no frozen prompt yet. Reading it does not start a run.',
        'The saved prompt remains readable in full. Its provider-neutral tool schemas, section provenance and world facts are not separately retained.',
        ...(!overlay ? ['This built-in thread retained no declaration overlay; today’s definition is deliberately not substituted.'] : []),
        ...(base === undefined ? ['The original base agent is no longer registered. Its saved prompt is still shown.'] : []),
      ],
    };
  });

  const destination: NativeAgentDefinitions['Service']['destination'] = Effect.fnUntraced(function* (projectId, name, scope) {
    if (decodeName(name)._tag === 'Failure')
      return yield* new GateRefusal('agent-name', 'An agent name is a filename, without directory separators or control characters.', [
        'Choose a filename without a path.',
      ]);
    const directories = yield* types.directoriesOf(projectId);
    return join(directories[scope === 'project' ? 0 : 1], `${name}.md`);
  });

  const save: NativeAgentDefinitions['Service']['save'] = Effect.fnUntraced(function* (projectId, input, changes) {
    const path = yield* destination(projectId, input.name, input.scope);
    const file = yield* parsed(input.name, input.source);
    const directory = dirname(path);
    const saving = withFileWriteLock(
      directory,
      path,
      Effect.gen(function* () {
        yield* io(fs.makeDirectory(directory, { recursive: true }), directory);
        const canonical = yield* io(fs.realPath(directory), directory);
        const parent = yield* io(fs.realPath(dirname(directory)), dirname(directory));
        if (canonical !== resolve(parent, relative(dirname(directory), directory))) {
          return yield* new GateRefusal(
            'agent-path',
            'The declaration directory is a symbolic link; the library will not write through it.',
            ['Edit the intended file directly or use a real declaration directory.'],
          );
        }
        const target = yield* fs.realPath(path).pipe(Effect.option);
        if (Option.isSome(target) && target.value !== join(canonical, `${input.name}.md`)) {
          return yield* new GateRefusal('agent-path', 'The declaration is a symbolic link; the library will not replace its target.', [
            'Edit the intended file directly.',
          ]);
        }
        const previous = yield* io(
          fs.readFileString(path).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null))),
          path,
        );
        const revision = previous === null ? null : createHash('sha256').update(previous).digest('hex');
        if (revision !== input.revision)
          return yield* new GateRefusal(
            'agent-changed',
            previous === null ? 'The definition was removed.' : 'The definition changed since it was read, or this name already exists.',
            ['Reload the definition and keep your draft before reconciling the change.'],
          );
        const permissions = previous === null ? undefined : (yield* io(fs.stat(path), path)).mode;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const temporary = yield* io(fs.makeTempFileScoped({ directory, suffix: '.pending' }), directory);
            yield* io(fs.writeFileString(temporary, input.source), temporary);
            if (permissions !== undefined) yield* io(fs.chmod(temporary, permissions), temporary);
            const mode = gitMode((yield* io(fs.stat(temporary), temporary)).mode);
            const placed = Effect.as(
              input.revision === null ? io(fs.link(temporary, path), path) : io(fs.rename(temporary, path), path),
              true,
            );
            if (changes === undefined) {
              yield* placed;
              return;
            }
            const hunk = workspaceChangeHunk(previous ?? '', input.source);
            yield* io(
              changes.land(
                [
                  {
                    origin: 'write',
                    path,
                    at: new Date(yield* Clock.currentTimeMillis),
                    mode,
                    hunk,
                    before: contentDigest(previous ?? ''),
                    after: contentDigest(input.source),
                  },
                ],
                placed,
              ),
              path,
            );
          }),
        );
        return fileDefinition({ ...file, path, directory, origin: input.scope });
      }),
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.catchTag('PlatformError', (cause) =>
        Effect.fail(
          new GateRefusal('agent-file-io', `${directory}: ${cause.message}`, ['Read the agent library again and save once more.']),
        ),
      ),
    );
    if (changes?.turn === undefined) return yield* saving;
    return yield* changes
      .turn([path], saving)
      .pipe(
        Effect.catchTag('IntakeRefused', (cause) =>
          Effect.fail(
            new GateRefusal('agent-file-io', `${cause.path}: ${cause.reason}`, ['Read the agent library again and save once more.']),
          ),
        ),
      );
  });

  return { list, preview, priced, thread, instructions, destination, save, skills };
});
