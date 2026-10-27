import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Ref, Stream, type Context } from 'effect';
import type { SessionWelcome } from '@runlith/executions/ExecutionClient';
import { Schema } from 'effect';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions, ExecutionsFailure } from '@runlith/executions/Executions';
import type { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { TerminalLanes } from '@runlith/executions/TerminalLanes';
import type { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { WireUnreadable, WireUnavailable } from '@runlith/executions/Executions';
import { HostRegistration, type Publication, type RegistrationReadFailure } from '@runlith/executions/HostRegistration';
import { digestOf, holderEntryOf, identityOf } from '@runlith/executions/hostArtifacts';
import {
  ARTIFACT_FILE,
  HOLDER_ENTRY_FILE,
  ArtifactManifest,
  type ArtifactPart,
  type ArtifactStamp,
} from '@runlith/executions/protocol/artifact';
import { Principal } from '@runlith/executions/protocol/custody';
import { InstallationId, HostRequestKey, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import type { CancelAnswer, LaunchRequest, StartAnswer } from '@runlith/executions/protocol/launch';
import { ConnectionId, type HostCustody, type HostCustodyRevision, type Registration } from '@runlith/executions/protocol/registration';
import type { OperationAnswer, RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { AuthorityAnswer } from '@runlith/executions/protocol/wire';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { executionGrant, executionPolicy } from './policy.js';
import { makeTerminalHostCustody, type CustodyAssurance, type TerminalHostCustody } from './custody.js';
import { bootPath } from '@runlith/executions/protocol/boot';
import { bootInput, bootText } from './boot.js';

const installation = InstallationId.make('terminal-host-custody');
const holder = Principal.make('holder-under-test');

const owned = fixtureRoot('terminal-host-custody', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'c-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const text = new TextEncoder();
const encodeManifest = Schema.encodeSync(Schema.fromJsonString(ArtifactManifest));

const wrote = (root: string, role: ArtifactPart['role'], path: string, content: string): ArtifactPart => {
  const bytes = text.encode(content);
  writeFileSync(join(root, path), bytes, { mode: 0o600 });
  return { role, path, bytes: bytes.length, digest: digestOf(bytes) };
};

const bundle = (name: string) => {
  const root = join(home, name);
  mkdirSync(root, { recursive: true });
  const parts: ReadonlyArray<ArtifactPart> = [
    wrote(root, 'runtime', 'bun', '#!/bin/sh\nexit 0\n'),
    wrote(root, 'holder', 'execution-holder', '#!/bin/sh\nexit 0\n'),
    wrote(root, 'host', 'host.js', 'export const serve = () => undefined;\n'),
    wrote(root, 'platform', 'libexecution_platform.dylib', 'these bytes stand in for a native library\n'),
    wrote(root, 'carrier', 'sqlite-process.js', 'export const carrier = true;\n'),
    wrote(root, 'evidence', 'worker.js', 'export const evidence = true;\n'),
    wrote(root, 'sampler', 'usageSampler.js', 'export const sampler = true;\n'),
    wrote(root, 'terminals', 'terminals.js', 'export const terminals = true;\n'),
    wrote(root, 'recovery', 'recovery.js', 'export const recover = () => undefined;\n'),
  ];
  const declared = {
    protocol: 'executions/1' as const,
    platform: { os: 'darwin', arch: 'arm64' },
    endpoint: { transport: 'unix', path: 'host.sock' },
    wire: { min: 1, max: 1 },
    parts,
  };
  const manifest: ArtifactManifest = { identity: { digest: identityOf(declared), build: name }, ...declared };
  const entry = holderEntryOf(manifest);
  if (entry === undefined) throw new Error('the fixture has no launch roles');
  writeFileSync(join(root, HOLDER_ENTRY_FILE), entry, { mode: 0o600 });
  writeFileSync(join(root, ARTIFACT_FILE), encodeManifest(manifest), { mode: 0o600 });
  return { root, manifest };
};

const { root: offered, manifest } = bundle('offered');

const publishedStamp = (): ArtifactStamp => ({ identity: manifest.identity, protocol: manifest.protocol, wire: manifest.wire.max });

const registered = (artifact?: ArtifactStamp): Registration => ({
  version: 1,
  state: home,
  installation,
  protocol: 'executions/1',
  endpoint: { transport: 'unix', path: join(home, 'host.sock') },
  credentials: { custodian: join(home, 'custodian.key'), recovery: join(home, 'recovery.key') },
  artifact: artifact,
});

const boot = bootInput(home, registered(publishedStamp()), manifest, executionPolicy);
if (boot === undefined) throw new Error('the fixture has no platform part');
writeFileSync(bootPath(home, manifest.identity.digest), bootText(boot));

const vacant = (revision: number, epoch: number): HostCustody => ({ revision, epoch });

const heldBy = (connection: string, incarnation: number, revision: number, epoch: number): HostCustody => ({
  revision,
  epoch,
  holder: { connection: ConnectionId.make(connection), incarnation },
});

const statusOf = (custody: HostCustody, incarnation: number): RuntimeStatus => ({
  installation,
  incarnation,
  phase: 'open',
  holder: { _tag: 'Standing' },
  custody,
  executions: 0,
  memory: { granted: executionGrant, reserved: 0, retained: 0, executions: 0, ceiling: 374 },
});

const takeHeld = (custody: HostCustody): AuthorityAnswer => ({ _tag: 'Held', custody });

const welcomed = (connection: string, custody: HostCustody): SessionWelcome => ({
  connection: ConnectionId.make(connection),
  incarnation: 0,
  custody,
});

const level = {
  database: { applied: 1, latest: 'a' },
  application: { applied: 1, latest: 'a' },
};

type Registrar = {
  readonly service: Context.Service.Shape<typeof HostRegistration>;
  readonly acts: () => readonly string[];
};

const registrar = (standing: Effect.Effect<Registration, RegistrationReadFailure>): Registrar => {
  const acts: string[] = [];
  const service = {
    read: () => {
      acts.push('read');
      return standing;
    },
    publish: () => {
      acts.push('publish');
      return Effect.map(standing, (registration) => ({ _tag: 'Existing', registration }) satisfies Publication);
    },
    record: () => {
      acts.push('record');
      return standing;
    },
    withdraw: () => Effect.die('this fixture offers no writer claim for withdrawing a registration'),
  } satisfies Context.Service.Shape<typeof HostRegistration>;
  return { service, acts: () => acts };
};

const undeclared = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> =>
  Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: `this fixture declares no answer for ${verb}`, sent: false }));

type PortScript = {
  readonly status?: ReadonlyArray<Effect.Effect<RuntimeStatus, ExecutionsFailure>>;
  readonly take?: ReadonlyArray<Effect.Effect<AuthorityAnswer, ExecutionsFailure>>;
  readonly operation?: ReadonlyArray<Effect.Effect<OperationAnswer, ExecutionsFailure>>;
  readonly start?: ReadonlyArray<Effect.Effect<StartAnswer, ExecutionsFailure>>;
  readonly cancelStart?: ReadonlyArray<Effect.Effect<CancelAnswer, ExecutionsFailure>>;
};

type ScriptedPort = {
  readonly port: Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    TerminalLanes['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'];
  readonly asked: () => readonly string[];
};

const scripted = (script: PortScript): ScriptedPort => {
  const asked: string[] = [];
  const status = [...(script.status ?? [])];
  const takes = [...(script.take ?? [])];
  const operations = [...(script.operation ?? [])];
  const starts = [...(script.start ?? [])];
  const cancels = [...(script.cancelStart ?? [])];
  const next = <A>(queue: Array<Effect.Effect<A, ExecutionsFailure>>, verb: string): Effect.Effect<A, ExecutionsFailure> => {
    asked.push(verb);
    return queue.shift() ?? undeclared<A>(verb);
  };
  const none = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> => {
    asked.push(verb);
    return undeclared<A>(verb);
  };
  const port = {
    status: () => next(status, 'status'),
    list: () => none<never>('list'),
    changes: () => none<never>('changes'),
    state: () => none<never>('state'),
    ending: () => none<never>('ending'),
    retained: () => none<never>('retained'),
    command: () => none<never>('command'),
    commands: () => none<never>('commands'),
    commandsAt: () => none<never>('commandsAt'),
    revise: () => none<never>('revise'),
    operation: () => next(operations, 'operation'),
    callResult: () => none<never>('callResult'),
    start: () => next(starts, 'start'),
    cancelStart: () => next(cancels, 'cancelStart'),
    read: () => none<never>('read'),
    subscribe: () => Stream.fromEffect(none<never>('subscribe')),
    screen: () => none<never>('screen'),
    point: () => none<never>('point'),
    input: () => none<never>('input'),
    signal: () => none<never>('signal'),
    processes: () => none<never>('processes'),
    foreground: () => none<never>('foreground'),
    listeners: () => none<never>('listeners'),
    hostListeners: () => none<never>('hostListeners'),
    capabilities: () => none<never>('capabilities'),
    generation: () => none<never>('generation'),
    served: () => none<never>('served'),
    custody: () => none<never>('custody'),
    stop: () => none<never>('stop'),
    take: (operation: HostRequestRef, expected: HostCustodyRevision) => {
      asked.push(`take:${expected}`);
      return takes.shift() ?? undeclared<AuthorityAnswer>('take');
    },
    fence: () => none<never>('fence'),
    release: () => none<never>('release'),
    grant: () => none<never>('grant'),
    openBinding: () => none<never>('openBinding'),
    closeBinding: () => none<never>('closeBinding'),
    open: () => none<never>('open'),
    inputs: () => none<never>('inputs'),
    retire: () => none<never>('retire'),
    quiesce: () => none<never>('quiesce'),
    resume: () => none<never>('resume'),
    prepare: () => none<never>('prepare'),
    yield: () => none<never>('yield'),
    shutdown: () => none<never>('shutdown'),
    pace: () => none<never>('pace'),
    disown: () => none<never>('disown'),
    endResidual: () => none<never>('endResidual'),
    endProcess: () => none<never>('endProcess'),
    load: () => none<never>('load'),
  } satisfies Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    TerminalLanes['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'];
  return { port, asked: () => asked };
};

const owner = Effect.fnUntraced(function* (
  registration: Registrar,
  host: ScriptedPort,
  over: { readonly bundle?: string | null; readonly welcome?: Ref.Ref<SessionWelcome | undefined> } = {},
): Effect.fn.Return<TerminalHostCustody, never, FileSystem.FileSystem> {
  return yield* makeTerminalHostCustody({
    executions: host.port,
    welcome: over.welcome ?? (yield* Ref.make<SessionWelcome | undefined>(welcomed('floor-1', vacant(0, 0)))),
    installation,
    state: home,
    offered:
      over.bundle === null
        ? undefined
        : { bundle: over.bundle ?? offered, digest: manifest.identity.digest, ...level, policy: executionPolicy },
  }).pipe(Effect.provideService(HostRegistration, registration.service));
});

const run = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem>) => Effect.provide(work, BunFileSystem.layer);

const keyOf = (name: string): HostRequestRef => ({ installation, operation: HostRequestKey.make(name) });

const launch: LaunchRequest = {
  command: { program: '/bin/echo', args: ['hello'], environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd: home, dependencies: [] },
  holder,
  origin: holder,
};

const started = (name: string): StartAnswer => ({
  _tag: 'Started',
  operation: keyOf(name),
  execution: { installation, execution: ExecutionId.make('exec-live'), incarnation: 0 },
  state: {
    ref: { installation, execution: ExecutionId.make('exec-live'), incarnation: 0 },
    transport: 'pipes',
    lifetime: 'call',
    purpose: 'command',
    phase: 'running',
    streams: { stdout: 'open', stderr: 'open', pty: 'open' },
    cleanup: 'pending',
    record: 'available',
  },
  native: {},
});

const refusedUnauthorized = (name: string): StartAnswer => ({
  _tag: 'Refused',
  operation: keyOf(name),
  refusal: { _tag: 'Unauthorized', reason: 'the presented custody is not the one that stands: NotCustodian' },
});

it.live.each([false, true])('conditional prevention never widens into a stop across custody assurance (refresh %s)', (refresh) =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0)), Effect.succeed(statusOf(heldBy('floor-1', 0, 1, 1), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
      });
      let reauthorize = refresh;
      let running = true;
      const port: Executions['Service'] &
        Commands['Service'] &
        ExecutionRequest['Service'] &
        ExecutionRecord['Service'] &
        ExecutionFeed['Service'] &
        TerminalScreen['Service'] &
        TerminalInput['Service'] &
        TerminalLanes['Service'] &
        ExecutionCustody['Service'] &
        ExecutionEvidence['Service'] &
        HostAuthority['Service'] &
        HostLifecycle['Service'] = {
        ...host.port,
        cancelStart: (operation, _cause, _trigger, when) =>
          Effect.sync((): CancelAnswer => {
            if (reauthorize) {
              reauthorize = false;
              return { _tag: 'Refused', operation, refusal: { _tag: 'Unauthorized', reason: 'the connection changed' } };
            }
            if (when === 'unadmitted')
              return { _tag: 'Refused', operation, refusal: { _tag: 'OperationConflict', reason: 'already admitted' } };
            running = false;
            return { _tag: 'Joined', operation, execution: { installation, execution: ExecutionId.make('live'), incarnation: 0 } };
          }),
      };
      const custody = yield* owner(registration, { ...host, port });
      const answer = yield* custody.guarded().cancelStart(keyOf('conditional-live'), 'explicit-stop', 'recovery', 'unadmitted');
      expect(answer._tag).toBe('Refused');
      expect(running).toBe(true);
    }),
  ),
);

