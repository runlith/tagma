import { createHash } from 'node:crypto';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Effect, Fiber, FileSystem, Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { Installation } from '../../../installation/contract/wire/manifest.js';
import type { SandboxImage, GuestReceipt as Receipt } from '../../contract/wire/sandbox.js';
import { sealArchive } from '../../trees/archive.js';
import { SandboxUnavailable } from '../../contract/service/sandboxes.js';
import type { GuestBackend } from '../../contract/service/backends.js';
import { dockerGuestWorld } from './world.js';
import {
  guestRunCommand,
  labelFlags,
  workloadMismatch,
  KIND_LABEL,
  INSTALLATION_LABEL,
  type GuestConfiguration,
  type GuestKind,
  type GuestMarks,
} from './container.js';
import { buildGuestImage, dockerSaid, namedImage } from './image.js';
import { GUEST_USER, GUEST_TREE } from './layout.js';
import type { GuestUnavailable } from './wire.js';
import { transfer } from './transfer.js';

export const SANDBOX_GUEST_PREFIX = 'tagma-sandbox-';

const hostPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const hostRuntime = Layer.mergeAll(hostPlatform, BunChildProcessSpawner.layer.pipe(Layer.provide(hostPlatform)));

type Docker = Extract<Receipt, { backend: 'docker' }>;

const ABSENT = /no such (container|volume|network|object)|not found/i;

const READER_LIMITS = { pids: 64, memory: '256m', cpus: '1' } as const;

export const installationMark = (installation: string): string => createHash('sha256').update(installation).digest('hex').slice(0, 8);

