import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { HOLDER_LIBRARY } from './posix/testing/holder';
import type { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionCapacity } from './ExecutionCapacity';
import { hostProfile } from './hostFixture';
import { loadLibrary } from './posix/Library';
import { platformIdentity } from './composition/testing/native';

const ARTIFACT = HOLDER_LIBRARY;

it.live('host startup binds a profile that matches the loaded artifact, and refuses one naming another build or promoting the group', () =>
  Effect.gen(function* () {
    const library = yield* loadLibrary(ARTIFACT);
    const native = yield* platformIdentity(library);
    const matched: CapabilityProfile = {
      ...hostProfile({ executions: 2 }),
      version: 2,
      platform: native.platform,
      runtime: native.runtime,
      native: native.native,
    };
    const capacity = yield* Effect.provide(ExecutionCapacity, ExecutionCapacity.forHost(matched, native));
    const mismatched = yield* Effect.flip(
      Effect.provide(
        ExecutionCapacity,
        ExecutionCapacity.forHost({ ...matched, native: { ...matched.native, build: 'another-artifact' } }, native),
      ),
    );
    const promoted = yield* Effect.flip(
      Effect.provide(ExecutionCapacity, ExecutionCapacity.forHost({ ...matched, relations: ['leader', 'work'] }, native)),
    );
    expect((yield* capacity.ledger()).executions).toBe(0);
    expect(mismatched._tag === 'ProfileInvalid' && mismatched.reason).toBe('artifact');
    if (mismatched._tag === 'ProfileInvalid') expect(mismatched.field).toBe('native.build');
    expect(promoted._tag === 'ProfileInvalid' && promoted.reason).toBe('artifact');
    if (promoted._tag === 'ProfileInvalid') {
      expect(promoted.field).toBe('relations');
      expect(promoted.actual).toBe('work');
    }
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