it.live('a vacant custody under an adopted bundle is taken at the standing revision', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
      });
      const custody = yield* owner(registration, host);
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Held');
      if (assurance._tag === 'Held') expect(assurance.custody).toEqual(heldBy('floor-1', 0, 1, 1));
      expect(registration.acts()).toEqual(['read']);
      expect(host.asked()).toEqual(['status', 'take:0']);
    }),
  ),
);

it.live('a held custody answers from memory, touching neither the host nor the registration', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
      });
      const custody = yield* owner(registration, host);
      yield* custody.ensure();
      const again = yield* custody.ensure();
      expect(again._tag).toBe('Held');
      expect(host.asked()).toEqual(['status', 'take:0']);
      expect(registration.acts()).toEqual(['read']);
    }),
  ),
);

it.live('a live foreign holder is declined with its evidence, and no take is issued', () =>
  run(
    Effect.gen(function* () {
      const standing = heldBy('foreign-9', 0, 4, 3);
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({ status: [Effect.succeed(statusOf(standing, 0))] });
      const custody = yield* owner(registration, host);
      const assurance: CustodyAssurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Declined');
      if (assurance._tag === 'Declined') {
        expect(assurance.reason._tag).toBe('HeldElsewhere');
        if (assurance.reason._tag === 'HeldElsewhere') {
          expect(assurance.reason.custody).toEqual(standing);
          expect(assurance.reason.incarnation).toBe(0);
        }
      }
      expect(host.asked()).toEqual(['status']);
    }),
  ),
);

