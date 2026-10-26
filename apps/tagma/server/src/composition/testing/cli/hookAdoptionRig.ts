import { Context, Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { sessionFor, sessionOfThread } from '../../../external-harnesses/testing/sessions.js';
import { GRANT_HEADER, GRANT_VARIABLE, TERMINAL_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import type { HarnessAdoptInput } from '../../../external-harnesses/contract/wire/adoption.js';
import { unmeasuredObservation, type HarnessReportInput } from '../../../threads/contract/wire/harness/observation.js';
import { HARNESSES } from '../../../external-harnesses/contract/service/table.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import { makeTerminalWorld } from '../fixture.js';

export const SESSION = '01a0d600-0000-7000-8000-00000000ad01';

type Heard = {
  adopts: { body: HarnessAdoptInput; cwd: string | null }[];
  reports: { body: HarnessReportInput; grant: string | null }[];
};

export const adoptionWorld = Effect.fnUntraced(function* () {
  const world = yield* makeTerminalWorld();
  const store = Context.get(world.runtime.graph, MachineStore);
  const owned = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.provide(work, world.runtime.owners);

  const bare = (): Record<string, string | undefined> => {
    const env: Record<string, string | undefined> = { [GRANT_VARIABLE]: undefined, [TERMINAL_VARIABLE]: undefined };
    for (const { variable } of HARNESSES) if (variable !== undefined) env[variable] = undefined;
    return env;
  };

  const adoptedThread = Effect.fnUntraced(function* (id: string, projectId: number, key: string) {
    const facet: ExternalSession = {
      name: 'claude-code',
      sessionKey: key,
      execution: null,
      observation: unmeasuredObservation(),
      session: {
        id: SESSION,
        origin: 'adopted',
        job: { pid: 1, birth: 'fixture-birth' },
        state: 'running',
        prompt: '',
        cwd: null,
        argv: null,
        ownerId: null,
        startedAt: '2026-09-24T10:00:00.000Z',
        heartbeatAt: '2026-09-24T10:00:00.000Z',
      },
    };
    yield* owned(
      bornThread(
        store.db,
        {
          id,
          ownerId: 'operator',
          agentId: 'harness',
          authority: { mode: 'trust', bypassFrom: null },
          status: 'running',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          spawnRootId: id,
          cacheGroup: id,
          name: id,
        },
        { projectId, title: id },
      ),
    );
    yield* owned(store.db.run(sql`insert into thread_log (thread_id) values (${id})`));
    yield* owned(sessionFor(store.db, id, facet));
    return id;
  });

  const facetOf = (id: string) => owned(sessionOfThread(store.db, id));

  const proxied = Effect.fnUntraced(function* (answer: (body: HarnessAdoptInput) => Effect.Effect<Response | null>) {
    const heard: Heard = { adopts: [], reports: [] };
    const run = Effect.runPromiseWith(Context.empty());
    const proxy = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/op/adopt_harness_session') {
              const body = (await request.clone().json()) as HarnessAdoptInput;
              heard.adopts.push({ body, cwd: url.searchParams.get('cwd') });
              const said = await run(answer(body));
              if (said !== null) return said;
            }
            if (url.pathname === '/api/op/report_harness_event') {
              heard.reports.push({ body: (await request.clone().json()) as HarnessReportInput, grant: request.headers.get(GRANT_HEADER) });
            }
            return fetch(new Request(`${world.url}${url.pathname}${url.search}`, request));
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    );
    return { heard, server: `http://127.0.0.1:${proxy.port}` };
  });

  const granting = (threadId: string) => () =>
    Effect.succeed<Response | null>(
      Response.json({ status: 'adopted', threadId, grant: grantFor(threadId), session: SESSION, job: { pid: 1, birth: 'fixture-birth' } }),
    );

  return { world, bare, store, adoptedThread, facetOf, proxied, granting, owned };
});

export class AdoptionRig extends Context.Service<AdoptionRig, Effect.Success<ReturnType<typeof adoptionWorld>>>()('testing/AdoptionRig') {}

export const adoptionLayer = Layer.effect(AdoptionRig, adoptionWorld());
