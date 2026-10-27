import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Fiber, Layer, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { ScreenAnswer } from '@runlith/executions/protocol/presentation';
import { TerminalRequests, Terminals, type TerminalStart } from '../executions/contract/service/terminals.js';
import { TerminalScreens } from '../executions/contract/service/records.js';
import { HostManagement, type HostStanding } from '../executions/contract/service/host.js';
import { TerminalEndings } from '../executions/contract/service/endings.js';
import type { ResolvedExecutionTarget } from '../executions/contract/wire/targets.js';
import type { TerminalRecord } from '../executions/contract/wire/terminals.js';
import { ProjectIdentification, Projects } from '../projects/contract/service/registry.js';
import type { ProjectIdentity, ProjectRow } from '../projects/contract/wire/project.js';
import { DevSurface } from './contract/service/surface.js';
import { devSurfaceLayer } from './surface.js';

const CHECKOUT = '/work/runlith';
const PORT = 5642;
const URL = 'http://localhost:5641/';
const WITNESS = { provider: 'test', format: 'test', token: 'test' };
const EXECUTION = { installation: 'install-1', execution: 'exec-1', incarnation: 1 } as unknown as ExecutionRef;

type Scene = {
  readonly checkout?: string | null;
  readonly answers: 'already' | 'once-started' | 'later';
  readonly ended?: ExecutionSummary;
  readonly lines?: readonly string[];
};

const surfaceOf = Effect.fnUntraced(function* (scene: Scene) {
  const starts: TerminalStart[] = [];
  const racing = yield* Queue.unbounded<void>();
  let up = scene.answers === 'already';
  const answering = () => up || (scene.answers === 'once-started' && starts.length > 0);
  const screen = {
    _tag: 'ScreenTextFrame',
    geometry: { viewportLine: 0 },
    rows: (scene.lines ?? []).map((text, line) => ({ line, wrapped: false, text })),
  } as unknown as ScreenAnswer;
  const doubles = Layer.mergeAll(
    Layer.mock(Terminals, {
      target: (request) =>
        Effect.succeed({
          projectId: 5,
          binding: { environmentId: 'host', namespaceId: 'machine', identityWitness: WITNESS },
          footprint: { resource: { path: request.cwd }, witness: WITNESS, roots: [] },
        } as unknown as ResolvedExecutionTarget),
      start: (request) =>
        Effect.sync(() => {
          starts.push(request);
          return {
            _tag: 'Started' as const,
            operation: { installation: EXECUTION.installation, operation: request.operationId },
            record: { execution: EXECUTION } as unknown as TerminalRecord,
          };
        }),
    }),
    Layer.mock(TerminalRequests, {}),
    Layer.mock(TerminalEndings, {
      decided: () =>
        Effect.andThen(
          Queue.offer(racing, undefined),
          scene.ended === undefined ? Effect.never : Effect.succeed({ _tag: 'Decided' as const, summary: scene.ended }),
        ),
    }),
    Layer.mock(TerminalScreens, { screen: () => Effect.succeed(screen) }),
    Layer.succeed(HostManagement, {
      standing: Effect.succeed({ geometry: { rows: 24, columns: 80 } } as HostStanding),
      get connection(): never {
        throw new Error('serving the dev surface reads no host connection');
      },
    }),
    Layer.mock(Projects, { resolve: () => Effect.succeed({ id: 5, name: 'runlith' } as unknown as ProjectRow) }),
    Layer.mock(ProjectIdentification, { identify: (path) => Effect.succeed({ rootPath: path } as unknown as ProjectIdentity) }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        answering()
          ? Effect.succeed(HttpClientResponse.fromWeb(request, new Response('', { headers: { 'content-type': 'text/javascript' } })))
          : Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) })),
      ),
    ),
  );
  const built = yield* Layer.build(
    devSurfaceLayer({ checkout: scene.checkout === null ? undefined : (scene.checkout ?? CHECKOUT), port: PORT }).pipe(
      Layer.provide(doubles),
    ),
  );
  return {
    serve: Context.get(built, DevSurface).serve,
    starts,
    racing,
    comeUp: () => {
      up = true;
    },
  };
});

it.effect('a Vite already answering is taken as it stands and nothing starts', () =>
  Effect.gen(function* () {
    const surface = yield* surfaceOf({ answers: 'already' });
    expect(yield* surface.serve).toEqual({ url: URL, started: false });
    expect(surface.starts).toEqual([]);
  }),
);

it.effect('a silent address starts one held terminal of the checkout app on this server port and answers once the address answers', () =>
  Effect.gen(function* () {
    const surface = yield* surfaceOf({ answers: 'once-started' });
    expect(yield* surface.serve).toEqual({ url: URL, started: true });
    expect(surface.starts.map((start) => [start.target.footprint.resource.path, start.lifetime, start.environment?.entries])).toEqual([
      [
        `${CHECKOUT}/apps/tagma/app`,
        'held',
        [
          { _tag: 'Set', name: 'TAGMA_PORT', value: String(PORT) },
          { _tag: 'Unset', name: 'TAGMA_SURFACE_OUT' },
        ],
      ],
    ]);
  }),
);

it.effect('a call cut off while Vite comes up leaves the next call waiting on that Vite rather than starting another', () =>
  Effect.gen(function* () {
    const surface = yield* surfaceOf({ answers: 'later' });
    const first = yield* Effect.forkChild(surface.serve);
    yield* Queue.take(surface.racing);
    yield* Fiber.interrupt(first);
    const second = yield* Effect.forkChild(surface.serve);
    yield* Queue.take(surface.racing);
    surface.comeUp();
    yield* TestClock.adjust('250 millis');
    expect(yield* Fiber.join(second)).toEqual({ url: URL, started: true });
    expect(surface.starts.length).toBe(1);
  }),
);

it.effect('a terminal ending before the address answers refuses with the last lines it printed', () =>
  Effect.gen(function* () {
    const ended = { state: { phase: 'ended', nativeExit: { _tag: 'Code', code: 1 } } } as unknown as ExecutionSummary;
    const surface = yield* surfaceOf({ answers: 'later', ended, lines: ['Error: Port 5641 is already in use'] });
    expect(yield* Effect.flip(surface.serve)).toMatchObject({
      code: 'dev-surface-ended',
      reason: expect.stringMatching(/\nError: Port 5641 is already in use$/),
    });
  }),
);

it.effect('a server cut from no checkout refuses with its own code and starts nothing', () =>
  Effect.gen(function* () {
    const surface = yield* surfaceOf({ checkout: null, answers: 'later' });
    expect(yield* Effect.flip(surface.serve)).toMatchObject({ code: 'dev-surface-no-checkout' });
    expect(surface.starts).toEqual([]);
  }),
);