it.live('a holder of a dead generation holds nothing, so the floor takes', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(heldBy('dead-1', 0, 2, 2), 5))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 5, 3, 3)))],
      });
      const custody = yield* owner(registration, host);
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Held');
      if (assurance._tag === 'Held') expect(assurance.custody).toEqual(heldBy('floor-1', 5, 3, 3));
      expect(host.asked()).toEqual(['status', 'take:2']);
    }),
  ),
);

it.live('a reconnect re-takes the floor’s own earlier custody on the new connection', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0)), Effect.succeed(statusOf(heldBy('floor-1', 0, 1, 1), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1))), Effect.succeed(takeHeld(heldBy('floor-2', 0, 2, 2)))],
      });
      const custody = yield* owner(registration, host);
      yield* custody.ensure();
      const assurance = yield* custody.ensure({ fresh: true });
      expect(assurance._tag).toBe('Held');
      if (assurance._tag === 'Held') expect(assurance.custody).toEqual(heldBy('floor-2', 0, 2, 2));
      expect(host.asked()).toEqual(['status', 'take:0', 'status', 'take:1']);
    }),
  ),
);

it.live('a new session re-takes the remembered custody before any custody act, and a custody act then answers from memory', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
        start: [Effect.succeed(started('op-after'))],
      });
      const welcome = yield* Ref.make<SessionWelcome | undefined>(welcomed('floor-1', vacant(0, 0)));
      const custody = yield* owner(registration, host, { welcome });
      yield* custody.ensure();
      const next = welcomed('floor-2', heldBy('floor-1', 0, 1, 1));
      yield* Ref.set(welcome, next);
      const takes: number[] = [];
      yield* custody.opened(next, (_operation, expected) => {
        takes.push(expected);
        return Effect.succeed(takeHeld(heldBy('floor-2', 0, 2, 2)));
      });
      expect(takes).toEqual([1]);
      const outcome = yield* custody.guarded().start(keyOf('op-after'), launch);
      expect(outcome._tag).toBe('Started');
      expect(host.asked()).toEqual(['status', 'take:0', 'start']);
    }),
  ),
);

