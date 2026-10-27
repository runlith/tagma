import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { Assembled } from '@tagma/inspection/builtins';
import type { Plan, Scope, Sliced } from '@tagma/inspection/node/slices';
import type { Violation } from '@tagma/inspection/verdict';
import { Effect } from 'effect';
import type { WorkerAsk } from './asks.js';
import { InspectionFailed } from './inspectionLanes.js';
import { type Answered, slicedReading } from './slicing.js';

const inspection = { builtin: 'platforms', params: {} } as unknown as Assembled;
const subject = { root: '/repo', commit: 'c0ffee', inspection, places: [''], job: 'job' };
const plan: Plan = {
  envelope: { files: 10, mib: 1 },
  headroom: 0,
  slices: [
    { parts: [{ package: 'core', judged: true }], files: 2, bytes: 2 },
    { parts: [{ package: 'app', judged: true }], files: 2, bytes: 2 },
  ],
};
const found = (fingerprint: string): Violation => ({ fingerprint, file: 'f.ts', line: 1 });
const served = (payload: { readonly plan: Plan } | { readonly sliced: Sliced }, read: readonly string[] = []): Answered => ({
  id: 1,
  answered: true,
  read,
  installed: [],
  ms: 1,
  ...('plan' in payload ? { ...payload, compared: [] } : payload),
});
const failing = (cause: InspectionFailed['cause'], reason: string) => new InspectionFailed({ cause, reason });
const owners = (scope: Scope) => (scope.parts === 'whole' ? [] : scope.parts.map((part) => part.package));

it.effect('a sliced reading runs a waiting slice again once the slice it needs has answered, and merges every slice', () =>
  Effect.gen(function* () {
    const asked: (readonly (string | null)[])[] = [];
    let appRuns = 0;
    const ask = (message: WorkerAsk) => {
      if (message.kind === 'plan') return Effect.succeed(served({ plan }, ['package.json']));
      if (message.kind !== 'slice') return Effect.die('unexpected ask');
      asked.push(owners(message.scope));
      if (owners(message.scope).includes('core')) {
        return Effect.succeed(
          served(
            {
              sliced: {
                violations: [found('core -> x')],
                universal: [{ key: 'core\0browser\0fs', violation: found('core [browser] -> fs') }],
                needs: [],
              },
            },
            ['packages/core/src/a.ts'],
          ),
        );
      }
      appRuns += 1;
      return Effect.succeed(
        served(
          {
            sliced:
              appRuns === 1
                ? { violations: [], universal: [], needs: [{ platform: 'bun', file: 'packages/core/src/a.ts', package: 'core' }] }
                : { violations: [found('app -> y')], universal: [], needs: [] },
          },
          ['apps/app/src/b.ts'],
        ),
      );
    };
    const { reading, read } = yield* slicedReading(ask, subject, failing);
    expect(asked).toEqual([['core'], ['app'], ['core'], ['app']]);
    expect(reading.violations.map(({ fingerprint }) => fingerprint)).toEqual(['app -> y', 'core -> x', 'core [browser] -> fs']);
    expect([...read].sort()).toEqual(['apps/app/src/b.ts', 'package.json', 'packages/core/src/a.ts']);
  }),
);

it.effect('closure-work overflow splits a packed worker ask without changing either per-slice envelope', () =>
  Effect.gen(function* () {
    const packed: Plan = { ...plan, slices: [{ parts: plan.slices.flatMap(({ parts }) => parts), files: 4, bytes: 4 }] };
    const asked: (readonly (string | null)[])[] = [];
    const answer = (message: WorkerAsk) => {
      if (message.kind === 'plan') return Effect.succeed(served({ plan: packed }));
      if (message.kind !== 'slice') return Effect.die('unexpected ask');
      const names = owners(message.scope);
      asked.push(names);
      return names.length > 1
        ? Effect.fail(new InspectionFailed({ cause: 'source', reason: 'closure exceeded', split: true }))
        : Effect.succeed(served({ sliced: { violations: [found(names[0]!)], universal: [], needs: [] } }));
    };
    const { reading } = yield* slicedReading(answer, subject, failing);
    expect(asked).toEqual([['core', 'app'], ['core'], ['app']]);
    expect(reading.violations.map(({ fingerprint }) => fingerprint)).toEqual(['app', 'core']);
  }),
);

it.effect('a slice past its envelope fails the reading and names the packages that slice holds', () =>
  Effect.gen(function* () {
    const ask = (message: WorkerAsk) =>
      message.kind === 'plan'
        ? Effect.succeed(served({ plan }))
        : Effect.fail(new InspectionFailed({ cause: 'envelope', reason: 'platforms is not judged: the subject is too large' }));
    const error = yield* Effect.flip(slicedReading(ask, subject, failing));
    expect(error.cause).toBe('envelope');
    expect(error.reason).toContain('the slice of core at c0ffee');
  }),
);
