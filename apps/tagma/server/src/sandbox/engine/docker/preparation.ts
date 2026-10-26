import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { PreparationReceipt, ReadinessAnswer } from '../../contract/wire/preparedTree.js';
import type { Installation } from '../../../installation/contract/wire/manifest.js';
import { sealArchive } from '../../trees/archive.js';
import { PreparedTreeUnavailable } from '../../contract/service/preparedTrees.js';
import type { PreparationBackend, TreeArchive } from '../../contract/service/backends.js';
import { guestRunCommand, labelFlags, KIND_LABEL, INSTALLATION_LABEL, type GuestKind, type GuestMarks } from './container.js';
import { buildGuestImage, dockerSaid, namedImage } from './image.js';
import { GUEST_TREE, GUEST_USER } from './layout.js';
import { closeGrant, openGrant } from './network.js';
import type { GuestUnavailable } from './wire.js';
import { installationMark } from './backend.js';
import { transfer } from './transfer.js';

export const PREPARATION_PREFIX = 'tagma-build-';

const hostPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const hostRuntime = Layer.mergeAll(hostPlatform, BunChildProcessSpawner.layer.pipe(Layer.provide(hostPlatform)));

type Docker = Extract<PreparationReceipt, { backend: 'docker' }>;

const ABSENT = /no such (container|volume|network|object)|not found/i;