it.live('a new session re-takes at the standing revision when the old connection released custody under its first take', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
      });
      const welcome = yield* Ref.make<SessionWelcome | undefined>(welcomed('floor-1', vacant(0, 0)));
      const custody = yield* owner(registration, host, { welcome });
      yield* custody.ensure();
      const next = welcomed('floor-2', heldBy('floor-1', 0, 1, 1));
      yield* Ref.set(welcome, next);
      const takes: number[] = [];
      yield* custody.opened(next, (_operation, expected) => {
        takes.push(expected);
        return Effect.succeed(expected === 1 ? { _tag: 'Stale', expected, standing: vacant(2, 1) } : takeHeld(heldBy('floor-2', 0, 3, 2)));
      });
      expect(takes).toEqual([1, 2]);
      expect(yield* custody.ensure()).toEqual({ _tag: 'Held', custody: heldBy('floor-2', 0, 3, 2) });
      expect(host.asked()).toEqual(['status', 'take:0']);
    }),
  ),
);

it.live('a fresh assurance accepts the custody a reconnect inside its own status read re-took', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const welcome = yield* Ref.make<SessionWelcome | undefined>(welcomed('floor-1', vacant(0, 0)));
      const box: { custody?: TerminalHostCustody } = {};
      const next = welcomed('floor-2', heldBy('floor-1', 0, 1, 1));
      const host = scripted({
        status: [
          Effect.succeed(statusOf(vacant(0, 0), 0)),
          Effect.gen(function* () {
            yield* Ref.set(welcome, next);
            yield* box.custody!.opened(next, () => Effect.succeed(takeHeld(heldBy('floor-2', 0, 2, 2))));
            return statusOf(heldBy('floor-2', 0, 2, 2), 0);
          }),
        ],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
      });
      const custody = yield* owner(registration, host, { welcome });
      box.custody = custody;
      yield* custody.ensure();
      const assurance = yield* custody.ensure({ fresh: true });
      expect(assurance).toEqual({ _tag: 'Held', custody: heldBy('floor-2', 0, 2, 2) });
      expect(host.asked()).toEqual(['status', 'take:0', 'status']);
    }),
  ),
);

