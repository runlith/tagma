import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { MINE } from '../checkoutFixture.js';
import { landingFixture, withLanding, type LandingFixture } from '../landingFixture.js';
import { checksOver, withLanes } from '../../../enforcement/testing/wiring.js';
import { type ActChecks, actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import type { LandedTree, TreeSubject } from '../../../enforcement/contract/wire/checks.js';
const UPWARD = "import { main } from '../app/main';\nexport const boot = main;\n";
const raced = <E>(gate: LandingFixture, moved: Effect.Effect<void, E>) => {
  const graphOf = () => Effect.succeed(withLanes(gate.demo.context, gate.workers));
  const real = actChecks(checksOver({ graphOf }), 'submit_work');
  const judged: TreeSubject[] = [];
  const handed: LandedTree[] = [];
  const checks: ActChecks = {
    before: (subject) =>
      Effect.tap(real.before(subject), () => (subject.kind === 'tree' && judged.push(subject) === 1 ? Effect.orDie(moved) : Effect.void)),
    after: (one) => Effect.sync(() => void (one.kind === 'tree' ? handed.push(one) : undefined)),
  };
  return { checks, judged, handed };
};
const hooked = (dir: string, hook: string, path: string, text: string) => {
  const at = join(dir, '.git', 'hooks', hook);
  const blob = `blob=$(printf "${text.replaceAll('\n', '\\n')}" | git hash-object -w --stdin)`;
  writeFileSync(at, `#!/bin/sh\n${blob} && git update-index --add --cacheinfo "100644,$blob,${path}"\n`);
  chmodSync(at, 0o755);
  return () => rmSync(at, { force: true });
};
layer(landingFixture(), { excludeTestServices: true })('landing enforcement', (it) => {
  it.effect(
    'a base that moves between the judgement and the publication is judged again, and what lands and reaches the driver is the tree judged on the moved base',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          yield* gate.wrote(MINE, 'src/core/extra.ts', 'export const extra = 1;\n');
          let moved = '';
          const race = raced(
            gate,
            Effect.gen(function* () {
              yield* gate.put('src/ui/aside.ts', 'export const aside = 1;\n');
              yield* gate.sh(['add', '--', 'src/ui/aside.ts']);
              yield* gate.sh(['commit', '-qm', 'aside']);
              moved = yield* gate.sh(['rev-parse', 'HEAD']);
            }),
          );
          const { commit: landed } = gate.landed(yield* gate.submit(MINE, { checks: race.checks }));
          expect(race.judged.map((one) => one.base === moved)).toEqual([false, true]);
          expect(yield* gate.sh(['rev-parse', `${landed}^`])).toBe(moved);
          expect(race.judged[1]?.built).toBe(yield* gate.sh(['rev-parse', `${landed}^{tree}`]));
          expect(race.handed.map(({ commit, base }) => ({ commit, base }))).toEqual([{ commit: landed, base: moved }]);
        })(),
      ),
  );
  it.effect(
    'a pre-commit hook that brings a gated crossing into the tree it commits is judged on that tree and refused, and nothing lands',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          yield* gate.wrote(MINE, 'src/core/extra.ts', 'export const extra = 1;\n');
          const before = yield* gate.sh(['rev-parse', 'HEAD']);
          yield* Effect.acquireUseRelease(
            Effect.sync(() => hooked(gate.demo.demoRoot, 'pre-commit', 'src/core/boot.ts', UPWARD)),
            () =>
              Effect.gen(function* () {
                const refusal = yield* gate.refused(MINE);
                expect(refusal.code).toBe('rule-violated');
                expect(refusal.reason).toContain('src/core/boot.ts');
              }),
            (unhook) => Effect.sync(unhook),
          );
          expect(yield* gate.sh(['rev-parse', 'HEAD'])).toBe(before);
        })(),
      ),
  );
});
