import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { Environments } from '../contract/service/environments.js';
import { EnvironmentId, type EnvironmentBinding } from '../contract/wire/environments.js';
import { NamespaceId } from '@runlith/files/namespace';
import { makeHostRootProver } from './proof.js';

const proverOver = (inspect: Environments['Service']['inspect']) =>
  Effect.provideService(makeHostRootProver, Environments, {
    inspect,
    acquireActive: () => Effect.die('proof does not acquire an environment'),
    activate: () => Effect.die('proof does not activate an environment'),
    release: () => Effect.die('proof does not release environment uses'),
    releaseUse: () => Effect.die('proof does not release environment uses'),
    heldUses: () => Effect.die('proof does not read environment uses'),
  });

const binding: EnvironmentBinding = {
  environmentId: EnvironmentId.make('env-proof'),
  kind: 'host',
  namespaceId: NamespaceId.make('ns-proof'),
  identityWitness: { provider: 'proof', format: 'proof', token: 'proof' },
};
const stateOf = (binding: EnvironmentBinding | null) => ({
  identity: { environmentId: EnvironmentId.make('env-proof'), kind: 'host' as const, namespaceId: NamespaceId.make('ns-proof') },
  binding,
  availability: 'available' as const,
  capabilities: { files: true, exec: false, heldExecution: false, egress: false },
  reason: null,
});

it.effect('a defect in the proof surfaces instead of answering null', () =>
  Effect.gen(function* () {
    const origins = yield* proverOver(() => Effect.die(new Error('inspect blew up')));
    const exit = yield* Effect.exit(origins.placeOf('/whatever/stood/here'));
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  }),
);

it.effect('an interruption of the proof unwinds instead of answering null', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const origins = yield* proverOver(() => Effect.andThen(Deferred.succeed(entered, undefined), Effect.never));
    const fiber = yield* Effect.forkScoped(origins.placeOf('/whatever/stood/here'));
    yield* Deferred.await(entered);
    yield* Fiber.interrupt(fiber);
    expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
  }),
);

it.effect('an environment without a witness proves no root', () =>
  Effect.gen(function* () {
    const origins = yield* proverOver(() => Effect.succeed(stateOf(null)));
    expect(yield* origins.placeOf('/whatever/stood/here')).toBeNull();
  }),
);

it.live('a missing directory or a file proves no working root', () =>
  Effect.gen(function* () {
    const origins = yield* proverOver(() => Effect.succeed(stateOf(binding)));
    expect(yield* origins.placeOf('/definitely/not/here/tagma-proof')).toBeNull();
    expect(yield* origins.placeOf(import.meta.path)).toBeNull();
  }),
);
