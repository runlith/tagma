import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { CommandEnvironmentUnavailable, type CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import { NamespaceId, type IdentityWitness } from '@runlith/files/namespace';
import { Effect } from 'effect';
import type { SandboxRecord } from '../contract/wire/sandbox.js';
import { EnvironmentOpenLost, EnvironmentOpenRefused, type EnvironmentBackend } from '../../workspace/contract/service/environments.js';
import {
  EnvironmentId,
  type EnvironmentCapabilities,
  type EnvironmentIdentity,
  type EnvironmentState,
  type EnvironmentVerdictFailure,
} from '../../workspace/contract/wire/environments.js';
import { type BoundThread, Sandboxes } from '../contract/service/sandboxes.js';
import type { GuestBackend, GuestExpectation, GuestState } from '../contract/service/backends.js';
import type { SandboxStore } from '../store/sandboxes.js';

const KIND = 'sandbox' as const;

const CAPABILITIES: EnvironmentCapabilities = { files: true, exec: true, heldExecution: false, egress: false };

const GUEST_COMMANDS: CommandEnvironment = {
  materialize: () =>
    Effect.fail(
      new CommandEnvironmentUnavailable({
        reason: 'a guest keeps its environment inside its container; its commands run through the guest world, never on this host',
      }),
    ),
};

type Refused = { readonly _tag: 'Refused'; readonly witnessed: boolean; readonly reason: string };

type Verdict =
  | { readonly _tag: 'Serving'; readonly thread: BoundThread; readonly row: SandboxRecord; readonly expected: GuestExpectation }
  | Refused;

function identityOf(sandbox: string): EnvironmentIdentity {
  return { environmentId: EnvironmentId.make(sandbox), kind: KIND, namespaceId: NamespaceId.make(sandbox) };
}

function witnessOf(row: SandboxRecord): IdentityWitness {
  return { provider: row.runtime.backend, format: 'container', token: row.runtime.container };
}

function held(row: SandboxRecord | null): Verdict {
  if (row === null) return { _tag: 'Refused', witnessed: false, reason: 'no sandbox stands under this id' };
  if (row.state !== 'prepared' || row.manifest === null) {
    return {
      _tag: 'Refused',
      witnessed: false,
      reason: `its preparation is ${row.state}${row.failureReason ? `: ${row.failureReason}` : ''}`,
    };
  }
  if (row.boundThreadId === null) return { _tag: 'Refused', witnessed: true, reason: 'nothing holds it: no thread is bound to it' };
  return {
    _tag: 'Serving',
    row,
    thread: { id: row.boundThreadId, hostKind: KIND, hostId: row.id },
    expected: { limits: row.manifest.limits, image: row.manifest.image },
  };
}

function guestVerdict(expected: GuestExpectation, guest: GuestState): Refused | null {
  const digest = expected.image.digest;
  if (guest.status === 'gone') return { _tag: 'Refused', witnessed: false, reason: 'its guest is gone' };
  if (guest.image !== digest) {
    return {
      _tag: 'Refused',
      witnessed: true,
      reason: `its guest runs ${guest.image ?? 'no image'}, not the ${digest} it was prepared against`,
    };
  }
  if (guest.mismatch !== null) {
    return {
      _tag: 'Refused',
      witnessed: true,
      reason: `its guest no longer stands at the boundary it was prepared with: ${guest.mismatch}`,
    };
  }
  return null;
}

function refusedState(identity: EnvironmentIdentity, row: SandboxRecord | null, refused: Refused): EnvironmentState {
  return {
    identity,
    binding: refused.witnessed && row !== null ? { ...identity, identityWitness: witnessOf(row) } : null,
    availability: 'unavailable',
    capabilities: CAPABILITIES,
    reason: refused.reason,
  };
}

function registry(failure: ThreadStorageFailed): EnvironmentVerdictFailure {
  return { _tag: 'EnvironmentRegistryUnavailable', reason: failure.message };
}

export const makeGuestEnvironment = Effect.fnUntraced(function* (input: { readonly store: SandboxStore; readonly guests: GuestBackend }) {
  const { store, guests } = input;
  const sandboxes = yield* Sandboxes;
  const state = Effect.fn('GuestEnvironment.state')(function* (identity?: EnvironmentIdentity) {
    if (identity === undefined) {
      return yield* Effect.fail<EnvironmentVerdictFailure>({
        _tag: 'ActivationUnsupported',
        kind: KIND,
        binding: null,
        capability: 'access',
        reason: 'A guest environment is named by its sandbox: read it through a binding that names one.',
      });
    }
    const named = identityOf(identity.environmentId);
    const row = yield* Effect.mapError(store.byId(identity.environmentId), registry);
    const standing = held(row);
    if (standing._tag === 'Refused') return refusedState(named, row, standing);
    return yield* guests.inspect(standing.row.runtime, standing.expected).pipe(
      Effect.match({
        onFailure: (failure): EnvironmentState => ({
          identity: named,
          binding: null,
          availability: 'unknown',
          capabilities: CAPABILITIES,
          reason: failure.message,
        }),
        onSuccess: (guest): EnvironmentState => {
          const refused = guestVerdict(standing.expected, guest);
          if (refused !== null) return refusedState(named, standing.row, refused);
          return {
            identity: named,
            binding: { ...named, identityWitness: witnessOf(standing.row) },
            availability: 'available',
            capabilities: CAPABILITIES,
            reason: null,
          };
        },
      }),
    );
  });
  return {
    kind: KIND,

    hold: {
      _tag: 'Retained',
      admit: Effect.fn('GuestEnvironment.admit')(function* (unit, binding) {
        const row = yield* Effect.mapError(store.byId(binding.environmentId, unit), registry);
        const standing = held(row);
        if (standing._tag === 'Serving') return;
        return yield* Effect.fail<EnvironmentVerdictFailure>({
          _tag: 'EnvironmentUnavailable',
          binding,
          witnessed: standing.witnessed,
          reason: standing.reason,
        });
      }),
    },

    state,

    open: Effect.fn('GuestEnvironment.open')(function* (binding) {
      const refuse = (reason: string) => new EnvironmentOpenRefused({ binding, reason });
      const row = yield* store.byId(binding.environmentId).pipe(Effect.mapError((failure) => refuse(failure.message)));
      const standing = held(row);
      if (standing._tag === 'Refused') return yield* refuse(standing.reason);
      const acquired = yield* sandboxes.acquire(standing.thread).pipe(Effect.mapError((failure) => refuse(failure.message)));
      const opened = yield* guests
        .world(acquired.runtime)
        .pipe(Effect.mapError((failure) => new EnvironmentOpenLost({ binding, reason: failure.message })));
      return { world: opened.world, commandEnvironment: GUEST_COMMANDS };
    }),

    activate: Effect.fn('GuestEnvironment.activate')(function* (binding) {
      const row = yield* Effect.mapError(store.byId(binding.environmentId), registry);
      const standing = held(row);
      if (standing._tag === 'Refused') {
        return yield* Effect.fail<EnvironmentVerdictFailure>({
          _tag: 'EnvironmentUnavailable',
          binding,
          witnessed: standing.witnessed,
          reason: standing.reason,
        });
      }
      yield* sandboxes.acquire(standing.thread).pipe(
        Effect.catchTag('SandboxUnavailable', (failure) =>
          Effect.fail<EnvironmentVerdictFailure>({ _tag: 'EnvironmentUnavailable', binding, witnessed: true, reason: failure.message }),
        ),
        Effect.catchTag('ThreadStorageFailed', (failure) => Effect.fail(registry(failure))),
      );
      return yield* state(binding);
    }),
  } satisfies EnvironmentBackend;
});