export const makeDockerPreparation = (input: {
  readonly installation: string;
  readonly closure: Installation | undefined;
}): PreparationBackend => {
  const { installation, closure } = input;
  const mark = installationMark(installation);
  const prefix = `${PREPARATION_PREFIX}${mark}-`;

  const receipt = (build: string): PreparationReceipt => {
    const name = `${prefix}${build}`;
    return {
      backend: 'docker',
      container: name,
      volume: name,
      network: `${name}-net`,
      proxy: `${name}-proxy`,
      check: `${name}-check`,
    };
  };

  const buildOf = (name: string): string | null => {
    if (!name.startsWith(prefix)) return null;
    const said = name.slice(prefix.length);
    for (const suffix of ['-net', '-proxy', '-check']) {
      if (said.endsWith(suffix)) return said.slice(0, said.length - suffix.length);
    }
    return said;
  };

  const marksOf = (build: string, kind: GuestKind): GuestMarks => ({ installation: mark, kind, subject: build });

  const owned = (): readonly string[] => ['--filter', `label=${INSTALLATION_LABEL}=${mark}`];

  const own = (receipt: PreparationReceipt): Docker => {
    if (receipt.backend !== 'docker') {
      throw new Error(`The docker preparation backend was handed a ${receipt.backend} receipt.`);
    }
    return receipt;
  };

  const crossing =
    (preparedTree: string, doing: string) =>
    <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, PreparedTreeUnavailable, R> =>
      Effect.catch(work, (cause: E) =>
        Effect.fail(
          cause instanceof PreparedTreeUnavailable
            ? cause
            : new PreparedTreeUnavailable({
                preparedTree,
                reason: `${doing}: ${String((cause as Error).message ?? cause)}`,
              }),
        ),
      );

  const said = <A>(
    build: string,
    work: Effect.Effect<A, GuestUnavailable, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>,
  ) =>
    Effect.provide(work, hostRuntime).pipe(
      Effect.mapError((failure) => new PreparedTreeUnavailable({ preparedTree: build, reason: failure.reason })),
    );

  const engine = (build: string, argv: readonly string[], doing: string) =>
    said(build, dockerSaid(argv, doing, argv[0] === 'exec' ? { timeout: null } : {}));

  const into = (container: string, archive: TreeArchive) =>
    transfer(container, (progress) =>
      Effect.scoped(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const extract = yield* spawner.spawn(
            ChildProcess.make('docker', ['exec', '-i', '--user', GUEST_USER, '--workdir', GUEST_TREE, container, 'tar', '-xf', '-'], {
              stdin: archive.pipe(Stream.tap(() => progress)),
              stdout: 'pipe',
              stderr: 'pipe',
            }),
          );
          const [output, code] = yield* Effect.all([extract.all.pipe(Stream.decodeText(), Stream.mkString), extract.exitCode], {
            concurrency: 'unbounded',
          });
          if (Number(code) !== 0) {
            return yield* new PreparedTreeUnavailable({
              preparedTree: container,
              reason: `a tree could not be unpacked in the guest: ${output.trim()}`,
            });
          }
        }),
      ),
    ).pipe(Effect.provide(hostRuntime), crossing(container, 'a tree could not be unpacked'), Effect.withSpan('DockerPreparation.into'));

  return {
    backend: 'docker',

    receipt,

    target: Effect.fn('DockerPreparation.target')(function* (wanted) {
      const version = yield* said(
        'engine',
        dockerSaid(['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}'], 'read the engine platform'),
      );
      if (version.code !== 0) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: 'engine',
          reason: 'the engine did not say what platform it runs',
        });
      }
      const platform = version.output.trim();
      const target =
        wanted.image === undefined
          ? { image: yield* said('image', buildGuestImage(closure)), platform }
          : yield* said(wanted.image, namedImage(wanted.image));
      if (target.platform !== platform) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: target.image.reference,
          reason: `it is built for ${target.platform}, and this engine runs ${platform}`,
        });
      }
      if (wanted.platform !== undefined && wanted.platform !== target.platform) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: target.image.reference,
          reason: `${wanted.platform} was asked for, and the target is ${target.platform}`,
        });
      }
      return target;
    }),

    open: Effect.fn('DockerPreparation.open')(function* (receipt, plan) {
      const docker = own(receipt);
      const marks = marksOf(plan.build, 'builder');

      const grant = yield* said(plan.build, openGrant(plan.network, { network: docker.network, proxy: docker.proxy }, marks, plan.image));
      const volume = yield* engine(plan.build, ['volume', 'create', ...labelFlags(marks), docker.volume], 'create the builder volume');
      if (volume.code !== 0) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: plan.build,
          reason: `its volume could not be created: ${volume.output.trim()}`,
        });
      }
      const started = yield* engine(
        plan.build,
        guestRunCommand({
          name: docker.container,
          image: plan.image.digest === '' ? plan.image.reference : plan.image.digest,
          volume: docker.volume,
          limits: plan.limits,
          marks,
          network: grant.network,
          environment: grant.environment,
        }),
        'start the builder',
      );
      if (started.code !== 0) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: plan.build,
          reason: `its builder would not start: ${started.output.trim()}`,
        });
      }
    }),

    unpack: (receipt, archive) => into(own(receipt).container, archive),

    run: (receipt, argv) => {
      const docker = own(receipt);
      return engine(
        docker.container,
        ['exec', '--user', GUEST_USER, '--workdir', GUEST_TREE, docker.container, ...argv],
        'run a command in the builder',
      );
    },

    revoke: (receipt) => {
      const docker = own(receipt);
      return said(docker.container, closeGrant({ network: docker.network, proxy: docker.proxy }, docker.container));
    },

    seal: Effect.fn('DockerPreparation.seal')(function* (receipt, into) {
      const docker = own(receipt);

      const stopped = yield* engine(docker.container, ['stop', docker.container], 'stop the builder');
      if (stopped.code !== 0 && !ABSENT.test(stopped.output)) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: docker.container,
          reason: `its builder could not be stopped: ${stopped.output.trim()}`,
        });
      }
      return yield* transfer(docker.container, (progress) =>
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
            const [seal, refused, code] = yield* Effect.all(
              [
                sealArchive(copy.stdout.pipe(Stream.tap(() => progress)), into),
                copy.stderr.pipe(Stream.decodeText(), Stream.mkString),
                copy.exitCode,
              ],
              { concurrency: 'unbounded' },
            );
            if (Number(code) !== 0) {
              return yield* new PreparedTreeUnavailable({
                preparedTree: docker.container,
                reason: `its tree could not be sealed: ${refused.trim()}`,
              });
            }
            return seal;
          }),
        ),
      ).pipe(Effect.provide(hostRuntime), crossing(docker.container, 'its tree could not be sealed'));
    }),

    check: Effect.fn('DockerPreparation.check')(function* (receipt, plan, archive, commands) {
      const docker = own(receipt);
      const marks = marksOf(plan.build, 'readiness');

      const volume = yield* engine(plan.build, ['volume', 'create', ...labelFlags(marks), docker.check], 'create the readiness volume');
      if (volume.code !== 0) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: plan.build,
          reason: `its readiness copy could not be made: ${volume.output.trim()}`,
        });
      }
      const started = yield* engine(
        plan.build,
        guestRunCommand({
          name: docker.check,
          image: plan.image.digest === '' ? plan.image.reference : plan.image.digest,
          volume: docker.check,
          limits: plan.limits,
          marks,
          network: 'none',
        }),
        'start the readiness copy',
      );
      if (started.code !== 0) {
        return yield* new PreparedTreeUnavailable({
          preparedTree: plan.build,
          reason: `its readiness copy would not start: ${started.output.trim()}`,
        });
      }
      yield* into(docker.check, archive);
      const results: ReadinessAnswer[] = [];
      for (const command of commands) {
        const said = yield* engine(
          plan.build,
          ['exec', '--user', GUEST_USER, '--workdir', GUEST_TREE, docker.check, ...command],
          'run a readiness command',
        );
        results.push({ command, code: said.code, output: tail(said.output) });
        if (said.code !== 0) break;
      }
      return results;
    }),

    close: Effect.fn('DockerPreparation.close')(function* (receipt) {
      const docker = own(receipt);

      for (const container of [docker.container, docker.check]) {
        const gone = yield* engine(container, ['rm', '--force', '--volumes', container], 'remove a build guest');
        if (gone.code !== 0 && !ABSENT.test(gone.output)) {
          return yield* new PreparedTreeUnavailable({
            preparedTree: container,
            reason: `it could not be removed: ${gone.output.trim()}`,
          });
        }
        const dropped = yield* engine(container, ['volume', 'rm', '--force', container], 'remove a build volume');
        if (dropped.code !== 0 && !ABSENT.test(dropped.output)) {
          return yield* new PreparedTreeUnavailable({
            preparedTree: container,
            reason: `its data could not be removed: ${dropped.output.trim()}`,
          });
        }
      }
      yield* said(docker.container, closeGrant({ network: docker.network, proxy: docker.proxy }, null));
    }),

    receipts: Effect.fn('DockerPreparation.receipts')(function* () {
      const builds = new Set<string>();
      const asked = [
        { argv: ['ps', '--all', ...owned(), '--format', '{{.Names}}'], doing: 'list the build guests' },
        { argv: ['volume', 'ls', ...owned(), '--format', '{{.Name}}'], doing: 'list the build volumes' },
        { argv: ['network', 'ls', ...owned(), '--format', '{{.Name}}'], doing: 'list the build networks' },
      ];
      for (const { argv, doing } of asked) {
        const said = yield* engine('engine', argv, doing);
        if (said.code !== 0) return null;
        for (const name of lines(said.output)) {
          const build = buildOf(name);
          if (build !== null) builds.add(build);
        }
      }
      return [...builds].map((build) => receipt(build));
    }),
  };
};

function tail(output: string): string {
  const said = output.trim();
  return said.length <= 4000 ? said : `…${said.slice(said.length - 4000)}`;
}

function lines(said: string): readonly string[] {
  return said
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name !== '' && name !== '<no value>');
}
