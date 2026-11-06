import { join } from 'node:path';
import { ThreadCallBroke, type ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { AgentRegistry } from '@runlith/agent/thread/agents/AgentRegistry';
import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import { NATIVE_HARNESS, type ThreadRecord } from '@runlith/agent/thread/record';
import type { ThreadSpawnType, ThreadTypeCaller } from '@runlith/agent/thread/agents/ThreadTypeCatalog';
import {
  type ThreadTypeOffer,
  type ThreadTypes,
  type ThreadTypesFailure,
  ThreadTypesUnavailable,
  type ThreadTypeWithheld,
} from '@runlith/agent/collaboration/types';
import { Effect } from 'effect';
import { NativeAgents } from '../contract/service/engine.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { storageHomes } from '../../graph/storage/layout.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Settings } from '../../settings/contract/service/values.js';
import type { HarnessInstall } from '../contract/wire/harness/externalSession.js';
import { agentsOffered, type OfferAudience } from '../contract/wire/settings.js';
import { stored } from '../../platform/store/crossing.js';
import { HARNESS_AGENT_ID } from '../contract/wire/harness/names.js';
import { harnessOfTypeId, harnessSpawnTypes } from '../contract/wire/harness/types.js';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { HARNESS_OFFER } from '../contract/wire/harness/seat.js';
import type { ThreadTypeOffers } from './types.js';
import type { AgentFiles, AgentPackages, OfferedType } from '../contract/service/library.js';
import type { AgentFile } from '../contract/wire/agentLibrary.js';

export const PROJECT_AGENTS_DIRECTORY = '.agents';
export const PERSONAL_AGENTS_DIRECTORY = 'agents';

export type DeclaredAgents = ThreadTypes['Service'] &
  ThreadTypeOffers & {
    directoriesOf(projectId: number): Effect.Effect<readonly [string, string], ThreadBorderFailed>;
    validate(file: Pick<AgentFile, 'id' | 'extends'>): string | undefined;
    filesOf(
      projectId: number,
    ): Effect.Effect<
      { readonly agents: readonly AgentFile[]; readonly rejected: readonly { path: string; reason: string }[] },
      ThreadBorderFailed
    >;
  };

