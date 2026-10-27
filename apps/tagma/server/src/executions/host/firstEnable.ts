import { Clock, Data, Effect, FileSystem, Schema } from 'effect';
import { readArtifact } from '@runlith/executions/hostArtifacts';
import { ARTIFACT_FILE } from '@runlith/executions/protocol/artifact';
import { shutdownMsOf } from '@runlith/executions/protocol/capacity';
import type { StateClaim } from './boot.js';
import { endByRecovery, listByRecovery, type RecoveryInput } from './recovery.js';

export type Holderless =
  | { readonly _tag: 'Holderless' }
  | { readonly _tag: 'Held' }
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Unread'; readonly detail: string };

const PartRoles = Schema.fromJsonString(Schema.Struct({ parts: Schema.Array(Schema.Struct({ role: Schema.String })) }));

class RolesUnnamed extends Data.TaggedError('RolesUnnamed')<{ readonly detail: string }> {}

const namedRoles = Effect.fnUntraced(function* (bundle: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files
    .readFileString(`${bundle}/${ARTIFACT_FILE}`)
    .pipe(Effect.mapError((failure) => new RolesUnnamed({ detail: `the manifest could not be read: ${failure.reason._tag}` })));
  const roles = yield* Schema.decodeUnknownEffect(PartRoles)(text).pipe(
    Effect.mapError(() => new RolesUnnamed({ detail: 'the manifest does not list its parts' })),
  );
  if (roles.parts.length === 0) return yield* new RolesUnnamed({ detail: 'the manifest lists no parts' });
  return roles.parts.map((part) => part.role);
});

export const readHolderless = Effect.fnUntraced(function* (bundle: string): Effect.fn.Return<Holderless, never, FileSystem.FileSystem> {
  const read = yield* Effect.result(readArtifact(bundle));
  if (read._tag === 'Success') return read.success.parts.some((part) => part.role === 'holder') ? { _tag: 'Held' } : { _tag: 'Holderless' };
  if (read.failure._tag === 'ArtifactMissing') return { _tag: 'Absent' };
  const unreadable = `the manifest of ${bundle} could not be read: ${read.failure._tag}`;
  if (read.failure._tag !== 'ArtifactInvalid') return { _tag: 'Unread', detail: unreadable };
  const roles = yield* Effect.result(namedRoles(bundle));
  if (roles._tag === 'Failure') return { _tag: 'Unread', detail: `${unreadable}; ${roles.failure.detail}` };
  return roles.success.includes('holder') ? { _tag: 'Held' } : { _tag: 'Holderless' };
});

export type FirstEnding =
  | { readonly _tag: 'Ended'; readonly executions: number | undefined; readonly detail: string }
  | { readonly _tag: 'Refused'; readonly detail: string };

export const endHolderless = Effect.fnUntraced(function* (input: RecoveryInput): Effect.fn.Return<FirstEnding> {
  const measured = yield* listByRecovery(input);
  const ending = yield* endByRecovery(input);
  if (ending._tag === 'Refused') return { _tag: 'Refused', detail: ending.detail };
  return {
    _tag: 'Ended',
    executions: measured._tag === 'Measured' ? measured.live : undefined,
    detail: ending.detail,
  };
});

export type FirstEnableInput = {
  readonly files: FileSystem.FileSystem;
  readonly bundle: string;
  readonly state: string;
  readonly graceMs?: number;
  readonly claim: Effect.Effect<StateClaim>;
  readonly signalClaim: (pid: number, signal: string) => Effect.Effect<boolean>;
  readonly fence: Effect.Effect<void, { readonly _tag: string }>;
  readonly record: (executions: number | undefined, detail: string) => Effect.Effect<void>;
};

export type FirstEnabled =
  | { readonly _tag: 'NotNeeded' }
  | { readonly _tag: 'Enabled'; readonly executions: number | undefined; readonly detail: string }
  | { readonly _tag: 'Refused'; readonly detail: string };

const letGo = Effect.fnUntraced(function* (input: FirstEnableInput, graceMs: number | undefined) {
  const deadline = graceMs === undefined ? undefined : (yield* Clock.currentTimeMillis) + graceMs;
  for (;;) {
    const claim = yield* input.claim;
    if (claim._tag === 'Free') return true;
    if (claim._tag === 'Unmeasured') return false;
    if (deadline !== undefined && (yield* Clock.currentTimeMillis) >= deadline) return false;
    yield* Effect.sleep('100 millis');
  }
});

const forced = Effect.fnUntraced(function* (input: FirstEnableInput, named: string, asked: string, graceMs: number) {
  const rungs: ReadonlyArray<readonly [string, number | undefined]> = [
    ['SIGTERM', graceMs],
    ['SIGKILL', undefined],
  ];
  for (const [signal, within] of rungs) {
    const claim = yield* input.claim;
    if (claim._tag === 'Free') return true;
    if (claim._tag === 'Unmeasured') return false;
    yield* Effect.logWarning(`ending ${named} by signal: ${asked}; ${signal} to ${claim.holders.join(', ')}`);
    yield* Effect.forEach(claim.holders, (pid) => input.signalClaim(pid, signal), { discard: true });
    if (yield* letGo(input, within)) return true;
  }
  return false;
});

export const firstEnable = Effect.fnUntraced(function* (input: FirstEnableInput): Effect.fn.Return<FirstEnabled> {
  const standing = yield* readHolderless(input.bundle).pipe(Effect.provideService(FileSystem.FileSystem, input.files));
  if (standing._tag === 'Unread') return { _tag: 'Refused', detail: standing.detail };
  if (standing._tag === 'Held' || standing._tag === 'Absent') return { _tag: 'NotNeeded' };
  return yield* endStanding(input, 'the execution host that has no holder');
});

export const endStanding = Effect.fnUntraced(function* (input: FirstEnableInput, named: string): Effect.fn.Return<FirstEnabled> {
  const fenced = yield* Effect.result(input.fence);
  if (fenced._tag === 'Failure') {
    return {
      _tag: 'Refused',
      detail: `what the threads hold could not be read before ending the host (${fenced.failure._tag})`,
    };
  }
  const graceMs = input.graceMs ?? shutdownMsOf(undefined);
  const ending = yield* endHolderless({ bundle: input.bundle, state: input.state });
  const gone =
    ending._tag === 'Refused'
      ? yield* forced(input, named, `its own recovery program refused: ${ending.detail}`, graceMs)
      : (yield* letGo(input, graceMs)) || (yield* forced(input, named, 'it did not let go after its recovery program ended it', graceMs));
  if (!gone) return { _tag: 'Refused', detail: `${named} did not let go of this installation` };
  const executions = ending._tag === 'Ended' ? ending.executions : undefined;
  yield* input.record(executions, ending.detail);
  return { _tag: 'Enabled', executions, detail: ending.detail };
});