it.live('a new session whose re-take failed leaves the next custody act to take on the host', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0)), Effect.succeed(statusOf(heldBy('floor-1', 0, 1, 1), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1))), Effect.succeed(takeHeld(heldBy('floor-2', 0, 2, 2)))],
      });
      const welcome = yield* Ref.make<SessionWelcome | undefined>(welcomed('floor-1', vacant(0, 0)));
      const custody = yield* owner(registration, host, { welcome });
      yield* custody.ensure();
      const next = welcomed('floor-2', heldBy('floor-1', 0, 1, 1));
      yield* Ref.set(welcome, next);
      yield* custody.opened(next, () =>
        Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the session closed', sent: true })),
      );
      const assurance = yield* custody.ensure();
      expect(assurance).toEqual({ _tag: 'Held', custody: heldBy('floor-2', 0, 2, 2) });
      expect(host.asked()).toEqual(['status', 'take:0', 'status', 'take:1']);
    }),
  ),
);

it.live('an unpinned host defers adoption, and the port is never read', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered()));
      const host = scripted({});
      const custody = yield* owner(registration, host);
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Declined');
      if (assurance._tag === 'Declined') {
        expect(assurance.reason._tag).toBe('ActivationDeferred');
        if (assurance.reason._tag === 'ActivationDeferred') expect(assurance.reason.reason._tag).toBe('HostUnknown');
      }
      expect(host.asked()).toEqual([]);
    }),
  ),
);