export const makeDeclaredAgents = Effect.fnUntraced(function* ({
  harnesses,
  storePath,
  files,
  packages,
}: {
  readonly harnesses: Effect.Effect<readonly HarnessInstall[]>;
  readonly storePath: string;
  readonly files: AgentFiles;
  readonly packages: readonly AgentPackages[];
}) {
  const agents = yield* NativeAgents;
  const projects = yield* Projects;
  const settings = yield* Settings;
  const { projectOf } = yield* ThreadRecords;
  const { appHome } = storageHomes(storePath);
  const bases = new Set<string>([files.baseId, HARNESS_AGENT_ID]);
  const namable = () => agents.list().filter((agent) => !bases.has(agent.id));
  const packagedIn = (projectId: number): Effect.Effect<readonly AgentFile[], ThreadBorderFailed> =>
    Effect.map(
      Effect.forEach(packages, (floor) => floor.agentsIn(projectId)),
      (floors) => floors.flat(),
    );
  const packagedNamed = Effect.fnUntraced(function* (projectId: number, typeId: string) {
    for (const floor of packages) {
      const file = yield* floor.agentIn(projectId, typeId);
      if (file !== undefined) return file;
    }
    return undefined;
  });

  const floorsOf = (projectId: number): Effect.Effect<readonly [string, string], ThreadCallBroke> =>
    projects.byId(projectId).pipe(
      Effect.map((project) => [join(project.rootPath, PROJECT_AGENTS_DIRECTORY), join(appHome, PERSONAL_AGENTS_DIRECTORY)] as const),
      Effect.mapError((cause) => new ThreadCallBroke({ cause })),
    );

  const validate: DeclaredAgents['validate'] = (file) => {
    if (file.extends !== undefined && (agents.find(file.extends) === undefined || file.extends === files.baseId)) {
      return `extends ${file.extends}, which is no agent of this server: extends one of ${namable()
        .map((agent) => agent.id)
        .join(', ')}`;
    }
    if (agents.find(file.id) !== undefined) return `${file.id} is an agent of this server; a file cannot shadow it`;
    if (harnessOfTypeId(file.id) !== null) return `${file.id} is a harness of this server; a file cannot shadow it`;
    return undefined;
  };

  const filesOf: DeclaredAgents['filesOf'] = Effect.fnUntraced(function* (projectId) {
    const [project, personal] = yield* floorsOf(projectId);
    const found = yield* files
      .discover([
        { directory: project, origin: 'project' },
        { directory: personal, origin: 'personal' },
      ])
      .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    const packaged = yield* packagedIn(projectId);
    const shadowing = new Map<string, string>();
    for (const file of packaged) if (!shadowing.has(file.id)) shadowing.set(file.id, file.path);
    const agents: AgentFile[] = [];
    const rejected = [...found.rejected];
    for (const file of [...found.agents, ...packaged]) {
      const shadowed = shadowing.get(file.id);
      const reason = shadowed !== undefined && shadowed !== file.path ? `shadowed by ${shadowed}` : validate(file);
      if (reason !== undefined) {
        rejected.push({ path: file.path, reason });
        continue;
      }
      agents.push(file);
    }
    return { agents, rejected };
  });

  const judgeOf = (caller: ThreadTypeCaller, projectId: number): Effect.Effect<Judge, ThreadBorderFailed> =>
    caller === 'operator'
      ? Effect.succeed(OFFERED)
      : Effect.map(settings.read(agentsOffered, projectId).pipe(stored('agentsOffered')), (resolved) => (typeId, standing) => {
          const declared = resolved.value.findLast((entry) => entry.type === typeId);
          return (declared?.to ?? standing.to) === 'agents' ? null : withheld(typeId, standing, declared !== undefined);
        });

  const offerTo = <A extends ThreadTypeOffer>(
    caller: ThreadTypeCaller,
    projectId: number,
    typeId: string,
    standing: Standing,
    offer: () => A,
  ): Effect.Effect<A | ThreadTypeWithheld, ThreadBorderFailed> =>
    Effect.map(judgeOf(caller, projectId), (judge) => judge(typeId, standing) ?? offer());

  const projectUnder = (under: ThreadRecord): Effect.Effect<number | undefined, ThreadBorderFailed> =>
    projectOf(under.id).pipe(stored('projectOf'));

  const spawnTypeOf = (file: AgentFile): ThreadSpawnType => ({
    id: file.id,
    name: file.id,
    description: file.description,
    baseAgentId: file.extends ?? files.baseId,
  });

  const harnessType = (typeId: string): boolean => harnessOfTypeId(typeId) !== null;

  const harnessOffer = (typeId: string): ThreadTypeOffer => ({
    baseAgentId: HARNESS_AGENT_ID,
    harness: harnessOfTypeId(typeId) ?? NATIVE_HARNESS,
    capabilities: HARNESS_OFFER,
  });

  const nativeOffer = (typeId: string): ThreadTypeOffer => ({
    baseAgentId: typeId,
    harness: NATIVE_HARNESS,
    capabilities: NATIVE_CAPABILITIES,
  });

  const resolveIn: DeclaredAgents['resolveIn'] = Effect.fnUntraced(function* ({ projectId, caller, typeId }) {
    if (harnessType(typeId)) return yield* offerTo(caller, projectId, typeId, HARNESS_TYPE, () => harnessOffer(typeId));
    if (agents.find(typeId) !== undefined && !bases.has(typeId)) {
      return yield* offerTo(caller, projectId, typeId, CODE_TYPE, () => nativeOffer(typeId));
    }
    const packaged = yield* packagedNamed(projectId, typeId);
    if (packaged !== undefined && validate(packaged) === undefined) {
      return yield* offerTo(caller, projectId, typeId, STANDINGS[packaged.origin], () =>
        packaged.approvalMode === undefined
          ? offerOf(files.profileOf(packaged))
          : { ...offerOf(files.profileOf(packaged)), approvalMode: packaged.approvalMode },
      );
    }
    const file = (yield* filesOf(projectId)).agents.find((held) => held.id === typeId);
    if (!file) return null;
    return yield* offerTo(caller, projectId, typeId, STANDINGS[file.origin], () => offerOf(files.profileOf(file)));
  });

  const offeredIn: DeclaredAgents['offeredIn'] = Effect.fnUntraced(function* ({ projectId, caller }) {
    const judge = yield* judgeOf(caller, projectId);
    const offered = (typeId: string, standing: Standing) => judge(typeId, standing) === null;
    const agents: OfferedType[] = namable()
      .filter((agent) => offered(agent.id, CODE_TYPE))
      .map((agent) => ({ id: agent.id, name: agent.name, description: agent.description, baseAgentId: agent.id }));
    const offeredHarnesses = harnessSpawnTypes(yield* harnesses).filter((type) => offered(type.id, HARNESS_TYPE));
    const declared = (yield* filesOf(projectId)).agents.filter((file) => offered(file.id, STANDINGS[file.origin])).map(spawnTypeOf);
    return [...agents, ...offeredHarnesses, ...declared];
  });

  const withoutProject = (): Effect.Effect<readonly OfferedType[]> =>
    Effect.map(harnesses, (installs) => [
      ...namable().map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        baseAgentId: agent.id,
      })),
      ...harnessSpawnTypes(installs),
    ]);

  const declared: DeclaredAgents = {
    directoriesOf: floorsOf,
    validate,
    resolveIn,
    offeredIn,
    rejectedIn: (projectId) => Effect.map(filesOf(projectId), (found) => found.rejected),
    filesOf,
    resolve: Effect.fnUntraced(function* ({ under, caller, typeId, project }) {
      const projectId = project ?? (yield* projectUnder(under));
      if (projectId === undefined) {
        if (harnessType(typeId)) return harnessOffer(typeId);
        return agents.find(typeId) !== undefined && !bases.has(typeId) ? nativeOffer(typeId) : null;
      }
      return yield* resolveIn({ projectId, caller, typeId });
    }, Effect.mapError(typesFailure)),
    offered: Effect.fnUntraced(function* ({ under, caller, project }) {
      const projectId = project ?? (yield* projectUnder(under));
      if (projectId === undefined) return yield* withoutProject();
      return yield* offeredIn({ projectId, caller });
    }, Effect.mapError(typesFailure)),
  };
  return declared;
});

