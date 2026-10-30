import { Context, Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { threadLog } from '../../native-harness/testing/doubles.js';
import { bornThread as bornKernelThread } from '../../native-harness/testing/born.js';
import { sessionFor, sessionOfThread } from '../../external-harnesses/testing/sessions.js';
import { GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../platform/contract/service/credentials.js';
import { sessionTokenEnvironment, grantEnvironment } from '../../platform/testing/grants.js';
import { unmeasuredObservation } from '../../threads/contract/wire/harness/observation.js';
import { harnessArgv, harnessPresentation } from '../../external-harnesses/contract/service/table.js';
import { SHIPPED_HARNESSES, sessionIdentity } from '../../external-harnesses/testing/builtin.js';
import { builtinHarness } from '../../external-harnesses/testing/builtin.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { KernelSeat } from '../../threads/contract/wire/harness/seat.js';
import type { makeTerminalWorld } from './fixture.js';

export const HOOK_SESSION = '01a09400-0000-7000-8000-00000000dd01';

export type HookEvent = 'session-start' | 'pre-tool-use' | 'post-tool-use' | 'observe' | 'stop';

type TerminalPlace = Effect.Success<ReturnType<typeof makeTerminalWorld>>;

export const unsigned = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = {
    [GRANT_VARIABLE]: undefined,
    [SESSION_TOKEN_VARIABLE]: undefined,
  };
  for (const { variable } of SHIPPED_HARNESSES) if (variable !== undefined) env[variable] = undefined;
  return env;
};

export const hookThreads = (world: TerminalPlace) => {
  const store = Context.get(world.runtime.graph, MachineStore);
  const owned = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.provide(work, world.runtime.owners);
  return {
    hook: (
      event: HookEvent,
      root: string,
      payload: Record<string, unknown>,
      granted: string | null,
      session: string | null = HOOK_SESSION,
    ) =>
      world.tagma(['hook', event], {
        cwd: root,
        stdin: JSON.stringify(payload),
        env: {
          ...unsigned(),
          ...(granted === null
            ? {}
            : session === null
              ? grantEnvironment(granted, sessionIdentity)
              : sessionTokenEnvironment(granted, session, sessionIdentity)),
        },
      }),
    bornThread: Effect.fnUntraced(function* (id: string, projectId: number, harness: ExternalSession | null, kernel?: KernelSeat) {
      yield* owned(
        bornKernelThread(
          store.db,
          {
            id,
            ownerId: 'operator',
            agentId: harness === null ? 'tagma' : 'harness',
            provider: 'openai-oauth',
            model: 'gpt-test',
            reasoning: 'high',
            authority: { mode: 'trust', bypassFrom: null },
            status: 'idle',
            createdAt: new Date(0),
            updatedAt: new Date(0),
            spawnRootId: id,
            cacheGroup: id,
            name: id,
          },
          { projectId, title: id },
        ),
      );
      if (harness !== null) {
        yield* owned(store.db.insert(threadLog()).values({ threadId: id }));
        yield* owned(sessionFor(store.db, id, harness, kernel));
      }
      return id;
    }),
    facetOf: (id: string) => owned(sessionOfThread(store.db, id)),
    workOf: Effect.fnUntraced(function* (id: string) {
      const row = yield* owned(
        store.db.get<{ stage: string | null } | undefined>(
          sql`select json_extract(progress, '$.stage') as stage from thread_run where thread_id = ${id} and status = 'running' limit 1`,
        ),
      );
      return row === undefined ? ('idle' as const) : row.stage === 'awaiting-question' ? ('waiting' as const) : ('working' as const);
    }),
    askedOf: Effect.fnUntraced(function* (id: string) {
      const row = yield* owned(
        store.db.get<{ asked: string | null }>(sql`select pending_interaction as asked from native_thread where id = ${id}`),
      );
      return row?.asked ?? null;
    }),
  };
};

export const born = (name: ExternalSession['name'] = 'devin', sessionKey: string | null = null): ExternalSession => ({
  name,
  presentation: harnessPresentation(builtinHarness(name)),
  sessionKey,
  execution: null,
  observation: unmeasuredObservation(),
});

export const running = Effect.fnUntraced(function* (facet: ExternalSession) {
  const argv = yield* harnessArgv(builtinHarness(facet.name), facet.sessionKey, HOOK_SESSION, '');
  return {
    ...facet,
    session: {
      id: HOOK_SESSION,
      origin: 'launched',
      state: 'running',
      prompt: '',
      cwd: null,
      argv,
      ownerId: null,
      startedAt: '2026-09-13T10:00:00.000Z',
      heartbeatAt: '2026-09-13T10:00:00.000Z',
    },
  } satisfies ExternalSession;
});

export const naming = (name: ExternalSession['name'], sessionKey: string, model: string): ExternalSession => ({
  name,
  presentation: harnessPresentation(builtinHarness(name)),
  sessionKey,
  execution: null,
  observation: {
    ...unmeasuredObservation(),
    revision: 1,
    binding: { sessionId: HOOK_SESSION, execution: null, rootKey: sessionKey },
    metadata: {
      ...unmeasuredObservation().metadata,
      model: {
        _tag: 'Value',
        value: model,
        claim: 'serving',
        source: 'hook',
        scope: { rootKey: sessionKey, turnId: null },
        observedAt: '2026-09-13T10:00:00.000Z',
      },
    },
  },
});
