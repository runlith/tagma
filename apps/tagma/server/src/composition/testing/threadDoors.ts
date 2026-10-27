import { unthreadedCaller } from './callers';
import { Context, Effect } from 'effect';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../platform/testing/grants.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { OUTCOME_HEADER } from '../../invocation/contract/wire/headers.js';
import { threadWorkOf } from '../callOwners.js';
import { Settings } from '../../settings/contract/service/values.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { TargetPreparation } from '../../threads/contract/service/preparation.js';
import { originOf } from '../../threads/contract/wire/target.js';
import { Worlds } from '../../executions/contract/service/worlds.js';
import { ServingGit } from '../../executions/contract/service/git.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { McpServers } from '../../mcp/contract/service/servers.js';
import { ThreadExecution } from '../../native-harness/contract/service/execution.js';
import { CurrentGraph, type GraphContext, type ServedGraph } from '../../graph/contract/service/serving.js';
import type { ServerRuntime } from '../runtime.js';

export type Outcome =
  | { readonly class: 'answer'; readonly value: unknown }
  | {
      readonly class: 'refusal';
      readonly code: string;
      readonly reason?: string;
      readonly unblock: readonly string[];
      readonly inputFile?: string;
    };

export type Doors = {
  readonly threadId: string;
  readonly grant: string;
  readonly native: Record<string, Tool>;
  readonly root: string;
  readonly served: ServedGraph;
};

export type DoorEnvironment = {
  readonly runtime: ServerRuntime;
  readonly routed: GraphContext;
  readonly app: (request: Request, context: GraphContext) => Promise<Response>;
};

export const git = Effect.fnUntraced(function* (cwd: string, ...args: readonly string[]) {
  const ran = yield* spawnedEffect(['git', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'suite',
      GIT_AUTHOR_EMAIL: 'suite@tagma',
      GIT_COMMITTER_NAME: 'suite',
      GIT_COMMITTER_EMAIL: 'suite@tagma',
    },
  });
  if (ran.exitCode !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')} in ${cwd}: ${new TextDecoder().decode(ran.stderr)}`));
});

