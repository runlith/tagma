import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Clock, Effect, Exit, type Scope } from 'effect';
import { inboxTurnValues } from '../../inboxItems';
import type { ThreadChangeRevision } from '../../state';
import type { ThreadMetadataRow } from '../../rows';
import type { ThreadPortFailure } from '../../ThreadBorder';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadStorageFactory } from '../storagePort';
import { appendEvent, entry, INSTANCE, OWNER, SCOPE, started, startInput } from './support';
export function describeThreadRevisionPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: a thread's change revision`, () => {
    test(
      'one read cut retains metadata and inbox facts across a same-head committed write',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        let expired: Effect.Effect<ThreadMetadataRow | undefined, ThreadPortFailure> = Effect.die('No read cut was opened.');
        yield* harness.aggregate.readCut(
          thread.id,
          Effect.fnUntraced(function* (cut) {
            expired = harness.aggregate.metadata(thread.id, cut.tx);
            expect((yield* harness.aggregate.metadata(thread.id, cut.tx))?.budgetTokens).toBeNull();
            yield* harness.aggregate.transaction((tx) =>
              Effect.andThen(
                harness.aggregate.update(thread.id, { budgetTokens: 7 }, tx),
                harness.inbox.put(inboxTurnValues(thread.id, { id: 'cut-turn', text: 'Next.' }), tx),
              ),
            );
            expect((yield* harness.aggregate.metadata(thread.id, cut.tx))?.budgetTokens).toBeNull();
            expect(yield* harness.inbox.pending(thread.id, cut.tx)).toEqual([]);
            expect(yield* harness.transitions.revision(thread.id, cut.tx)).toBe(cut.revision);
            expect(yield* harness.eventLog.headPosition(thread.id, cut.tx)).toBe(cut.position);
          }),
        );
        expect((yield* harness.aggregate.metadata(thread.id))?.budgetTokens).toBe(7);
        expect((yield* harness.inbox.pending(thread.id)).map((item) => item.id)).toEqual(['cut-turn']);
        expect(yield* Effect.flip(expired)).toBeInstanceOf(ThreadStorageFailed);
        const refused = { kind: 'declined' as const };
        expect(yield* Effect.flip(harness.aggregate.readCut(thread.id, () => Effect.fail(refused)))).toBe(refused);
      }),
    );
    test(
      'a run start, a heartbeat, an arrival, a journal fact and a metadata write each advance it',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const seen = [yield* harness.transitions.revision(thread.id)];
        const advanced = Effect.fnUntraced(function* () {
          const now = yield* harness.transitions.revision(thread.id);
          expect(now).toBeGreaterThan(seen.at(-1)!);
          seen.push(now);
        });
        const run = yield* started(runs.createRun(startInput(thread)));
        yield* advanced();
        yield* runs.writeHeartbeats([run.id], new Date((yield* Clock.currentTimeMillis) + 1_000));
        yield* advanced();
        yield* harness.inbox.put(inboxTurnValues(thread.id, { id: 'turn-1', text: 'Next.' }));
        yield* advanced();
        yield* appendEvent(harness, { threadId: thread.id, id: 'event:a', kind: 'message', payload: { entry: entry('a', run.id) } });
        yield* advanced();
        yield* harness.aggregate.transaction((tx) => harness.aggregate.update(thread.id, { budgetTokens: 7 }, tx));
        yield* advanced();
      }),
    );
    test(
      'a unit names each thread’s revision before its first write and after its last; a unit that rolls back names none',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const both = [thread.id, other.id];
        const named: ReadonlyMap<string, ThreadChangeRevision>[] = [];
        const name = (revisions: ReadonlyMap<string, ThreadChangeRevision>) => Effect.sync(() => void named.push(revisions));
        const before = yield* harness.transitions.revision(thread.id);
        const otherBefore = yield* harness.transitions.revision(other.id);
        yield* harness.aggregate.transaction((tx) =>
          Effect.gen(function* () {
            yield* harness.transitions.opened(both, tx);
            yield* harness.eventLog.append({ threadId: thread.id, id: 'event:b', kind: 'message', payload: { entry: entry('b') } }, tx);
            yield* harness.eventLog.append({ threadId: thread.id, id: 'event:c', kind: 'message', payload: { entry: entry('c') } }, tx);
            yield* harness.transitions.revised(both, tx, name);
          }),
        );
        expect(named).toHaveLength(1);
        expect(named[0]!.get(thread.id)).toEqual({ from: before, to: yield* harness.transitions.revision(thread.id) });
        expect(named[0]!.get(other.id)).toEqual({ from: otherBefore, to: yield* harness.transitions.revision(other.id) });
        expect(named[0]!.get(thread.id)!.to).toBeGreaterThan(before);
        const refused = yield* Effect.exit(
          harness.aggregate.transaction((tx) =>
            Effect.gen(function* () {
              yield* harness.transitions.opened([thread.id], tx);
              yield* harness.eventLog.append({ threadId: thread.id, id: 'event:d', kind: 'message', payload: { entry: entry('d') } }, tx);
              yield* harness.transitions.revised([thread.id], tx, name);
              return yield* Effect.fail('refused' as const);
            }),
          ),
        );
        expect(Exit.isFailure(refused)).toBe(true);
        expect(named).toHaveLength(1);
        expect(yield* harness.transitions.revision(thread.id)).toBe(named[0]!.get(thread.id)!.to);
      }),
    );
  });
}
