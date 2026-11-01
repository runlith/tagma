import { join } from 'node:path';
import { Effect, Layer, Semaphore } from 'effect';
import { HttpClient } from 'effect/http';
import { HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import type { ScreenAnswer } from '@runlith/executions/protocol/presentation';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { BUILD_COMMAND } from '../installation/contract/wire/layout.js';
import { PORT_VARIABLES, surfaceDevPort } from '../installation/contract/wire/ports.js';
import { TerminalRequests, Terminals, type TerminalFailure } from '../executions/contract/service/terminals.js';
import { TerminalScreens } from '../executions/contract/service/records.js';
import { HostManagement } from '../executions/contract/service/host.js';
import { TerminalEndings, type TerminalEnding } from '../executions/contract/service/endings.js';
import { principalOf } from '../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../executions/terminals/subjectPolicy.js';
import { terminalRefusal } from '../executions/terminals/refusal.js';
import { ProjectIdentification, Projects } from '../projects/contract/service/registry.js';
import type { ProjectRow } from '../projects/contract/wire/project.js';
import { placeAt } from '../projects/identity.js';
import { DevSurface, type SurfaceRefusal } from './contract/service/surface.js';

const VITE = ['run', '--bun', 'vite'];
const LABEL = 'Tagma dev surface';
const SURFACE_OUT = 'TAGMA_SURFACE_OUT';
const VITE_CLIENT = '@vite/client';
const SCRIPT = 'javascript';
const ASKED_EVERY = '250 millis';
const TAIL_LINES = 20;

export type SurfaceApp = { readonly root: string; readonly config: string | null };

export type SurfaceOptions = { readonly checkout: string | undefined; readonly app: SurfaceApp; readonly port: number };

type Attempt =
  | { readonly _tag: 'Started'; readonly execution: ExecutionRef; readonly project: ProjectRow; readonly cwd: string }
  | { readonly _tag: 'Uncertain'; readonly operation: HostRequestKey; readonly project: ProjectRow; readonly cwd: string };

type Started = Extract<Attempt, { readonly _tag: 'Started' }>;

const passed = (failure: TerminalFailure | GateRefusal): GateRefusal<SurfaceRefusal> =>
  terminalRefusal(failure) as GateRefusal<SurfaceRefusal>;

const lastLines = (screen: ScreenAnswer): string => {
  if (screen._tag === 'ScreenUnavailable') return `its output cannot be read: ${screen.detail}`;
  const lines = screenLines(screen)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
  return lines.length === 0 ? 'it printed nothing' : lines.slice(-TAIL_LINES).join('\n');
};

const endedWords = (ending: TerminalEnding): string => {
  if (ending._tag === 'Unwatchable') return 'is no longer held by the execution host';
  const exit = ending.summary.state.nativeExit;
  if (exit === undefined) return 'ended';
  return exit._tag === 'Code' ? `exited with code ${exit.code}` : `was ended by ${exit.signal}`;
};

export const makeDevSurface = Effect.fnUntraced(function* (options: SurfaceOptions) {
  const terminals = yield* Terminals;
  const requests = yield* TerminalRequests;
  const endings = yield* TerminalEndings;
  const screens = yield* TerminalScreens;
  const host = yield* HostManagement;
  const projects = yield* Projects;
  const identification = yield* ProjectIdentification;
  const client = yield* HttpClient.HttpClient;
  const turn = yield* Semaphore.make(1);
  const url = `http://localhost:${surfaceDevPort(options.port)}/`;
  const probe = new URL(VITE_CLIENT, url).toString();
  let attempt: Attempt | null = null;

  const answers = client.get(probe).pipe(
    Effect.map((response) => response.status >= 200 && response.status < 300 && (response.headers['content-type'] ?? '').includes(SCRIPT)),
    Effect.catchReason('HttpClientError', 'TransportError', () => Effect.succeed(false)),
    Effect.orDie,
  );

  const answered = Effect.gen(function* () {
    while (!(yield* answers)) yield* Effect.sleep(ASKED_EVERY);
  });

  const uncertain = (operation: HostRequestKey, project: ProjectRow, cwd: string) =>
    new GateRefusal('dev-surface-uncertain', `the execution host could not vouch for the start of Vite in ${cwd}`, [
      `read_terminal_operation ${operation} in project ${project.name} — whether the dev server started`,
      `start_dev_surface again: it reads that start back before starting anything else`,
    ]);

  const projectOf = Effect.fn('DevSurface.project')(function* (checkout: string) {
    const here = yield* placeAt(checkout).pipe(Effect.provideService(ProjectIdentification, identification));
    const own = yield* projects.resolve(undefined, here);
    if (own !== undefined) return own;
    const shared = yield* projects.global();
    if (shared !== undefined) return shared;
    return yield* new GateRefusal(
      'global-missing',
      `${checkout} belongs to no registered project, and this machine has no global project to hold its terminal`,
      ['add_project for the checkout — its terminals stand in that project'],
    );
  });

  const start = Effect.fn('DevSurface.start')(function* (checkout: string) {
    const actor = { _tag: 'Operator' } as const;
    const principal = principalOf(actor);
    const project = yield* projectOf(checkout);
    const cwd = join(checkout, options.app.root);
    const operation = HostRequestKey.make(`dev-surface:${crypto.randomUUID()}`);
    const target = yield* terminals.target({ projectId: project.id, kind: 'host', cwd }).pipe(Effect.mapError(passed));
    const receipt = yield* Effect.scoped(
      terminals.start({
        actor,
        operationId: operation,
        target,
        targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
        program: process.execPath,
        args: options.app.config === null ? VITE : [...VITE, '--config', join(checkout, options.app.config)],
        label: LABEL,
        transport: 'pty',
        lifetime: 'held',
        geometry: (yield* host.standing).geometry,
        environment: {
          inherit: true,
          entries: [
            { _tag: 'Set', name: PORT_VARIABLES.server, value: String(options.port) },
            { _tag: 'Unset', name: SURFACE_OUT },
          ],
        },
      }),
    ).pipe(Effect.mapError(passed));
    switch (receipt._tag) {
      case 'Started':
        return { _tag: 'Started', execution: receipt.record.execution, project, cwd } satisfies Attempt;
      case 'Refused':
        return yield* passed(receipt.refusal);
      case 'Uncertain':
        return { _tag: 'Uncertain', operation, project, cwd } satisfies Attempt;
      case 'Accepted':
        return yield* Effect.die(new Error(`the held terminal of Vite in ${cwd} was accepted as a command`));
    }
  });

  const readBack = Effect.fn('DevSurface.readBack')(function* (checkout: string, standing: Attempt) {
    if (standing._tag === 'Started') return standing;
    const state = yield* requests.request(standing.project.id, standing.operation).pipe(Effect.mapError(passed));
    switch (state._tag) {
      case 'Admitted':
        return { ...standing, _tag: 'Started', execution: state.execution } satisfies Started;
      case 'Settled':
        return state.execution === undefined
          ? yield* start(checkout)
          : ({ ...standing, _tag: 'Started', execution: state.execution } satisfies Started);
      case 'Pending':
      case 'Uncertain':
        return standing;
      case 'Unknown':
      case 'Expired':
        return yield* start(checkout);
    }
  });

  return DevSurface.of({
    serve: turn
      .withPermit(
        Effect.gen(function* () {
          const checkout = options.checkout;
          if (checkout === undefined) {
            return yield* new GateRefusal(
              'dev-surface-no-checkout',
              'this server was installed rather than cut from a checkout on this machine, so it has no app to serve',
              [
                `${BUILD_COMMAND} — at a Tagma checkout root, builds that checkout and makes it the installation that stands; its server serves that checkout's app`,
              ],
            );
          }
          if (yield* answers) {
            attempt = null;
            return { url, started: false };
          }
          const standing = attempt === null ? yield* start(checkout) : yield* readBack(checkout, attempt);
          attempt = standing;
          if (standing._tag === 'Uncertain') return yield* uncertain(standing.operation, standing.project, standing.cwd);
          const outcome = yield* Effect.raceFirst(
            Effect.as(answered, null),
            endings.decided({ projectId: standing.project.id, execution: standing.execution }),
          );
          attempt = null;
          if (outcome === null) return { url, started: true };
          const tail = yield* screens
            .screen(standing.execution)
            .pipe(Effect.match({ onFailure: (failure) => `its output cannot be read: ${passed(failure).reason}`, onSuccess: lastLines }));
          return yield* new GateRefusal(
            'dev-surface-ended',
            `Vite in ${standing.cwd} ${endedWords(outcome)} before ${url} answered. Its last lines:\n${tail}`,
            [
              `read the terminal "${LABEL}" of project ${standing.project.name} — its whole output`,
              `start_dev_surface again once what ended it is fixed; another process holding port ${surfaceDevPort(options.port)} ends it at once`,
            ],
          );
        }),
      )
      .pipe(Effect.withSpan('DevSurface.serve')),
  });
});

export const devSurfaceLayer = (options: SurfaceOptions) => Layer.effect(DevSurface, makeDevSurface(options));