export const makeThreadDoors = (
  world: DoorEnvironment,
  project: number,
  tools: readonly string[],
  execution?: ThreadExecution['Service'],
) => {
  const doorsFor = Effect.fnUntraced(function* (threadId: string, ownerId: string) {
    const row = yield* Context.get(world.runtime.graph, Projects).byId(project);
    const worlds = Context.get(world.runtime.owners, Worlds);
    const admitted = yield* Context.get(world.runtime.owners, TargetPreparation).of(
      { id: threadId, projectId: project },
      { kind: 'tools', runId: null, context: null },
      (request) => worlds.of({ thread: { id: threadId, hostKind: null, hostId: null }, ...request }),
    );
    const place = { root: admitted.world.root, origin: originOf(admitted.target) };
    const caller: Caller = {
      actor: { kind: 'thread', threadId, projectId: project, principalId: ownerId, session: { harness: NATIVE_HARNESS, key: threadId } },
      files: world.runtime.scratch.scope(threadId),
    };
    const vocabulary = yield* Context.get(world.routed, Tags).of(project);
    const served = yield* world.runtime.pool.resolve({ projectId: admitted.target.graph.projectId, cwd: admitted.target.graph.root });
    const machine = Context.get(world.runtime.graph, MachineStore);
    const work = yield* threadWorkOf(machine, Context.get(world.routed, Settings), Context.get(world.runtime.workspace, CheckoutPaths))(
      caller,
      place,
      { world: admitted.world, runId: null, projectRoot: row.rootPath },
    );
    if (work === null) return yield* Effect.die(new Error(`thread ${threadId} stands in no world`));
    const opened = {
      thread: { id: threadId, ownerId, hostKind: null, hostId: null },
      runId: null,
      world: admitted.world,
      target: admitted.target,
      workingRoot: admitted.world.root,
      origin: place.origin,
      caller,
      project: { id: project, name: row.name },
      projectId: project,
      projectRoot: row.rootPath,
      vocabulary: () => vocabulary,
      identity: testSessionIdentity,
      graph: Effect.succeed(Context.add(served.context, CurrentGraph, served)),
      graphRoot: served.checkout,
      served,
      machine,
      units: Context.get(world.runtime.graph, MachineUnits),
      commandTimes: work.times,
      comments: work.comments,
      rows: () => Effect.void,
      servingGit: Context.get(world.runtime.owners, ServingGit),
      mcpServers: Context.get(world.runtime.owners, McpServers),
    } as unknown as Parameters<ThreadExecution['Service']['tools']>[0];
    const native = (execution ?? Context.get(world.runtime.owners, ThreadExecution)).tools(opened, tools) as Record<string, Tool>;
    return {
      threadId,
      grant: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string,
      native,
      root: place.root,
      served,
    } satisfies Doors;
  });

  const atHttp = Effect.fnUntraced(function* (id: string, input: unknown, at: Doors) {
    const response = yield* Effect.promise((signal) =>
      world.app(
        new Request(`http://tagma/api/op/${id}?project=${project}&cwd=${encodeURIComponent(at.root)}`, {
          signal,
          method: 'POST',
          headers: { 'content-type': 'application/json', [GRANT_HEADER]: at.grant },
          body: JSON.stringify(input),
        }),
        world.routed,
      ),
    );
    const body = (yield* Effect.promise(() => response.json())) as {
      code?: string;
      reason?: string;
      unblock?: string[];
      inputFile?: string;
    };
    const outcome = response.headers.get(OUTCOME_HEADER);
    if (outcome === 'refusal') {
      return {
        class: 'refusal',
        code: body.code ?? '',
        reason: body.reason,
        unblock: body.unblock ?? [],
        inputFile: body.inputFile,
      } as Outcome;
    }
    if (outcome !== 'answer' && outcome !== 'negative') {
      return yield* Effect.die(new Error(`${id} answered ${outcome} over HTTP: ${JSON.stringify(body)}`));
    }
    return { class: 'answer', value: body } as Outcome;
  });

  let sequence = 0;
  const atNative = Effect.fnUntraced(function* (id: string, input: unknown, at: Doors) {
    const tool = at.native[id];
    if (tool === undefined) return yield* Effect.die(new Error(`the native door mounted no ${id}`));
    const call = { toolCallId: `parity-${id}-${++sequence}`, caller: unthreadedCaller, messages: [] };
    return yield* Effect.matchEffect(
      Effect.gen(function* () {
        const prepare = toolPrepare(tool);
        const prepared = prepare === null ? undefined : yield* prepare(input, call);
        const execute = toolExecute(tool);
        if (execute === null) return yield* Effect.die(new Error(`${id} declares no body`));
        return yield* execute(input, { ...call, prepared: prepared?.prepared });
      }),
      {
        onFailure: (failure): Effect.Effect<Outcome> =>
          failure.code === undefined
            ? Effect.die(new Error(`${id} failed at the native door: ${failure.message}`))
            : Effect.succeed({ class: 'refusal', code: failure.code, reason: failure.message, unblock: failure.unblock ?? [] }),
        onSuccess: (answered) =>
          Effect.sync((): Outcome => {
            const unframed = answered instanceof ToolAnswer ? answered.value : answered;
            const value = JSON.parse(JSON.stringify(unframed)) as {
              status?: string;
              code?: string;
              reason?: string;
              unblock?: string[];
              inputFile?: string;
              journal?: unknown;
              journalUnreadable?: unknown;
            };
            if (value.status === 'refused')
              return {
                class: 'refusal',
                code: value.code ?? '',
                reason: value.reason,
                unblock: value.unblock ?? [],
                inputFile: value.inputFile,
              };
            const { journal: _journal, journalUnreadable: _unreadable, ...answer } = value;
            return { class: 'answer', value: answer };
          }),
      },
    );
  });

  return { doorsFor, atHttp, atNative };
};
