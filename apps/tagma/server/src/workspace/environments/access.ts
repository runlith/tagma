import { Effect } from 'effect';
import { sameWitness } from '@runlith/files/witness';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import type {
  EnvironmentAvailability,
  EnvironmentBinding,
  EnvironmentConsumer,
  EnvironmentIdentity,
  EnvironmentKind,
  EnvironmentVerdictFailure,
  EnvironmentInput,
  EnvironmentState,
  EnvironmentUseEvidence,
  EnvironmentUseId,
  EnvironmentCapabilities,
  EnvironmentUseReceipt,
} from '../contract/wire/environments.js';
import {
  Environments,
  EnvironmentBackends,
  type AcquiredEnvironment,
  type EnvironmentBackend,
  type EnvironmentOpenLost,
  type EnvironmentOpenRefused,
} from '../contract/service/environments.js';
import type { EnvironmentUses } from './uses.js';
import { environmentVerdictOf } from './failure.js';
import { environmentUseWrites as using } from '../store/environmentUses.js';

type WitnessedEnvironment = {
  readonly binding: EnvironmentBinding;
  readonly availability: EnvironmentAvailability;
  readonly capabilities: EnvironmentCapabilities;
  readonly reason: string | null;
};

function names(identity: EnvironmentIdentity, binding: EnvironmentBinding): boolean {
  return binding.environmentId === identity.environmentId && binding.kind === identity.kind && binding.namespaceId === identity.namespaceId;
}

function elsewhere(identity: EnvironmentIdentity, binding: EnvironmentBinding): string {
  return `The environment answering here is ${identity.environmentId} of kind ${identity.kind} in namespace ${identity.namespaceId}; the binding names ${binding.environmentId} of kind ${binding.kind} in namespace ${binding.namespaceId}.`;
}

function against(state: EnvironmentState, binding: EnvironmentBinding): EnvironmentState {
  if (!names(state.identity, binding)) {
    return { ...state, availability: 'unavailable', reason: elsewhere(state.identity, binding) };
  }
  if (state.binding === null) return state;
  const current = state.binding.identityWitness;
  const held = binding.identityWitness;
  if (!sameWitness(current, held)) {
    return {
      ...state,
      availability: 'replaced',
      reason: 'The backend answers for a different object than the binding was taken over.',
    };
  }
  return state;
}

export type EnvironmentLedger = Environments['Service'];

