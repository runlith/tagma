import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, type Layer } from 'effect';
import { Holder, type PaceAsk } from '../Holder';
import { Adapter, PIPES, PTY, launch, pipes, readUntil, terminal, using } from './Adapter';

export const launchTempoContracts = (name: string, services: Layer.Layer<Adapter | Holder, unknown>) =>
  layer(services, { excludeTestServices: true })(`${name} launch tempo contracts`, (it) => {
    for (const transport of [PTY, PIPES]) {
      for (const pace of ['full', 'low', 'lowest'] as const) {
        it.effect(`${transport._tag}: starts ${pace === 'lowest' ? 'the leader' : 'the child and its fork'} at ${pace}`, () =>
          Effect.gen(function* () {
            const adapter = yield* Adapter;
            const expected = yield* adapter.priorities((yield* Holder).pid);
            const child = yield* launch(transport, 'fork', undefined, pace);
            yield* using(
              child,
              Effect.gen(function* () {
                const source = transport._tag === 'pty' ? terminal(child) : pipes(child).stdout;
                const descendant = Number((yield* readUntil(source, '\n')).toString().trim());
                expect(descendant).toBeGreaterThan(0);
                expect(child.pace).toBe(pace);
                if (pace === 'lowest') {
                  expect(yield* adapter.background(child.pid)).toBe(true);
                } else {
                  expect(yield* adapter.priority(child.pid)).toBe(expected[pace]);
                  expect(yield* adapter.priority(descendant)).toBe(expected[pace]);
                }
              }),
            );
          }),
        );
      }
    }

    it.effect('answers one outcome per process asked, in order, for none, one and many', () =>
      Effect.gen(function* () {
        const holder = yield* Holder;
        const child = yield* launch(PIPES, 'wait');
        yield* using(
          child,
          Effect.gen(function* () {
            const live: PaceAsk = { witness: { pid: child.pid, birth: child.birth }, initial: 'full', next: 'full' };
            const stale: PaceAsk = { witness: { pid: child.pid, birth: '1:1' }, initial: 'full', next: 'full' };
            expect(yield* holder.pace([])).toEqual([]);
            expect(yield* holder.pace([live])).toEqual([{ _tag: 'held' }]);
            expect(yield* holder.pace(Array.from({ length: 12 }, () => live))).toEqual(
              Array.from({ length: 12 }, () => ({ _tag: 'held' })),
            );
            const mixed = Array.from({ length: 12 }, (_, at) => (at % 3 === 1 ? stale : live));
            const kept = yield* holder.pace(mixed);
            expect(kept.map((one) => (one._tag === 'refused' ? one.reason : one._tag))).toEqual(
              mixed.map((ask) => (ask === stale ? 'changed' : 'held')),
            );
          }),
        );
      }),
    );
  });
