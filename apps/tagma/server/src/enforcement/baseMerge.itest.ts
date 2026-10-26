import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { MINE } from '../composition/testing/checkoutFixture.js';
import { landingFixture, type LandingFixture, withLanding } from '../composition/testing/landingFixture.js';
import { spawnedEffect } from '../platform/testing/spawn.js';

const CROSSING_B = "export const a = 1;\nimport { main } from '../app/main';\nexport const b = main;\nexport const c = 3;\n";

const baseWithCrossings = Effect.fnUntraced(function* (gate: LandingFixture) {
  yield* gate.sh(['checkout', '-q', '-b', 'base']);
  yield* gate.put('src/core/shared.ts', CROSSING_B);
  yield* gate.committed('the base takes a crossing into its debt');
  const owner = yield* gate.created(['task'], 'Move shared off the app');
  yield* gate.enforcedAt('gate', { 'app order core/view.ts -> ui/': owner, 'app order core/shared.ts -> app/': owner });
  yield* gate.put('src/core/late.ts', "import { main } from '../app/main';\nexport const late = main;\n");
  yield* gate.committed('a crossing that got in outside Tagma');
  return yield* gate.sh(['rev-parse', 'HEAD']);
});

const branchMerging = Effect.fnUntraced(function* (gate: LandingFixture, path: string, text: string) {
  const base = yield* baseWithCrossings(gate);
  yield* gate.sh(['checkout', '-q', 'main']);
  yield* gate.put(path, text);
  yield* gate.committed('the branch moves on its own');
  yield* gate.sh(['merge', '-q', '--no-ff', '--no-commit', 'base']);
  return base;
});

const fingerprints = (violations: readonly { readonly fingerprint: string }[] | undefined) => violations?.map((one) => one.fingerprint);

layer(landingFixture(), { excludeTestServices: true })('base merge', (it) => {
  it.effect('a base merge is judged against both parents and lands with the crossings already standing in the base', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        const base = yield* branchMerging(gate, 'src/ui/other.ts', 'export const other = 1;\n');
        const judged = yield* gate.staged();
        expect(judged.refused).toBeNull();
        expect(fingerprints(judged.crossed)).toEqual([]);
        const receipt = gate.landed(yield* gate.submit(MINE));
        expect(yield* gate.sh(['rev-parse', `${receipt.commit}^2`])).toBe(base);
        expect([receipt.watched, receipt.carriedViolations]).toEqual([undefined, undefined]);
      }),
    ),
  );

  it.effect('a crossing a conflict resolution brings into a base merge refuses, and the base’s standing crossings are not named', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        const base = yield* baseWithCrossings(gate);
        yield* gate.sh(['checkout', '-q', 'main']);
        yield* gate.put('src/core/shared.ts', 'export const a = 1;\nexport const b = 200;\nexport const c = 3;\n');
        yield* gate.committed('the branch moves on its own');
        const head = yield* gate.sh(['rev-parse', 'HEAD']);
        expect((yield* spawnedEffect(['git', 'merge', '-q', '--no-ff', '--no-commit', 'base'], { cwd: gate.demo.demoRoot })).exitCode).toBe(
          1,
        );
        yield* gate.wrote(MINE, 'src/core/shared.ts', `${CROSSING_B}import { panel } from '../ui/panel';\nexport const d = panel;\n`);
        yield* gate.sh(['add', 'src/core/shared.ts']);
        expect((yield* gate.refused(MINE)).code).toBe('walk-cut');
        const whole = ['src/core/shared.ts'];
        expect((yield* gate.refused(MINE, { whole })).code).toBe('rule-violated');
        const checked = yield* gate.checked(MINE, { whole });
        expect(checked?.violations.map(({ fingerprint, line, holders }) => ({ fingerprint, line, holders }))).toEqual([
          { fingerprint: 'app order core/shared.ts -> ui/', line: 5, holders: undefined },
        ]);
        expect(yield* gate.sh(['rev-parse', 'HEAD'])).toBe(head);
        expect(yield* gate.sh(['rev-parse', 'MERGE_HEAD'])).toBe(base);
      }),
    ),
  );
});
