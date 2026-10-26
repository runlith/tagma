import type { World } from '@runlith/agent-tools/world';
import { resolveEnvironment, type CommandEnvironment, type CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { EffectiveEnvironment } from '@runlith/executions/protocol/execution';
import { NamespaceId, type IdentityWitness } from '@runlith/files/namespace';
import { witnessOf } from '@runlith/files/witness';
import { Effect, FileSystem, Option, Result } from 'effect';
import { uuidv7 } from 'uuidv7';
import { installationAnchor } from '../../installation/paths.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { environment } from '../../workspace/store/tables.js';
import {
  EnvironmentId,
  type EnvironmentIdentity,
  type EnvironmentVerdictFailure,
  type EnvironmentState,
} from '../../workspace/contract/wire/environments.js';
import type { EnvironmentBackend } from '../../workspace/contract/service/environments.js';
import { type EnvironmentStore, makeEnvironmentStore, type EnvironmentStoreFailure } from '../../workspace/store/environments.js';
import { environmentVerdictOf } from '../../workspace/environments/failure.js';

type HostProbe =
  | { readonly _tag: 'Witnessed'; readonly witness: IdentityWitness }
  | { readonly _tag: 'Absent'; readonly reason: string }
  | { readonly _tag: 'Unreadable'; readonly reason: string };

const boundEnvironment = (bound: ReadonlyMap<string, string>): CommandEnvironment => ({
  materialize: (request: CommandEnvironmentRequest): Effect.Effect<EffectiveEnvironment> =>
    Effect.sync(() => resolveEnvironment(bound, request)),
});

type Failure = EnvironmentVerdictFailure | EnvironmentStoreFailure;

const KIND = 'host';

export const makeHostEnvironment = Effect.fnUntraced(function* ({
  records,
  anchor,
  world,
}: {
  readonly records: EnvironmentStore;
  readonly anchor: string;
  readonly world: World;
}) {
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;

  const identity = Effect.fn('HostEnvironment.identity')(function* (): Effect.fn.Return<EnvironmentIdentity, Failure> {
    const registered = yield* units.read((unit) => records.singleton(KIND, unit));
    if (registered !== null) return registered;
    const minted: EnvironmentIdentity = {
      environmentId: EnvironmentId.make(uuidv7()),
      kind: KIND,
      namespaceId: NamespaceId.make(uuidv7()),
    };
    const adopted = yield* units.write(writes('HostEnvironment.adopted', [environment]), (unit) => records.adoptSingleton(minted, unit));
    if (adopted !== null) return adopted;
    return yield* Effect.fail<EnvironmentVerdictFailure>({
      _tag: 'EnvironmentRegistryUnavailable',
      reason: 'The host environment could not be registered: its storage address space already belongs to another environment.',
    });
  });

  const probe = Effect.fn('HostEnvironment.probe')(function* () {
    const info = yield* files.stat(anchor).pipe(
      Effect.map((stat) => ({ _tag: 'Stat' as const, stat })),
      Effect.catchTag('PlatformError', (error) =>
        Effect.succeed<HostProbe>(
          error.reason._tag === 'NotFound'
            ? { _tag: 'Absent', reason: `The installation directory ${anchor} is gone.` }
            : { _tag: 'Unreadable', reason: `The installation directory ${anchor} could not be read: ${error.message}` },
        ),
      ),
    );
    if (info._tag !== 'Stat') return info;
    const { stat } = info;
    const witness = witnessOf({
      type: stat.type,
      inode: Option.getOrNull(stat.ino),
      birthtime: Option.isNone(stat.birthtime) ? null : stat.birthtime.value.getTime(),
    });
    if (Result.isFailure(witness)) {
      return {
        _tag: 'Unreadable',
        reason:
          witness.failure === 'inode'
            ? `The filesystem gave ${anchor} no usable inode.`
            : `The filesystem gave ${anchor} no usable birth time.`,
      } satisfies HostProbe;
    }
    return { _tag: 'Witnessed', witness: witness.success } satisfies HostProbe;
  });

  const backend: EnvironmentBackend = {
    kind: KIND,
    hold: { _tag: 'Intrinsic' },
    state: Effect.fn('HostEnvironment.state')(
      function* (): Effect.fn.Return<EnvironmentState, Failure> {
        const known = yield* identity();
        const capabilities = {
          files: world.files !== undefined,
          exec: world.exec !== undefined,
          heldExecution: true,
          egress: world.egress !== undefined,
        };
        const probed = yield* probe();
        if (probed._tag !== 'Witnessed') {
          return {
            identity: known,
            binding: null,
            availability: probed._tag === 'Absent' ? 'unavailable' : 'unknown',
            capabilities,
            reason: probed.reason,
          };
        }
        return {
          identity: known,
          binding: { ...known, identityWitness: probed.witness },
          availability: 'available',
          capabilities,
          reason: null,
        };
      },
      (work) => Effect.mapError(work, environmentVerdictOf),
    ),
    open: () => Effect.sync(() => ({ world, commandEnvironment: boundEnvironment(snapshot()) })),
    activate: (binding) =>
      Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'ActivationUnsupported',
        kind: KIND,
        binding,
        capability: 'activation',
        reason: 'The host is intrinsic to this installation: it is never inactive, so nothing activates it.',
      }),
  };
  return backend;
});

function snapshot(): ReadonlyMap<string, string> {
  const bound = new Map<string, string>();
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) bound.set(name, value);
  }
  return bound;
}

export const hostEnvironment = Effect.fnUntraced(function* (world: World) {
  const { db, path } = yield* MachineStore;
  return yield* makeHostEnvironment({ records: makeEnvironmentStore({ db }), anchor: installationAnchor(path), world });
});