export const makeDockerGuests = (input: { readonly installation: string; readonly closure: Installation | undefined }): GuestBackend => {
  const { installation, closure } = input;
  const mark = installationMark(installation);
  const prefix = `${SANDBOX_GUEST_PREFIX}${mark}-`;

  const owned = (kind: GuestKind): readonly string[] => [
    '--filter',
    `label=${INSTALLATION_LABEL}=${mark}`,
    '--filter',
    `label=${KIND_LABEL}=${kind}`,
  ];

  const own = (receipt: Receipt): Docker => {
    if (receipt.backend !== 'docker') {
      throw new Error(`The docker runtime was handed a ${receipt.backend} receipt.`);
    }
    return receipt;
  };

  const said = <A>(
    sandbox: string,
    work: Effect.Effect<A, GuestUnavailable, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>,
  ) => Effect.provide(work, hostRuntime).pipe(Effect.mapError((failure) => new SandboxUnavailable({ sandbox, reason: failure.reason })));

  const engine = (sandbox: string, argv: readonly string[], doing: string) =>
    said(sandbox, dockerSaid(argv, doing, argv[0] === 'exec' ? { timeout: null } : {}));

  const crossing =
    (sandbox: string, doing: string) =>
    <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, SandboxUnavailable, R> =>
      Effect.catch(work, (cause: E) =>
        Effect.fail(
          cause instanceof SandboxUnavailable
            ? cause
            : new SandboxUnavailable({ sandbox, reason: `${doing}: ${String((cause as Error).message ?? cause)}` }),
        ),
      );

  const compatible = Effect.fnUntraced(function* (expected: SandboxImage, digest: string) {
    if (digest !== expected.digest) {
      return yield* new SandboxUnavailable({ sandbox: digest, reason: `its image differs from the recorded ${expected.digest}` });
    }
    const actual = yield* said(digest, namedImage(digest));
    if (actual.image.digest !== expected.digest || actual.image.revision !== expected.revision) {
      return yield* new SandboxUnavailable({ sandbox: digest, reason: 'its image identity differs from the prepared manifest' });
    }
  });

  return {
    backend: 'docker',

    receipt: (sandbox) => {
      const name = `${prefix}${sandbox}`;
      return { backend: 'docker', container: name, volume: name };
    },

    identity: Effect.fn('DockerGuests.identity')(function* () {
      const image = yield* said('image', buildGuestImage(closure));
      const platform = yield* engine('engine', ['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}'], 'read the engine platform');
      if (platform.code !== 0) {
        return yield* new SandboxUnavailable({
          sandbox: 'engine',
          reason: 'the engine did not say what platform it runs',
        });
      }
      return { image, platform: platform.output.trim() };
    }),

    create: Effect.fn('DockerGuests.create')(function* (receipt, plan, image) {
      const docker = own(receipt);
      const marks: GuestMarks = { installation: mark, kind: 'workload', subject: plan.sandbox };

      yield* compatible(image, image.digest);
      const volume = yield* engine(plan.sandbox, ['volume', 'create', ...labelFlags(marks), docker.volume], 'create the sandbox volume');
      if (volume.code !== 0) {
        return yield* new SandboxUnavailable({
          sandbox: plan.sandbox,
          reason: `its volume could not be created: ${volume.output.trim()}`,
        });
      }
      const started = yield* engine(
        plan.sandbox,
        guestRunCommand({
          name: docker.container,
          image: image.digest === '' ? image.reference : image.digest,
          volume: docker.volume,
          limits: plan.limits,
          marks,
          network: 'none',
        }),
        'start the sandbox guest',
      );
      if (started.code !== 0) {
        return yield* new SandboxUnavailable({
          sandbox: plan.sandbox,
          reason: `its guest would not start: ${started.output.trim()}`,
        });
      }
    }),

    unpack: (receipt, archive) => {
      const docker = own(receipt);
      return transfer(docker.container, (progress) =>
        Effect.scoped(
          Effect.gen(function* () {
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
            const extract = yield* spawner.spawn(
              ChildProcess.make(
                'docker',
                ['exec', '-i', '--user', GUEST_USER, '--workdir', GUEST_TREE, docker.container, 'tar', '-xf', '-'],
                { stdin: archive.pipe(Stream.tap(() => progress)), stdout: 'pipe', stderr: 'pipe' },
              ),
            );
            const [output, code] = yield* Effect.all([extract.all.pipe(Stream.decodeText(), Stream.mkString), extract.exitCode], {
              concurrency: 'unbounded',
            });
            if (Number(code) !== 0) {
              return yield* new SandboxUnavailable({
                sandbox: docker.container,
                reason: `its tree could not be unpacked in the guest: ${output.trim()}`,
              });
            }
          }),
        ),
      ).pipe(
        Effect.provide(hostRuntime),
        crossing(docker.container, 'its tree could not be unpacked'),
        Effect.withSpan('DockerGuests.unpack'),
      );
    },

    run: (receipt, argv) => {
      const docker = own(receipt);
      return engine(
        docker.container,
        ['exec', '--user', GUEST_USER, '--workdir', GUEST_TREE, docker.container, ...argv],
        'run a command in the guest',
      );
    },

    stop: (receipt) => {
      const docker = own(receipt);
      return Effect.flatMap(engine(docker.container, ['stop', docker.container], 'stop the sandbox guest'), (said) =>
        said.code === 0
          ? Effect.void
          : Effect.fail(
              new SandboxUnavailable({ sandbox: docker.container, reason: `its guest could not be stopped (Docker exit ${said.code})` }),
            ),
      );
    },

    inspect: Effect.fn('DockerGuests.inspect')(function* (receipt, expected) {
      const docker = own(receipt);

      const said = yield* engine(
        docker.container,
        ['container', 'inspect', '--format', '{{json .}}', docker.container],
        'read the sandbox guest',
      );
      if (said.code !== 0) {
        if (ABSENT.test(said.output)) return { status: 'gone' as const, image: null, mismatch: null };
        return yield* new SandboxUnavailable({
          sandbox: docker.container,
          reason: `the engine could not be asked about its guest: ${said.output.trim()}`,
        });
      }
      const configuration = readConfiguration(said.output);
      if (configuration === null) {
        return yield* new SandboxUnavailable({
          sandbox: docker.container,
          reason: `the engine described its guest in a shape this server cannot read: ${said.output.trim()}`,
        });
      }
      if (expected !== undefined) {
        yield* compatible(expected.image, configuration.image);
      }
      return {
        status: configuration.status === 'running' ? ('running' as const) : ('stopped' as const),
        image: configuration.image,
        mismatch: expected === undefined ? null : workloadMismatch(configuration.guest, { limits: expected.limits, volume: docker.volume }),
      };
    }),

    start: (receipt) => {
      const docker = own(receipt);
      return Effect.flatMap(engine(docker.container, ['start', docker.container], 'resume the sandbox guest'), (said) =>
        said.code === 0
          ? Effect.void
          : Effect.fail(
              new SandboxUnavailable({
                sandbox: docker.container,
                reason: `its guest would not resume: ${said.output.trim()}`,
              }),
            ),
      );
    },

    world: (receipt) => {
      const docker = own(receipt);
      return dockerGuestWorld({ container: docker.container }).pipe(
        Effect.mapError((failure) => new SandboxUnavailable({ sandbox: docker.container, reason: failure.reason })),
      );
    },

    sealedWorld: Effect.fn('DockerGuests.sealedWorld')(function* (receipt, image) {
      const docker = own(receipt);
      const name = `${docker.container}-read-${createHash('sha256')
        .update(`${yield* Clock.currentTimeMillis}${Math.random()}`)
        .digest('hex')
        .slice(0, 10)}`;
      return yield* Effect.acquireRelease(
        Effect.gen(function* () {
          yield* compatible(image, image.digest);
          const started = yield* engine(
            docker.container,
            guestRunCommand({
              name,
              image: image.digest === '' ? image.reference : image.digest,
              volume: docker.volume,
              limits: READER_LIMITS,
              marks: { installation: mark, kind: 'reader', subject: docker.container },
              network: 'none',
              readOnlyTree: true,
            }),
            'start a reader over the sandbox tree',
          );
          if (started.code !== 0) {
            return yield* new SandboxUnavailable({
              sandbox: docker.container,
              reason: `a reader over its tree would not start: ${started.output.trim()}`,
            });
          }
          return name;
        }),
        () =>
          engine(name, ['rm', '--force', '--volumes', name], 'remove the reader').pipe(
            Effect.flatMap((ended) =>
              ended.code === 0 || ABSENT.test(ended.output)
                ? Effect.void
                : Effect.logWarning('the sandbox reader was not removed', { container: name, reason: ended.output.trim() }),
            ),
            Effect.catchTag('SandboxUnavailable', (failure) =>
              Effect.logWarning('the sandbox reader was not removed', { container: name, reason: failure.reason }),
            ),
          ),
      ).pipe(
        Effect.flatMap((container) =>
          dockerGuestWorld({ container }).pipe(
            Effect.mapError((failure) => new SandboxUnavailable({ sandbox: docker.container, reason: failure.reason })),
          ),
        ),
      );
    }),

    export: (receipt, into) => {
      const docker = own(receipt);
      return transfer(docker.container, (progress) =>
        Effect.scoped(
          Effect.gen(function* () {
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
            const copy = yield* spawner.spawn(
              ChildProcess.make('docker', ['cp', `${docker.container}:${GUEST_TREE}/.`, '-'], {
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
              }),
            );
            const stderr = yield* Effect.forkScoped(copy.stderr.pipe(Stream.decodeText(), Stream.mkString));
            yield* sealArchive(copy.stdout.pipe(Stream.tap(() => progress)), into).pipe(
              Effect.tapError(() =>
                copy.kill({ killSignal: 'SIGKILL' }).pipe(
                  Effect.catchTag('PlatformError', (failure) =>
                    Effect.logWarning('the refused archive copy could not be killed', {
                      container: docker.container,
                      reason: failure.message,
                    }),
                  ),
                ),
              ),
              Effect.mapError(
                (failure) =>
                  new SandboxUnavailable({
                    sandbox: docker.container,
                    reason: `its tree could not be exported: ${failure.message}`,
                  }),
              ),
            );
            const [refused, code] = yield* Effect.all([Fiber.join(stderr), copy.exitCode]);
            if (Number(code) !== 0) {
              return yield* new SandboxUnavailable({
                sandbox: docker.container,
                reason: `its tree could not be exported: ${refused.trim()}`,
              });
            }
          }),
        ),
      ).pipe(
        Effect.provide(hostRuntime),
        crossing(docker.container, 'its tree could not be exported'),
        Effect.withSpan('DockerGuests.export'),
      );
    },

    remove: Effect.fn('DockerGuests.remove')(function* (receipt) {
      const docker = own(receipt);

      const gone = yield* engine(docker.container, ['rm', '--force', '--volumes', docker.container], 'remove the sandbox guest');
      if (gone.code !== 0 && !ABSENT.test(gone.output)) {
        return yield* new SandboxUnavailable({
          sandbox: docker.container,
          reason: `its guest could not be removed: ${gone.output.trim()}`,
        });
      }
      const dropped = yield* engine(docker.container, ['volume', 'rm', '--force', docker.volume], 'remove the sandbox volume');
      if (dropped.code !== 0 && !ABSENT.test(dropped.output)) {
        return yield* new SandboxUnavailable({
          sandbox: docker.container,
          reason: `its data could not be removed: ${dropped.output.trim()}`,
        });
      }
    }),

    receipts: Effect.fn('DockerGuests.receipts')(function* () {
      const containers = yield* engine(
        'engine',
        ['ps', '--all', ...owned('workload'), '--format', '{{.Names}}'],
        'list the sandbox guests',
      );
      const volumes = yield* engine('engine', ['volume', 'ls', ...owned('workload'), '--format', '{{.Name}}'], 'list the sandbox volumes');
      const readers = yield* engine(
        'engine',
        ['ps', '--all', ...owned('reader'), '--format', '{{.Names}}'],
        'list the readers over sandbox trees',
      );
      if (containers.code !== 0 || volumes.code !== 0 || readers.code !== 0) return null;
      const names = new Set([...lines(containers.output), ...lines(volumes.output), ...lines(readers.output)]);
      return [...names].map((name): Receipt => ({ backend: 'docker', container: name, volume: name }));
    }),
  };
};

