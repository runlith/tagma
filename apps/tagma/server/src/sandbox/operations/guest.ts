import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Effect } from 'effect';
import { ChangeScope } from '../../change-record/contract/service/scope.js';
import { routed } from '../../platform/contract/service/routed.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import { GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { GuestPreparation } from '../contract/service/preparation.js';
import { Sandboxes, SandboxHeldConflict, SandboxReadConflict, SandboxUnavailable } from '../contract/service/sandboxes.js';
import { SANDBOX_OPERATIONS as OPS } from '../contract/wire/operations/catalog.js';
import type { SandboxRecord } from '../contract/wire/sandbox.js';
import { DEFAULT_GUEST_LIMITS, principalOf, SELECTION_WAYS, sourceConflict } from './shared.js';

const SANDBOX_WAYS: Unblock = [
  'read the sandbox: its state and its reason say what stopped it',
  'prepare a fresh sandbox and name the id it answers with',
];

const NO_SUCH_SANDBOX: Unblock = [
  'read this project’s sandboxes to see what stands and what this owner made',
  'prepare a sandbox and name the id it answers with',
];

const overGuest = <A>(
  work: Effect.Effect<A, SandboxUnavailable | ThreadStorageFailed>,
): Effect.Effect<A, GateRefusal<'sandbox-unavailable'>> =>
  Effect.mapError(work, (failure) => new GateRefusal('sandbox-unavailable', failure.message, SANDBOX_WAYS));

const overRelease = <A>(
  work: Effect.Effect<A, SandboxUnavailable | SandboxHeldConflict | SandboxReadConflict | ThreadStorageFailed>,
): Effect.Effect<A, GateRefusal<'sandbox-unavailable' | 'sandbox-busy'>> =>
  Effect.mapError(work, (failure) =>
    failure._tag === 'SandboxHeldConflict'
      ? new GateRefusal('sandbox-busy', failure.message, SANDBOX_WAYS)
      : new GateRefusal('sandbox-unavailable', failure.message, SANDBOX_WAYS),
  );

export function summary(row: SandboxRecord) {
  return {
    sandbox: row.id,
    id: row.id,
    projectId: row.projectId,
    state: row.state,
    boundThreadId: row.boundThreadId,
    runtime: row.runtime,
    manifest: row.manifest,
    failureReason: row.failureReason,
    exportPath: row.exportPath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    host: { kind: 'sandbox' as const, id: row.id },
    source: row.manifest?.source ?? null,
    image: row.manifest?.image.reference ?? null,
    platform: row.manifest?.platform ?? null,
    limits: row.manifest?.limits ?? null,
    exclusions: row.manifest?.exclusions ?? null,
    preparedAt: row.manifest?.preparedAt ?? null,
  };
}

const sandboxWord = (row: ReturnType<typeof summary>) => ({
  sandbox: row.sandbox,
  state: row.state,
  boundThreadId: row.boundThreadId,
  host: row.host,
  source: row.source,
  image: row.image,
  platform: row.platform,
  limits: row.limits,
  exclusions: row.exclusions,
  failureReason: row.failureReason,
  exportPath: row.exportPath,
  preparedAt: row.preparedAt,
});

const ownedSandbox = Effect.fn('sandbox.owned')(function* (id: string, projectId: number, principal: string) {
  const row = yield* overGuest((yield* Sandboxes).byId(id));
  if (row === null || row.ownerId !== principal || (row.projectId !== null && row.projectId !== projectId)) {
    return yield* new GateRefusal('not-found', `no sandbox ${id} stands in this project`, NO_SUCH_SANDBOX);
  }
  return row;
});

export const GUEST_ROUTED = {
  prepare_sandbox: routed(OPS.prepare_sandbox, {
    execute: Effect.fnUntraced(function* (input: (typeof OPS.prepare_sandbox)['input']['Type'], _prepared: undefined, caller: Caller) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const conflict = sourceConflict(input);
      if (conflict !== null) return yield* new GateRefusal('selection-shape', conflict, SELECTION_WAYS);
      const sandboxes = yield* Sandboxes;
      const source =
        input.preparedTree !== undefined
          ? { kind: 'prepared' as const, preparedTree: input.preparedTree }
          : input.empty
            ? { kind: 'empty' as const }
            : {
                kind: 'project' as const,
                projectId,
                commit: yield* overGuest(
                  (yield* GuestPreparation)
                    .commitOf(projectId, input.commit ?? 'HEAD')
                    .pipe(Effect.mapError((failure) => new SandboxUnavailable({ sandbox: failure.commit, reason: failure.reason }))),
                ),
              };
      const record = yield* overGuest(
        sandboxes.prepare({
          source,
          limits: input.limits ?? DEFAULT_GUEST_LIMITS,
          exclude:
            input.preparedTree === undefined ? (input.exclude ?? [yield* GraphDirectory]).map((path) => `:(exclude)${path}`) : undefined,
          setup: input.setup,
          dependencies: input.dependencies,
          ownerId: principalOf(caller),
        }),
      );
      return { status: 'prepared' as const, ...summary(record) };
    }),
    answer: (value: { readonly status: 'prepared' } & ReturnType<typeof summary>) => ({ status: value.status, ...sandboxWord(value) }),
  }),

  read_sandbox: routed(OPS.read_sandbox, {
    execute: Effect.fnUntraced(function* (input: (typeof OPS.read_sandbox)['input']['Type'], _prepared: undefined, caller: Caller) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const principal = principalOf(caller);
      if (input.id === undefined) {
        const rows = yield* overGuest((yield* Sandboxes).records());
        return {
          status: 'ok' as const,
          sandboxes: rows
            .filter((row) => row.ownerId === principal && (row.projectId === null || row.projectId === projectId))
            .map(summary),
        };
      }
      return { status: 'ok' as const, ...summary(yield* ownedSandbox(input.id, projectId, principal)) };
    }),
    answer: (
      value:
        | { readonly status: 'ok'; readonly sandboxes: readonly ReturnType<typeof summary>[] }
        | ({ readonly status: 'ok'; readonly sandboxes?: undefined } & ReturnType<typeof summary>),
    ) =>
      value.sandboxes === undefined
        ? { status: value.status, ...sandboxWord(value) }
        : { status: value.status, sandboxes: value.sandboxes.map(sandboxWord) },
  }),

  release_sandbox: routed(OPS.release_sandbox, {
    execute: Effect.fnUntraced(function* (input: (typeof OPS.release_sandbox)['input']['Type'], _prepared: undefined, caller: Caller) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const row = yield* ownedSandbox(input.id, projectId, principalOf(caller));
      const exported = yield* overRelease((yield* Sandboxes).release(row.id));
      return { status: 'released' as const, ...exported };
    }),
    answer: (value: { readonly status: 'released'; readonly sandbox: string; readonly path: string }) => value,
  }),
};
