import { fixtureHolder } from './hostFixture';
import { afterAll, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { Database } from 'bun:sqlite';
import { Duration, Effect, Layer, Result, Schedule } from 'effect';
import { join } from 'node:path';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { HostAdmission } from './HostAdmission';
import { ExecutionStore, executionStore } from './store/ExecutionStore';
import { CustodyLost } from './store/errors';
import {
  connectionOf as connection,
  hostProfile,
  keyOf as key,
  registrationOf,
  signalConnection,
  stateDirectories,
  tagOf,
} from './hostFixture';
import { hostState } from './hostState';

const directories = stateDirectories('custodian-');
afterAll(directories.clear);

const state = directories.open;

const over = (directory: string, custodyReceipts = 8) =>
  hostState(
    join(directory, 'executions.sqlite'),
    registrationOf(directory),
    new ProcessPool(undefined, 'stop', undefined, childHosting),
  ).pipe(Layer.provide(fixtureHolder()), Layer.provideMerge(ExecutionCapacity.layer(hostProfile({ custodyReceipts }))));

const killConnection = (): Effect.Effect<number> => Effect.promise(() => signalConnection('SIGKILL'));

const losingOneReply = (directory: string, lost: string) => {
  let taken = false;
  const answering = Layer.effect(
    ExecutionStore,
    Effect.map(ExecutionStore, (writer) =>
      ExecutionStore.of({
        ...writer,
        acceptCustody: (claim) =>
          claim.operation.operation === lost && !taken
            ? Effect.flatMap(writer.acceptCustody(claim), (accepted) => {
                taken = true;
                return Effect.fail(
                  new CustodyLost({
                    operation: claim.operation,
                    reason: `the reply to ${accepted.standing.epoch} never came back`,
                  }),
                );
              })
            : writer.acceptCustody(claim),
      }),
    ),
  ).pipe(
    Layer.provide(
      executionStore(
        join(directory, 'executions.sqlite'),
        registrationOf(directory),
        new ProcessPool(undefined, 'stop', undefined, childHosting),
      ),
    ),
    Layer.provide(fixtureHolder()),
  );

  const owners = Layer.unwrap(
    Effect.gen(function* () {
      const writer = yield* ExecutionStore;
      const entered = yield* writer.incarnation();
      return Layer.provideMerge(Custodian.layer(entered.incarnation), HostAdmission.layer(entered.phase));
    }),
  );

  return owners.pipe(Layer.provideMerge(answering), Layer.provideMerge(ExecutionCapacity.layer(hostProfile())));
};

describe('Custodian', () => {
  it.live(
    'a replacement host starts above every epoch the file granted, and the holder it finds holds nothing',
    Effect.fnUntraced(function* () {
      const directory = state();

      const first = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const taken = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');
        const forbidden = yield* Effect.flip(custodian.take(key('take-2'), 1, connection('cli'), 'recovery'));
        return [taken, yield* custodian.check(taken.standing.epoch, connection('server-1')), forbidden] as const;
      }).pipe(Effect.provide(over(directory)));

      const replacing = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const standing = yield* custodian.current();
        const dead = yield* Effect.flip(custodian.check(first[0].standing.epoch, connection('server-1')));
        const taken = yield* custodian.take(
          key('take-3'),
          standing._tag === 'Settled' ? standing.custody.revision : 0,
          connection('server-2'),
          'custodian',
        );
        return [standing, dead, taken] as const;
      }).pipe(Effect.provide(over(directory)));

      expect(first[0].standing.epoch).toBe(1);
      expect(String(first[1].holder?.connection)).toBe('server-1');
      expect(first[2]._tag).toBe('RoleRefused');
      expect(replacing[0]._tag).toBe('Settled');
      expect(replacing[0]._tag === 'Settled' && replacing[0].custody.holder?.incarnation).toBe(0);
      expect(replacing[1]._tag).toBe('CustodianRefused');
      expect(replacing[2].standing.epoch).toBe(2);
    }),
  );

  it.live(
    'a late release cannot clear the custody that replaced it, and its key answers without returning authority',
    Effect.fnUntraced(function* () {
      const outcome = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const first = yield* custodian.take(key('take-1'), 0, connection('server'), 'custodian');
        const second = yield* custodian.take(key('take-2'), first.standing.revision, connection('server'), 'custodian');

        const late = yield* Effect.result(custodian.release(key('release-1'), connection('server'), first.standing));
        const stranger = yield* Effect.result(custodian.release(key('release-3'), connection('server-elsewhere'), second.standing));
        const repeated = yield* custodian.take(key('take-1'), 0, connection('server'), 'custodian');
        const stale = yield* Effect.flip(custodian.check(first.standing.epoch, connection('server')));
        const live = yield* custodian.check(second.standing.epoch, connection('server'));
        const impostor = yield* Effect.flip(custodian.check(second.standing.epoch, connection('server-2')));

        const released = yield* custodian.release(key('release-2'), connection('server'), second.standing);
        const after = yield* Effect.flip(custodian.check(second.standing.epoch, connection('server')));
        return { first, second, late, stranger, repeated, stale, live, impostor, released, after } as const;
      }).pipe(Effect.provide(over(state())));

      expect(outcome.first.standing.epoch).toBe(1);
      expect(outcome.second.standing.epoch).toBe(2);
      expect(tagOf(outcome.late)).toBe('CustodyConflict');
      expect(tagOf(outcome.stranger)).toBe('CustodianRefused');
      expect(outcome.impostor._tag).toBe('CustodianRefused');
      expect(outcome.repeated._tag).toBe('Standing');
      expect(outcome.repeated._tag === 'Standing' && outcome.repeated.answered.epoch).toBe(1);
      expect(outcome.repeated.standing.epoch).toBe(2);
      expect(outcome.stale._tag).toBe('CustodianRefused');
      expect(String(outcome.live.holder?.connection)).toBe('server');
      expect(outcome.released.standing.epoch).toBe(2);
      expect(outcome.released.standing.holder).toBeUndefined();
      expect(outcome.after._tag).toBe('CustodianRefused');
    }),
  );

  it.live(
    'custody ends with the connection that held it, and no other ending touches it',
    Effect.fnUntraced(function* () {
      const outcome = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const taken = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');

        const stranger = yield* custodian.ended(key('ended-stranger'), connection('server-2'));
        const beside = yield* custodian.current();
        const live = yield* custodian.check(taken.standing.epoch, connection('server-1'));

        const gone = yield* custodian.ended(key('ended-holder'), connection('server-1'));
        const after = yield* Effect.flip(custodian.check(taken.standing.epoch, connection('server-1')));
        const standing = yield* custodian.current();
        const next = yield* custodian.take(
          key('take-2'),
          standing._tag === 'Settled' ? standing.custody.revision : 0,
          connection('server-3'),
          'custodian',
        );
        return { taken, stranger, beside, live, gone, after, standing, next } as const;
      }).pipe(Effect.provide(over(state())));

      expect(outcome.taken.standing.epoch).toBe(1);
      expect(outcome.stranger._tag).toBe('HeldNothing');
      expect(outcome.beside._tag === 'Settled' && outcome.beside.custody.revision).toBe(outcome.taken.standing.revision);
      expect(outcome.beside._tag === 'Settled' && String(outcome.beside.custody.holder?.connection)).toBe('server-1');
      expect(String(outcome.live.holder?.connection)).toBe('server-1');

      expect(outcome.gone._tag).toBe('Released');
      expect(outcome.gone._tag === 'Released' && outcome.gone.acceptance.standing.holder).toBeUndefined();
      expect(outcome.gone._tag === 'Released' && outcome.gone.acceptance.standing.epoch).toBe(1);
      expect(outcome.after._tag).toBe('CustodianRefused');
      expect(outcome.next.standing.epoch).toBe(2);
      expect(String(outcome.next.standing.holder?.connection)).toBe('server-3');
    }),
  );

  it.live(
    'a host whose writer is gone grants no control and keeps what it held refused',
    Effect.fnUntraced(function* () {
      const [before, phase, refused, standing, checked, killed] = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const admission = yield* HostAdmission;
        const taken = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');

        const struck = yield* killConnection();
        const reached = yield* admission.phase().pipe(
          Effect.repeat({
            while: (phase) => phase === 'open',
            schedule: Schedule.spaced(Duration.millis(10)),
          }),
        );

        const denied = yield* Effect.result(custodian.take(key('take-2'), taken.standing.revision, connection('server-2'), 'custodian'));
        return [
          taken,
          reached,
          denied,
          yield* custodian.current(),
          yield* Effect.result(custodian.check(taken.standing.epoch, connection('server-1'))),
          struck,
        ] as const;
      }).pipe(Effect.provide(over(state())));

      expect(killed).toBeGreaterThan(0);
      expect(phase).toBe('fenced');
      expect(tagOf(refused)).toBe('AdmissionRefused');
      expect(standing._tag).toBe('Settled');
      expect(standing._tag === 'Settled' && standing.custody.epoch).toBe(before.standing.epoch);
      expect(standing._tag === 'Settled' && String(standing.custody.holder?.connection)).toBe('server-1');
      expect(tagOf(checked)).toBe('success');
    }),
  );

  it.live(
    'a transition its writer could not record grants nothing, and its key reads back as never answered',
    Effect.fnUntraced(function* () {
      const directory = state();

      const outcome = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const executions = yield* ExecutionStore;
        const first = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');

        const struck = yield* killConnection();
        const dead = yield* Effect.result(executions.hostCustody()).pipe(
          Effect.repeat({
            while: Result.isSuccess,
            schedule: Schedule.spaced(Duration.millis(10)),
          }),
        );

        const denied = yield* Effect.result(custodian.take(key('take-2'), first.standing.revision, connection('server-2'), 'custodian'));
        return {
          first,
          dead,
          denied,
          held: yield* Effect.result(custodian.check(first.standing.epoch, connection('server-1'))),
          standing: yield* custodian.current(),
          struck,
        };
      }).pipe(Effect.provide(over(directory)));

      const read = yield* ExecutionStore.use((executions) => executions.custodyAnswer(key('take-2'))).pipe(Effect.provide(over(directory)));

      expect(outcome.struck).toBeGreaterThan(0);
      expect(Result.isFailure(outcome.dead)).toBe(true);
      expect(tagOf(outcome.denied)).toBe('AdmissionRefused');
      expect(tagOf(outcome.held)).toBe('success');
      expect(outcome.standing._tag).toBe('Settled');
      expect(read.answered).toBeUndefined();
      expect(read.standing.revision).toBe(outcome.first.standing.revision);
      expect(read.standing.epoch).toBe(outcome.first.standing.epoch);
      expect(String(read.standing.holder?.connection)).toBe('server-1');
    }),
  );

  it.live(
    'a lost custody reply resolves before a new take without granting twice under its original key',
    Effect.fnUntraced(function* () {
      const outcome = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const writer = yield* ExecutionStore;
        const first = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');
        const crossing = yield* Effect.result(custodian.take(key('take-2'), first.standing.revision, connection('server-2'), 'custodian'));
        const replaced = yield* Effect.result(custodian.check(first.standing.epoch, connection('server-1')));
        const granted = yield* Effect.result(custodian.check(2, connection('server-2')));
        const another = yield* Effect.result(custodian.take(key('take-3'), first.standing.revision, connection('server-3'), 'custodian'));
        expect(tagOf(another)).toBe('CustodyConflict');
        if (another._tag !== 'Failure' || another.failure._tag !== 'CustodyConflict')
          return yield* Effect.die(new Error(JSON.stringify(another)));
        const next = yield* custodian.take(key('take-4'), another.failure.standing.revision, connection('server-3'), 'custodian');
        return {
          crossing,
          replaced,
          granted,
          conflict: another.failure,
          next,
          repeated: yield* custodian.take(key('take-2'), first.standing.revision, connection('server-2'), 'custodian'),
          changed: yield* Effect.result(custodian.take(key('take-2'), first.standing.revision, connection('server-4'), 'custodian')),
          live: yield* custodian.check(next.standing.epoch, connection('server-3')),
          after: yield* writer.hostCustody(),
          charged: (yield* (yield* ExecutionCapacity).account()).custodyReceipts,
        };
      }).pipe(Effect.provide(losingOneReply(state(), 'take-2')));

      expect(tagOf(outcome.crossing)).toBe('CustodyLost');
      expect(tagOf(outcome.replaced)).toBe('CustodyLost');
      expect(tagOf(outcome.granted)).toBe('CustodyLost');
      expect(outcome.conflict.standing).toMatchObject({ revision: 2, epoch: 2, holder: { connection: connection('server-2') } });
      expect(outcome.next.standing).toMatchObject({ revision: 3, epoch: 3, holder: { connection: connection('server-3') } });
      expect(outcome.repeated._tag).toBe('Standing');
      expect(outcome.repeated._tag === 'Standing' && outcome.repeated.answered.epoch).toBe(2);
      expect(outcome.repeated.standing).toEqual(outcome.next.standing);
      expect(tagOf(outcome.changed)).toBe('OperationConflict');
      expect(outcome.live).toEqual(outcome.next.standing);
      expect(outcome.after).toEqual(outcome.next.standing);
      expect(outcome.charged).toBe(0);
    }),
  );

  it.live(
    'a rolled-back custody write lets the next key take the unchanged revision',
    Effect.fnUntraced(function* () {
      const directory = state();
      const outcome = yield* Effect.scoped(
        Effect.gen(function* () {
          const custodian = yield* Custodian;
          const writer = yield* ExecutionStore;
          const first = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');
          const database = yield* Effect.acquireRelease(
            Effect.sync(() => new Database(join(directory, 'executions.sqlite'))),
            (opened) => Effect.sync(() => opened.close()),
          );
          database.exec(
            "CREATE TRIGGER refuse_take BEFORE INSERT ON operation WHEN NEW.operation_id = 'take-2' BEGIN SELECT RAISE(ABORT, 'custody write refused'); END",
          );
          const crossing = yield* Effect.result(
            custodian.take(key('take-2'), first.standing.revision, connection('server-2'), 'custodian'),
          );
          const recorded = yield* writer.custodyAnswer(key('take-2'));
          const next = yield* Effect.result(custodian.take(key('take-3'), first.standing.revision, connection('server-3'), 'custodian'));
          return { first, crossing, recorded, next, standing: yield* custodian.current() };
        }),
      ).pipe(Effect.provide(over(directory)));

      expect(tagOf(outcome.crossing)).toBe('CustodyLost');
      expect(outcome.recorded.answered).toBeUndefined();
      expect(outcome.recorded.standing).toEqual(outcome.first.standing);
      expect(tagOf(outcome.next)).toBe('success');
      expect(outcome.next._tag === 'Success' && outcome.next.success.standing).toMatchObject({
        revision: 2,
        epoch: 2,
        holder: { connection: connection('server-3') },
      });
      expect(outcome.standing._tag === 'Settled' && outcome.standing.custody).toEqual(
        outcome.next._tag === 'Success' && outcome.next.success.standing,
      );
    }),
  );

  it.live(
    'one control slot admits successive transitions and remembers each earlier key',
    Effect.fnUntraced(function* () {
      const outcome = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const first = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');
        const next = yield* custodian.take(key('take-2'), first.standing.revision, connection('server-2'), 'custodian');
        const repeated = yield* custodian.take(key('take-1'), 0, connection('server-1'), 'custodian');
        return {
          first,
          next,
          repeated,
          live: yield* custodian.check(next.standing.epoch, connection('server-2')),
        } as const;
      }).pipe(Effect.provide(over(state(), 1)));

      expect(outcome.first.standing.epoch).toBe(1);
      expect(outcome.next.standing.epoch).toBe(2);
      expect(outcome.repeated._tag).toBe('Standing');
      expect(outcome.repeated._tag === 'Standing' && outcome.repeated.answered.epoch).toBe(1);
      expect(outcome.live.epoch).toBe(2);
    }),
  );
});
