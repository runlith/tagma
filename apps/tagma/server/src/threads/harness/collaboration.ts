import { Effect } from 'effect';
import { BirthConflict, BirthRefused, type BirthFailure, type BirthInput, Threads } from '@runlith/agent/collaboration/threads';
import { ThreadMissing } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { HarnessName } from '../contract/wire/harness/names.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { HarnessFaceMissing, HarnessRegistry, HarnessMissing } from '../contract/service/harness.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { harnessOfTypeId } from '../contract/wire/harness/types.js';

const BIRTH_REFUSALS = new Set<BirthRefused['reason']>([
  'host-unadmitted',
  'host-with-fork',
  'harness-contract',
  'harness-host',
  'model-unnamed',
  'model-unavailable',
  'thread-project-missing',
]);

export type ExternalThreads = {
  readonly born: (
    name: HarnessName,
    input: BirthInput,
  ) => Effect.Effect<
    { readonly threadId: string; readonly acted: boolean },
    HarnessFailure | BirthConflict | BirthRefused | HarnessMissing | HarnessFaceMissing
  >;
  readonly registry: HarnessRegistry['Service'];
};

export const makeExternalThreads = Effect.gen(function* () {
  const registry = yield* HarnessRegistry;
  const external: ExternalThreads = {
    born: Effect.fn('ExternalThreads.born')(function* (name, input) {
      const harness = yield* registry.resolve(name as HarnessId);
      if (harness.spawn === undefined) return yield* new HarnessFaceMissing({ harness: name, face: 'spawn' });
      return yield* harness.spawn(input);
    }),
    registry,
  };
  return external;
});

export const birthRefusal = (childId: string, cause: GateRefusal): BirthRefused => {
  const reason = BIRTH_REFUSALS.has(cause.code as BirthRefused['reason']) ? (cause.code as BirthRefused['reason']) : 'harness-refused';
  return new BirthRefused({ childId, reason, detail: `${cause.code}: ${cause.reason}` });
};

const birthFailure = (input: BirthInput, cause: unknown): BirthFailure => {
  if (cause instanceof BirthConflict || cause instanceof BirthRefused || cause instanceof ThreadMissing) return cause;
  if (cause instanceof HarnessMissing || cause instanceof HarnessFaceMissing) {
    return new BirthRefused({ childId: input.childId, reason: 'harness-refused', detail: `${cause.harness} answers no spawn` });
  }
  if (cause instanceof GateRefusal) return birthRefusal(input.childId, cause);
  return cause instanceof ThreadStorageFailed ? cause : new ThreadStorageFailed({ call: 'harness.born', cause });
};

export function withExternalThreads(
  native: Threads['Service'],
  external: ExternalThreads,
  list: Threads['Service']['list'],
): Threads['Service'] {
  return Threads.of({
    ...native,
    list,
    create: (input) => {
      const name = input.request.typeId === null ? null : harnessOfTypeId(input.request.typeId);
      if (name === null) return native.create(input);
      return Effect.gen(function* () {
        const parent = yield* Effect.mapError(native.find(input.creatorThreadId, input.principal), (cause) =>
          cause._tag === 'ThreadStorageFailed' ? cause : new ThreadStorageFailed({ call: 'harness.born', cause }),
        );
        if (parent === null) return yield* new ThreadMissing({ threadId: input.creatorThreadId });
        if (!external.registry.list().includes(name as HarnessId)) {
          return yield* new BirthRefused({
            childId: input.childId,
            reason: 'harness-refused',
            detail: `${name} is not installed on this machine`,
          });
        }
        const made = yield* Effect.mapError(external.born(name, input), (cause) => birthFailure(input, cause));
        const thread = yield* Effect.mapError(native.find(made.threadId, input.principal), (cause) =>
          cause._tag === 'ThreadStorageFailed' ? cause : new ThreadStorageFailed({ call: 'harness.born', cause }),
        );
        if (thread === null) return yield* new ThreadMissing({ threadId: made.threadId });
        return { status: 'created' as const, thread, acted: made.acted };
      });
    },
  });
}
