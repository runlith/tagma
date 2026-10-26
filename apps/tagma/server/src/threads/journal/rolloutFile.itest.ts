import { appendFileSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { RolloutReads, type RolloutRead } from '../contract/service/rolloutReads.js';
import {
  ROLLOUT_BLOCK,
  appendRolloutItem,
  createRollout,
  readRolloutLine,
  replayRollout,
  rolloutEventOf,
  wholeLinesAfter,
  wholeLinesBefore,
} from './rolloutFile.js';

const collected = async <A>(source: AsyncGenerator<A>): Promise<A[]> => {
  const all: A[] = [];
  for await (const item of source) all.push(item);
  return all;
};

const fresh = () => join(mkdtempSync(join(tmpdir(), 'rollout-')), 'thread.jsonl');

describe('thread rollout', () => {
  it.live('meta first, items appended, replay gives all of it back', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1', model: 'gpt-5.2' });
      yield* appendRolloutItem(path, { kind: 'message', text: 'hello' });
      yield* appendRolloutItem(path, { kind: 'tool-call', name: 'graph' });
      const reads: RolloutRead[] = [];
      const rollout = yield* replayRollout(path).pipe(Effect.provideService(RolloutReads, (read) => reads.push(read)));
      expect([...new Set(reads.map((read) => read.path))]).toEqual([path]);
      expect(reads.reduce((sum, read) => sum + read.bytes, 0)).toBe(statSync(path).size);
      expect(rollout.meta).toEqual({ id: 't-1', model: 'gpt-5.2' });
      expect<unknown>(rollout.items).toEqual([
        { kind: 'message', text: 'hello' },
        { kind: 'tool-call', name: 'graph' },
      ]);
      expect(rollout.torn).toBe(false);
    }),
  );

  it.live('a torn final line is the crash signature: reported, items before it kept', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1' });
      yield* appendRolloutItem(path, { kind: 'message' });
      appendFileSync(path, '{"kind":"tool-call","na');
      const rollout = yield* replayRollout(path);
      expect<unknown>(rollout.items).toEqual([{ kind: 'message' }]);
      expect(rollout.torn).toBe(true);
    }),
  );

  it.live('a broken line in the middle is corruption and refuses', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1' });
      appendFileSync(path, 'not json at all\n');
      yield* appendRolloutItem(path, { kind: 'message' });
      expect((yield* Effect.flip(replayRollout(path))).reason).toBe('item-json');
    }),
  );

  it.live('a line that is valid JSON but no rollout record refuses the replay, like a broken one', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1' });
      appendFileSync(path, '{"kind":"event","row":"not a row"}\n');
      expect((yield* Effect.flip(replayRollout(path))).reason).toBe('item-json');
    }),
  );

  test('an event record is read as an event only when it carries its position, id, kind and payload', () => {
    const whole = readRolloutLine('{"kind":"event","row":{"position":3,"id":"e-3","kind":"message","payload":{"x":1}}}');
    if (!('record' in whole)) throw new Error('the whole record did not read');
    expect(rolloutEventOf(whole.record)?.position).toBe(3);

    const headless = readRolloutLine('{"kind":"event","row":{"position":3,"id":"e-3","kind":"message"}}');
    if (!('record' in headless)) throw new Error('the headless record did not read as a record');
    expect(rolloutEventOf(headless.record)).toBeNull();

    expect(readRolloutLine('not json')).toHaveProperty('failure');
    expect(readRolloutLine('42')).toEqual({ failure: 'is not a rollout record' });
  });

  it.live('an append after a torn tail cuts the fragment instead of welding onto it', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1' });
      yield* appendRolloutItem(path, { kind: 'message' });
      appendFileSync(path, '{"kind":"tool-call","na');
      yield* appendRolloutItem(path, { kind: 'ending' });
      const rollout = yield* replayRollout(path);
      expect(rollout.items).toEqual([{ kind: 'message' }, { kind: 'ending' }]);
      expect(rollout.torn).toBe(false);
    }),
  );

  it.live('a rollout that already exists refuses to be created over', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1' });
      expect((yield* Effect.flip(createRollout(path, { id: 't-2' }))).reason).toBe('io');
    }),
  );

  it.live('reading the lines backwards answers the same rows as reading them forwards', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1', padding: 'x'.repeat(ROLLOUT_BLOCK * 2) });
      for (let index = 1; index <= 40; index += 1) {
        yield* appendRolloutItem(path, { kind: 'event', row: { position: index, text: 'y'.repeat(index * 1_000) } });
      }
      const forwardReads: string[] = [];
      const backwardReads: string[] = [];
      const forwards = (yield* Effect.promise(() =>
        collected(wholeLinesAfter(path, 0, ({ path: read }) => void forwardReads.push(read))),
      )).map((entry) => entry.line);
      const backwards = (yield* Effect.promise(() =>
        collected(wholeLinesBefore(path, statSync(path).size, ({ path: read }) => void backwardReads.push(read))),
      )).map((entry) => entry.line);
      expect(forwards.length).toBeGreaterThan(4);
      expect(backwards).toEqual([...forwards].reverse());
      expect([...new Set(forwardReads)]).toEqual([path]);
      expect([...new Set(backwardReads)]).toEqual([path]);
    }),
  );

  it.live('a torn tail longer than a block is no line either way, and lines spanning many blocks read whole', () =>
    Effect.gen(function* () {
      const path = fresh();
      yield* createRollout(path, { id: 't-1' });
      yield* appendRolloutItem(path, { kind: 'event', row: { position: 1, text: 'é'.repeat(ROLLOUT_BLOCK * 2) } });
      yield* appendRolloutItem(path, { kind: 'event', row: { position: 2 } });
      appendFileSync(path, `{"kind":"event","row":{"position":3,"text":"${'z'.repeat(ROLLOUT_BLOCK * 3)}`);

      const forwards = yield* Effect.promise(() => collected(wholeLinesAfter(path, 0, () => undefined)));
      const backwards = yield* Effect.promise(() => collected(wholeLinesBefore(path, statSync(path).size, () => undefined)));

      expect(forwards.map((entry) => JSON.parse(entry.line).row?.position)).toEqual([undefined, 1, 2]);
      expect(backwards.map((entry) => entry.line)).toEqual(forwards.map((entry) => entry.line).reverse());
      expect(backwards.map((entry) => entry.start)).toEqual([0, ...forwards.slice(0, -1).map((entry) => entry.end)].reverse());
    }),
  );
});