it.live('with no offered bundle nothing is verified, read or taken', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({});
      const custody = yield* owner(registration, host, { bundle: null });
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Declined');
      if (assurance._tag === 'Declined') expect(assurance.reason._tag).toBe('NoBundle');
      expect(registration.acts()).toEqual([]);
      expect(host.asked()).toEqual([]);
    }),
  ),
);

it.live('a take racing a foreign take declines with the standing evidence instead of bidding', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0)), Effect.succeed(statusOf(heldBy('foreign-9', 0, 1, 1), 0))],
        take: [Effect.succeed({ _tag: 'Stale', expected: 0, standing: heldBy('foreign-9', 0, 1, 1) })],
      });
      const custody = yield* owner(registration, host);
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Declined');
      if (assurance._tag === 'Declined') expect(assurance.reason._tag).toBe('HeldElsewhere');
      expect(host.asked()).toEqual(['status', 'take:0', 'status']);
    }),
  ),
);

it.live('a refused take is declined with the host’s own refusal', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0))],
        take: [
          Effect.succeed({
            _tag: 'Refused',
            refusal: { _tag: 'AdmissionClosed', reason: 'the host is stopping' },
          }),
        ],
      });
      const custody = yield* owner(registration, host);
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Declined');
      if (assurance._tag === 'Declined') {
        expect(assurance.reason._tag).toBe('TakeRefused');
        if (assurance.reason._tag === 'TakeRefused') expect(assurance.reason.refusal._tag).toBe('AdmissionClosed');
      }
    }),
  ),
);

it.live('a host that answers nothing leaves custody undecided without taking', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.fail(new WireUnavailable({ kind: 'absent', reason: 'nothing is installed here', sent: false }))],
      });
      const custody = yield* owner(registration, host);
      const assurance = yield* custody.ensure();
      expect(assurance._tag).toBe('Declined');
      if (assurance._tag === 'Declined') {
        expect(assurance.reason._tag).toBe('HostUnreachable');
        if (assurance.reason._tag === 'HostUnreachable') expect(assurance.reason.failure._tag).toBe('WireUnavailable');
      }
      expect(host.asked()).toEqual(['status']);
    }),
  ),
);

