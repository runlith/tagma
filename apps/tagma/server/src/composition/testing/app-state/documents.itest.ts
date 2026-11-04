import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Queue, Stream } from 'effect';
import { Documents } from '../../../app-state/contract/service/documents.js';
import type { AppDocument, AppStateEvent } from '../../../app-state/contract/wire/documents.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';

const fixture = doorFixture();

type Written = { readonly status: 'written'; readonly revision: number };

type Read = { readonly status: 'read'; readonly documents: readonly AppDocument[]; readonly revision: number };

it.live('a written document reaches the feed with its revision and writer, and the read answers what stands after a removal', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const [dock, rail] = [`${world.uniqueName()}.dock`, `${world.uniqueName()}.rail`];
    const documents = Context.get(world.runtime.owners as Context.Context<Documents>, Documents);
    const events = yield* Queue.unbounded<AppStateEvent>();
    yield* Effect.forkScoped(Stream.runForEach(documents.changes, (event) => Queue.offer(events, event)));
    const opened = yield* Queue.take(events);
    expect(opened.kind).toBe('current');

    const write = Effect.fnUntraced(function* (key: string, value: string | null, writer: string) {
      const answered = yield* world.op('write_app_state', { key, value, writer });
      expect(answered.status).toBe(200);
      return (answered.body as Written).revision;
    });
    const first = yield* write(dock, '{"members":[1,2]}', 'window-a');
    expect(first).toBeGreaterThan(opened.revision);
    expect(yield* Queue.take(events)).toEqual({
      kind: 'changed',
      key: dock,
      value: '{"members":[1,2]}',
      revision: first,
      writer: 'window-a',
    });

    const second = yield* write(rail, '{"pinned":["agents"]}', 'window-b');
    const removed = yield* write(dock, null, 'window-b');
    expect([second > first, removed > second]).toEqual([true, true]);
    expect(yield* Queue.take(events)).toMatchObject({ key: rail, revision: second });
    expect(yield* Queue.take(events)).toEqual({ kind: 'changed', key: dock, value: null, revision: removed, writer: 'window-b' });

    const read = yield* world.op('read_app_state', {});
    expect(read.status).toBe(200);
    const answer = read.body as Read;
    expect(answer.documents.filter((document) => document.key === dock || document.key === rail)).toEqual([
      { key: rail, value: '{"pinned":["agents"]}', revision: second },
    ]);
    expect(answer.revision).toBeGreaterThanOrEqual(removed);
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);
