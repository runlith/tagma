import { fixtureHolder } from './hostFixture';
import { afterAll, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, Layer } from 'effect';
import { join } from 'node:path';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionStore } from './store/ExecutionStore';
import { HostAdmission } from './HostAdmission';
import {
  connectionOf as connection,
  hostProfile,
  keyOf as key,
  principalOf as principal,
  registrationOf,
  stateDirectories,
  tagOf,
} from './hostFixture';
import { hostState } from './hostState';

const directories = stateDirectories('control-bindings-');
afterAll(directories.clear);

const withBindings = Effect.fnUntraced(function* <A, E>(
  work: Effect.Effect<A, E, Bindings | Custodian | HostAdmission | ExecutionStore | ExecutionCapacity>,
) {
  const directory = yield* Effect.sync(directories.open);
  return yield* work.pipe(
    Effect.provide(
      Bindings.layer.pipe(
        Layer.provideMerge(hostState(join(directory, 'executions.sqlite'), registrationOf(directory), yield* sharedPool)),
        Layer.provideMerge(ExecutionCapacity.layer(hostProfile({ executions: 2 }))),
        Layer.provide(fixtureHolder()),
      ),
    ),
  );
});

describe('Bindings', () => {
  it.live('full live scopes refuse a new one without displacing any, and closing one or replacing custody frees room', () =>
    Effect.gen(function* () {
      yield* withBindings(
        Effect.gen(function* () {
          const custodian = yield* Custodian;
          const bindings = yield* Bindings;
          const capacity = yield* ExecutionCapacity;
          const held = connection('bounded-server');
          const owner = principal('operator');
          const custody = yield* custodian.take(key('bounded-take'), 0, held, 'custodian');
          const opened = yield* Effect.forEach(Array.from({ length: capacity.profile.host.bindings }), () =>
            bindings.open(owner, held, custody.standing.epoch),
          );
          const refused = yield* Effect.result(bindings.open(owner, held, custody.standing.epoch));
          expect(tagOf(refused)).toBe('CapacityRefused');
          const first = opened[0]!;
          expect((yield* bindings.authorize({ binding: first.id, principal: owner, connection: held, epoch: first.epoch })).id).toBe(
            first.id,
          );
          yield* bindings.close(first.id, owner);
          yield* bindings.open(owner, held, custody.standing.epoch);
          const next = yield* custodian.take(key('bounded-next'), custody.standing.revision, held, 'custodian');
          const replacement = yield* bindings.open(owner, held, next.standing.epoch);
          expect(replacement.epoch).toBe(next.standing.epoch);
          expect(
            tagOf(
              yield* Effect.result(bindings.authorize({ binding: first.id, principal: owner, connection: held, epoch: replacement.epoch })),
            ),
          ).toBe('BindingMissing');
        }),
      );
    }),
  );
  it.live(
    'two scopes of one principal are distinct, and a claim is judged against the authority admitted',
    () =>
      Effect.gen(function* () {
        const outcome = yield* withBindings(
          Effect.gen(function* () {
            const custodian = yield* Custodian;
            const bindings = yield* Bindings;
            const held = connection('server');
            const custody = yield* custodian.take(key('take-1'), 0, held, 'custodian');
            const epoch = custody.standing.epoch;

            const tab = yield* bindings.open(principal('operator'), held, epoch);
            const otherTab = yield* bindings.open(principal('operator'), held, epoch);
            const agentRun = yield* bindings.open(principal('agent'), held, epoch);

            const admitted = yield* bindings.authorize({
              binding: tab.id,
              principal: principal('operator'),
              connection: held,
              epoch,
            });
            const impostor = yield* Effect.result(
              bindings.authorize({ binding: agentRun.id, principal: principal('operator'), connection: held, epoch }),
            );
            const wrongEpoch = yield* Effect.result(
              bindings.authorize({ binding: tab.id, principal: principal('operator'), connection: held, epoch: epoch + 1 }),
            );
            const otherConnection = yield* Effect.result(
              bindings.authorize({
                binding: tab.id,
                principal: principal('operator'),
                connection: connection('server-elsewhere'),
                epoch,
              }),
            );

            yield* bindings.close(tab.id, principal('agent'));
            const survived = yield* bindings.authorize({
              binding: tab.id,
              principal: principal('operator'),
              connection: held,
              epoch,
            });
            yield* bindings.close(tab.id, principal('operator'));
            const closed = yield* Effect.result(
              bindings.authorize({ binding: tab.id, principal: principal('operator'), connection: held, epoch }),
            );
            const stillLive = yield* bindings.authorize({
              binding: otherTab.id,
              principal: principal('operator'),
              connection: held,
              epoch,
            });
            return {
              distinct: tab.id !== otherTab.id,
              admitted,
              impostor,
              wrongEpoch,
              otherConnection,
              survived,
              closed,
              stillLive,
            };
          }),
        );

        expect(outcome.distinct).toBe(true);
        expect(String(outcome.admitted.principal)).toBe('operator');
        expect(tagOf(outcome.impostor)).toBe('PrincipalInvalid');
        expect(tagOf(outcome.wrongEpoch)).toBe('CustodianRefused');
        expect(tagOf(outcome.otherConnection)).toBe('CustodianRefused');
        expect(String(outcome.survived.principal)).toBe('operator');
        expect(tagOf(outcome.closed)).toBe('BindingMissing');
        expect(String(outcome.stillLive.principal)).toBe('operator');
      }),
    40_000,
  );

  it.live(
    'a takeover ends the scopes of the epoch it replaced, and the table gives them back',
    () =>
      Effect.gen(function* () {
        const outcome = yield* withBindings(
          Effect.gen(function* () {
            const custodian = yield* Custodian;
            const bindings = yield* Bindings;

            const first = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');
            const held = yield* bindings.open(principal('agent'), connection('server-1'), first.standing.epoch);
            const second = yield* custodian.take(key('take-2'), first.standing.revision, connection('server-2'), 'custodian');

            const invalidated = yield* Effect.result(
              bindings.authorize({
                binding: held.id,
                principal: principal('agent'),
                connection: connection('server-2'),
                epoch: second.standing.epoch,
              }),
            );
            const forgotten = yield* Effect.result(
              bindings.authorize({
                binding: held.id,
                principal: principal('agent'),
                connection: connection('server-2'),
                epoch: second.standing.epoch,
              }),
            );
            const underOldEpoch = yield* Effect.result(
              bindings.authorize({
                binding: held.id,
                principal: principal('agent'),
                connection: connection('server-1'),
                epoch: first.standing.epoch,
              }),
            );
            const fresh = yield* bindings.open(principal('agent'), connection('server-2'), second.standing.epoch);
            const swept = yield* bindings.prune();
            const live = yield* bindings.authorize({
              binding: fresh.id,
              principal: principal('agent'),
              connection: connection('server-2'),
              epoch: second.standing.epoch,
            });
            return { invalidated, forgotten, underOldEpoch, swept, live };
          }),
        );

        expect(tagOf(outcome.invalidated)).toBe('BindingRefused');
        expect(tagOf(outcome.forgotten)).toBe('BindingMissing');
        expect(tagOf(outcome.underOldEpoch)).toBe('CustodianRefused');
        expect(outcome.swept).toBe(0);
        expect(String(outcome.live.principal)).toBe('agent');
      }),
    40_000,
  );

  it.live(
    'a release at its own epoch and a recovery fence each end the scopes of the custody they ended',
    () =>
      Effect.gen(function* () {
        const outcome = yield* withBindings(
          Effect.gen(function* () {
            const custodian = yield* Custodian;
            const bindings = yield* Bindings;
            const server = connection('server-1');

            const taken = yield* custodian.take(key('take-1'), 0, server, 'custodian');
            const view = yield* bindings.open(principal('operator'), server, taken.standing.epoch);

            const released = yield* custodian.release(key('release-1'), server, taken.standing);
            const afterRelease = yield* Effect.result(
              bindings.authorize({
                binding: view.id,
                principal: principal('operator'),
                connection: server,
                epoch: taken.standing.epoch,
              }),
            );
            const freedByRelease = yield* bindings.prune();

            const again = yield* custodian.take(key('take-2'), released.standing.revision, server, 'custodian');
            const agentRun = yield* bindings.open(principal('agent'), server, again.standing.epoch);
            const operatorView = yield* bindings.open(principal('operator'), server, again.standing.epoch);
            const fenced = yield* custodian.fence(key('fence-1'), again.standing.revision, connection('cli'), 'recovery');
            const ended = yield* Effect.result(
              bindings.authorize({
                binding: agentRun.id,
                principal: principal('agent'),
                connection: server,
                epoch: again.standing.epoch,
              }),
            );
            const atFence = yield* Effect.result(
              bindings.authorize({
                binding: operatorView.id,
                principal: principal('operator'),
                connection: server,
                epoch: fenced.standing.epoch,
              }),
            );
            return {
              again,
              fenced,
              afterRelease,
              freedByRelease,
              ended,
              atFence,
              freedByFence: yield* bindings.prune(),
            };
          }),
        );

        expect(tagOf(outcome.afterRelease)).toBe('CustodianRefused');
        expect(outcome.freedByRelease).toBe(1);
        expect(outcome.fenced.standing.epoch).toBe(outcome.again.standing.epoch + 1);
        expect(outcome.fenced.standing.holder).toBeUndefined();
        expect(tagOf(outcome.ended)).toBe('CustodianRefused');
        expect(tagOf(outcome.atFence)).toBe('CustodianRefused');
        expect(outcome.freedByFence).toBe(2);
      }),
    40_000,
  );
});