function readConfiguration(said: string): { status: string; image: string; guest: GuestConfiguration } | null {
  let document: unknown;
  try {
    document = JSON.parse(said);
  } catch {
    return null;
  }
  const root = record(document);
  const host = record(root?.HostConfig);
  const config = record(root?.Config);
  const state = record(root?.State);
  if (root === null || host === null || config === null || state === null) return null;
  return {
    status: text(state.Status),
    image: text(root.Image),
    guest: {
      network: text(host.NetworkMode),
      user: text(config.User),
      readOnlyRoot: host.ReadonlyRootfs === true,
      capabilitiesDropped: strings(host.CapDrop),
      securityOptions: strings(host.SecurityOpt),
      pids: number(host.PidsLimit),
      memoryBytes: number(host.Memory),
      nanoCpus: number(host.NanoCpus),
      tmpfs: Object.keys(record(host.Tmpfs) ?? {}),
      mounts: Array.isArray(root.Mounts)
        ? root.Mounts.map((mount) => {
            const named = record(mount);
            return {
              type: text(named?.Type),
              source: text(named?.Name) === '' ? text(named?.Source) : text(named?.Name),
              destination: text(named?.Destination),
            };
          })
        : [],
      labels: Object.fromEntries(Object.entries(record(config.Labels) ?? {}).map(([key, value]) => [key, text(value)])),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(text).filter((word) => word !== '') : [];
}

function lines(said: string): readonly string[] {
  return said
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}