export const makeEnvironmentLedger = Effect.fnUntraced(function* ({ uses }: { readonly uses: EnvironmentUses }) {
  const backends = yield* EnvironmentBackends;
  const units = yield* MachineUnits;

  const generations = new Map<string, number>();

  const inspect = Effect.fn('EnvironmentLedger.inspect')(function* (
    kind: EnvironmentKind,
    options: { readonly binding?: EnvironmentBinding } = {},
  ) {
    const provider = yield* bound(kind, options.binding ?? null, 'access');
    const state = yield* provider.state(options.binding);
    return options.binding === undefined ? state : against(state, options.binding);
  });

  const acquireActive = Effect.fn('EnvironmentLedger.acquireActive')(function* (request: EnvironmentInput) {
    const provider = yield* bound(request.binding.kind, request.binding, 'access');
    const { binding, capabilities } = yield* checked(provider, request.binding);
    for (const capability of request.requires) {
      if (!capabilities[capability]) {
        return yield* Effect.fail<EnvironmentVerdictFailure>({
          _tag: 'ActivationUnsupported',
          kind: binding.kind,
          binding,
          capability,
          reason: `The ${binding.kind} environment ${binding.environmentId} does not serve ${capability}.`,
        });
      }
    }
    const receipt = yield* reserve(provider, binding, request.consumer);
    const resources = yield* provider.open(binding).pipe(
      Effect.catchTag('EnvironmentOpenRefused', (refused) => abandon(receipt, refused, true)),
      Effect.catchTag('EnvironmentOpenLost', (lost) => abandon(receipt, lost, false)),
    );
    const use = receipt._tag === 'Retained' ? yield* activated(receipt.use.useId) : receipt;
    const accessGeneration = (generations.get(binding.environmentId) ?? 0) + 1;
    generations.set(binding.environmentId, accessGeneration);
    return {
      binding,
      accessGeneration,
      world: resources.world,
      commandEnvironment: resources.commandEnvironment,
      use,
    } satisfies AcquiredEnvironment;
  });

  const activate = Effect.fn('EnvironmentLedger.activate')(function* (binding: EnvironmentBinding) {
    const provider = yield* bound(binding.kind, binding, 'activation');
    const standing = yield* witnessed(provider, binding);
    return yield* provider.activate(standing.binding);
  });

  const release = Effect.fn('EnvironmentLedger.release')(
    (unit: WriteUnit<'machine'>, useId: EnvironmentUseId, consumer: EnvironmentConsumer, evidence: EnvironmentUseEvidence) =>
      uses.release(unit, useId, consumer, evidence),
  );

  const releaseUse = Effect.fn('EnvironmentLedger.releaseUse')(
    (useId: EnvironmentUseId, consumer: EnvironmentConsumer, evidence: EnvironmentUseEvidence) =>
      write((unit) => uses.release(unit, useId, consumer, evidence)),
  );

  const heldUses = Effect.fn('EnvironmentLedger.heldUses')((consumer: EnvironmentConsumer) =>
    Effect.mapError(
      units.read((unit) => uses.heldBy(unit, consumer)),
      environmentVerdictOf,
    ),
  );

  function write<A>(
    work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, EnvironmentVerdictFailure>,
  ): Effect.Effect<A, EnvironmentVerdictFailure> {
    return Effect.mapError(units.write(using, work), environmentVerdictOf);
  }

  const bound = Effect.fn('EnvironmentLedger.bound')(function* (
    kind: EnvironmentKind,
    binding: EnvironmentBinding | null,
    capability: 'access' | 'activation',
  ) {
    const provider = backends.bound(kind);
    if (provider !== null) return provider;
    return yield* Effect.fail<EnvironmentVerdictFailure>({
      _tag: 'ActivationUnsupported',
      kind,
      binding,
      capability,
      reason: `This installation binds no backend for ${kind} environments; the ${kind} runtime answers to its own owner and nothing here stands in for it.`,
    });
  });

  const checked = Effect.fn('EnvironmentLedger.checked')(function* (
    provider: EnvironmentBackend,
    binding: EnvironmentBinding,
  ): Effect.fn.Return<WitnessedEnvironment, EnvironmentVerdictFailure> {
    const state = yield* witnessed(provider, binding);
    if (state.availability !== 'available') {
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'EnvironmentUnavailable',
        binding,
        witnessed: true,
        reason: state.reason ?? `The ${binding.kind} environment ${binding.environmentId} is not serving.`,
      });
    }
    return state;
  });

  const witnessed = Effect.fn('EnvironmentLedger.witnessed')(function* (
    provider: EnvironmentBackend,
    binding: EnvironmentBinding,
  ): Effect.fn.Return<WitnessedEnvironment, EnvironmentVerdictFailure> {
    const read = yield* provider.state({
      environmentId: binding.environmentId,
      kind: binding.kind,
      namespaceId: binding.namespaceId,
    });
    if (!names(read.identity, binding)) {
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'EnvironmentUnavailable',
        binding,
        witnessed: false,
        reason: elsewhere(read.identity, binding),
      });
    }
    const state = against(read, binding);
    if (state.availability === 'replaced' && state.binding !== null) {
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'EnvironmentReplaced',
        binding,
        current: state.binding.identityWitness,
      });
    }
    if (state.binding === null || state.availability === 'unknown') {
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'EnvironmentUnavailable',
        binding,
        witnessed: false,
        reason: state.reason ?? `The ${binding.kind} environment ${binding.environmentId} answered for no identity.`,
      });
    }
    if (!names(state.binding, binding)) {
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'EnvironmentUnavailable',
        binding,
        witnessed: false,
        reason: elsewhere(state.binding, binding),
      });
    }
    return { binding: state.binding, availability: state.availability, capabilities: state.capabilities, reason: state.reason };
  });

  const reserve = Effect.fn('EnvironmentLedger.reserve')(function* (
    provider: EnvironmentBackend,
    binding: EnvironmentBinding,
    consumer: EnvironmentConsumer,
  ): Effect.fn.Return<EnvironmentUseReceipt, EnvironmentVerdictFailure> {
    const hold = provider.hold;
    if (hold._tag === 'Intrinsic') return { _tag: 'Intrinsic', binding };
    const use = yield* write((unit) => Effect.flatMap(hold.admit(unit, binding), () => uses.reserve(unit, binding, consumer)));
    return { _tag: 'Retained', use };
  });

  const activated = Effect.fn('EnvironmentLedger.activated')(function* (
    useId: EnvironmentUseId,
  ): Effect.fn.Return<EnvironmentUseReceipt, EnvironmentVerdictFailure> {
    return { _tag: 'Retained', use: yield* write((unit) => uses.activate(unit, useId)) };
  });

  const abandon = Effect.fn('EnvironmentLedger.abandon')(function* (
    receipt: EnvironmentUseReceipt,
    failed: EnvironmentOpenRefused | EnvironmentOpenLost,
    tookNothing: boolean,
  ): Effect.fn.Return<never, EnvironmentVerdictFailure> {
    if (receipt._tag === 'Retained' && tookNothing) {
      yield* releaseUse(receipt.use.useId, receipt.use.consumer, 'never-applied').pipe(
        Effect.catch((trouble) =>
          Effect.logWarning('the reservation of a refused acquisition could not be released', {
            useId: receipt.use.useId,
            refusal: trouble._tag,
          }),
        ),
      );
    }
    return yield* Effect.fail<EnvironmentVerdictFailure>({
      _tag: 'EnvironmentUnavailable',
      binding: failed.binding,
      witnessed: true,
      reason: failed.reason,
    });
  });

  return Environments.of({ inspect, acquireActive, activate, release, releaseUse, heldUses });
});
