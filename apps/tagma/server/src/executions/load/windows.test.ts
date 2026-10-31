import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { WindowDeclaration } from '../contract/wire/load.js';
import { makeWindowDeclarations } from './windows.js';

const declaration = (...pids: number[]): WindowDeclaration => ({
  precisionMs: 5,
  processes: pids.map((pid) => ({ pid, createdMs: 1_000 + pid, kind: 'renderer', documents: [{ _tag: 'Interface' }] })),
});

it.effect(
  'a newer generation replaces a window’s declaration, an older one is ignored, end drops only its own generation, and windows add up',
  () =>
    Effect.gen(function* () {
      const windows = yield* makeWindowDeclarations;
      const pids = Effect.map(windows.declared, (parts) => parts.map((one) => one.pid).toSorted((left, right) => left - right));
      yield* windows.declare('a', 1, declaration(10, 11));
      yield* windows.declare('b', 1, declaration(20));
      yield* windows.declare('a', 2, declaration(12));
      expect(yield* pids).toEqual([12, 20]);
      yield* windows.declare('a', 1, declaration(13));
      yield* windows.end('a', 1);
      expect(yield* pids).toEqual([12, 20]);
      const [part] = yield* windows.declared;
      expect(windows.part(part!.key)).toMatchObject({ host: 'a', process: { pid: 12 } });
      expect(part?.precisionMs).toBe(5);
      yield* windows.end('a', 2);
      expect(yield* pids).toEqual([20]);
    }),
);