type Standing = { readonly to: OfferAudience; readonly what: string };

type Judge = (typeId: string, standing: Standing) => ThreadTypeWithheld | null;

const OFFERED: Judge = () => null;

const CODE_TYPE: Standing = { to: 'agents', what: 'an agent of this server' };
const HARNESS_TYPE: Standing = { to: 'agents', what: 'a harness of this server' };
const STANDINGS: Record<AgentFile['origin'], Standing> = {
  builtin: { to: 'agents', what: 'a built-in agent of this server' },
  personal: { to: 'agents', what: "a file of the operator's personal agents" },
  project: { to: 'operator', what: "a file of this project's agents" },
  plugin: { to: 'operator', what: "a plugin's agent" },
};

function withheld(typeId: string, standing: Standing, set: boolean): ThreadTypeWithheld {
  return {
    withheld: set
      ? `${typeId} is offered to the operator alone: ${agentsOffered.id} names it so.`
      : `${typeId} is ${standing.what}, offered to the operator alone until ${agentsOffered.id} offers it to agents.`,
    unblock: [
      `on the operator's word, write_setting ${agentsOffered.id} with {"type": "${typeId}", "to": "agents"} added to this project's entries`,
      'start a type you are offered',
    ],
  };
}

const typesFailure = (cause: ThreadBorderFailed): ThreadTypesFailure =>
  cause instanceof ThreadStorageFailed ? cause : new ThreadTypesUnavailable({ cause });

function offerOf(profile: AgentProfile): ThreadTypeOffer {
  return { baseAgentId: profile.baseAgentId, profile, harness: NATIVE_HARNESS, capabilities: NATIVE_CAPABILITIES };
}