it.live('a malformed host answer refuses the start with the decoder detail', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.fail(new WireUnreadable({ detail: 'Expected 9\n  at ["v"]' }))],
      });
      const custody = yield* owner(registration, host);
      const outcome = yield* custody.guarded().start(keyOf('op-unspoken'), launch);
      expect(outcome._tag).toBe('Refused');
      if (outcome._tag !== 'Refused') return;
      expect(outcome.refusal._tag).toBe('HostUnavailable');
      expect(outcome.refusal.reason).toContain('Expected 9 at ["v"]');
      expect(host.asked()).toEqual(['status']);
    }),
  ),
);

it.live('a start refused while nothing listens says so without a recovery act', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.fail(new WireUnavailable({ kind: 'absent', reason: 'nothing is installed here', sent: false }))],
      });
      const custody = yield* owner(registration, host);
      const outcome = yield* custody.guarded().start(keyOf('op-absent'), launch);
      expect(outcome._tag).toBe('Refused');
      if (outcome._tag !== 'Refused') return;
      expect(outcome.refusal._tag).toBe('HostUnavailable');
      expect(outcome.refusal.reason).toContain('absent: nothing is installed here');
      expect(outcome.refusal.reason).not.toContain('recovery');
    }),
  ),
);

it.live('a guarded start takes custody first and delegates the launch unchanged', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1)))],
        start: [Effect.succeed(started('op-live'))],
      });
      const custody = yield* owner(registration, host);
      const outcome = yield* custody.guarded().start(keyOf('op-live'), launch);
      expect(outcome._tag).toBe('Started');
      if (outcome._tag === 'Started') expect(outcome.execution.execution).toBe(ExecutionId.make('exec-live'));
      expect(host.asked()).toEqual(['status', 'take:0', 'start']);
    }),
  ),
);

it.live('a start refused for lost custody re-takes and tries the same key once', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({
        status: [Effect.succeed(statusOf(vacant(0, 0), 0)), Effect.succeed(statusOf(heldBy('floor-1', 0, 1, 1), 0))],
        take: [Effect.succeed(takeHeld(heldBy('floor-1', 0, 1, 1))), Effect.succeed(takeHeld(heldBy('floor-2', 0, 2, 2)))],
        start: [Effect.succeed(refusedUnauthorized('op-live')), Effect.succeed(started('op-live'))],
      });
      const custody = yield* owner(registration, host);
      const outcome = yield* custody.guarded().start(keyOf('op-live'), launch);
      expect(outcome._tag).toBe('Started');
      expect(host.asked()).toEqual(['status', 'take:0', 'start', 'status', 'take:1', 'start']);
    }),
  ),
);

it.live('a guarded start under a foreign holder never reaches the host', () =>
  run(
    Effect.gen(function* () {
      const standing = heldBy('foreign-9', 0, 4, 3);
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({ status: [Effect.succeed(statusOf(standing, 0))] });
      const custody = yield* owner(registration, host);
      const outcome = yield* custody.guarded().start(keyOf('op-live'), launch);
      expect(outcome._tag).toBe('Refused');
      if (outcome._tag === 'Refused') {
        expect(outcome.refusal._tag).toBe('Unauthorized');
        expect(outcome.refusal.reason).toContain('foreign-9');
      }
      expect(host.asked()).toEqual(['status']);
    }),
  ),
);

it.live('reads travel the guarded port untouched, with no custody assured', () =>
  run(
    Effect.gen(function* () {
      const registration = registrar(Effect.succeed(registered(publishedStamp())));
      const host = scripted({});
      const custody = yield* owner(registration, host, { bundle: null });
      const outcome = yield* Effect.result(custody.guarded().list({ limit: 1 }));
      expect(outcome._tag).toBe('Failure');
      expect(host.asked()).toEqual(['list']);
      expect(registration.acts()).toEqual([]);
    }),
  ),
);
