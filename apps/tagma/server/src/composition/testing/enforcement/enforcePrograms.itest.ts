import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Clock, Effect } from 'effect';
import { changeChecked, checksIn, headChecked, targetsOf } from '../../../enforcement/testing/wiring.js';
import { ProgramRoad } from '../../../executions/contract/service/programs.js';
import { localRoad } from '../../../executions/testing/road.js';
import { ENFORCEMENT_OPERATIONS } from '../../../enforcement/contract/wire/operationCatalog.js';
import { inputDecoder } from '../../../invocation/contract/service/input.js';
import { execute, perform } from '../../../invocation/testing/performing.js';
import { refusalOf } from '../graphFixture.js';
import type { Unbased } from '../../../enforcement/testing/based.js';
import { bodies, enforceFixture, operator, withEnforcement } from './enforceFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';

layer(enforceFixture(), { excludeTestServices: true, testTimeout: 60_000, timeout: 60_000 })('bound enforcement', (it) => {
  it.effect('keeps a measurement across graph and foreign-source commits, but refuses changes inside the rule reach', () =>
    withEnforcement((fx) =>
      Effect.fnUntraced(function* () {
        const rule = yield* fx.created(['rule'], 'Keep core imports downward', { sources: [{ kind: 'dir', ref: 'src/core' }] });
        const owner = yield* fx.created(['task'], 'Move the view off the panel');
        const input: Unbased = {
          blockId: rule,
          strictness: 'gate',
          inspection: LAYERED_KEY,
          owner,
        };
        const measured = yield* fx.planned(input);
        yield* fx.wrote('.tagma/neighbor.md', 'another rule was enforced\n');
        yield* fx.wrote('src/ui/panel.ts', 'export const panel = 2;\n');
        yield* fx.committed('change graph and code outside the rule reach');
        yield* fx.working(execute(bodies.enforce_rule, fx.written(input), measured, operator));
        expect((yield* fx.documentOf(rule))?.strictness).toBe('gate');
        const again = yield* fx.planned({ blockId: rule, strictness: 'watch' });
        yield* fx.wrote('src/core/added.ts', 'export const added = 1;\n');
        yield* fx.committed('add a source inside the rule reach');
        const stale = yield* fx.working(
          refusalOf(execute(bodies.enforce_rule, fx.written({ blockId: rule, strictness: 'watch' }), again, operator)),
        );
        expect(stale.code).toBe('enforcement-stale');
        expect(stale.reason).toContain('src/core/added.ts');
        expect((yield* fx.documentOf(rule))?.strictness).toBe('gate');
      })(),
    ),
  );
  it.effect('refuses a bound measurement after a resolver outside the rule reach changes its imports', () =>
    withEnforcement((fx) =>
      Effect.fnUntraced(function* () {
        const config = (target: string) => JSON.stringify({ compilerOptions: { paths: { $target: [target] } } });
        yield* fx.wrote('src/core/read.ts', "import { model } from '$target';\nexport const read = model;\n");
        yield* fx.wrote('tsconfig.json', config('./src/core/model.ts'));
        yield* fx.committed('seed an aliased core consumer');
        const rule = yield* fx.created(['rule'], 'Keep core imports downward', { sources: [{ kind: 'dir', ref: 'src/core' }] });
        const owner = yield* fx.created(['task'], 'Move the view off the panel');
        const input: Unbased = { blockId: rule, strictness: 'gate', inspection: LAYERED_KEY, owner };
        const measured = yield* fx.planned(input);
        yield* fx.wrote('tsconfig.json', config('./src/ui/panel.ts'));
        yield* fx.committed('move the alias into the upper floor');
        const stale = yield* fx.working(refusalOf(execute(bodies.enforce_rule, fx.written(input), measured, operator)));
        expect(stale.code).toBe('enforcement-stale');
        expect(stale.reason).toContain('tsconfig.json');
        expect(yield* fx.documentOf(rule)).toBeUndefined();
      })(),
    ),
  );
  it.effect('runs the project program a key of the config names from a decoded check request', () =>
    withEnforcement((fx) =>
      Effect.fnUntraced(function* () {
        yield* fx.wrote(
          'checks/law.ts',
          [
            "import { defineProgram } from '@runlith/tagma/rules';",
            'export default defineProgram({',
            "  'effect-style': async ({ tree }) => {",
            '    const findings = [];',
            '    for (const path of tree.paths) {',
            "      ((await tree.read(path)) ?? '').split('\\n').forEach((line, at) => {",
            "        if (line.includes('() => Effect.gen(')) findings.push({ fingerprint: `${path} gen-wrapper`, path, line: at + 1, message: 'gen wrapper' });",
            '      });',
            '    }',
            '    return { tree: { findings } };',
            '  },',
            '});',
            '',
          ].join('\n'),
        );
        yield* fx.wrote(
          'src/core/work.ts',
          "import { Effect } from 'effect';\nexport const work = () => Effect.gen(function* () { return 1; });\n",
        );
        yield* fx.committed('install the project checker');
        fx.demo.described.set('effect-style', {
          program: 'checks/law.ts',
          name: 'effect-style',
          concern: 'code',
          needs: [],
          files: ['src/**/*.ts'],
          params: { base: '', region: ['src/'], files: { extensions: ['.ts'], exclude: [] }, forms: ['gen-wrapper'] },
        });
        const raw = JSON.parse(JSON.stringify({ over: 'all', inspection: 'effect-style' }));
        const tree = yield* fx.head();
        const road = localRoad([]);
        let elapsed = 0;
        const timedRoad = ProgramRoad.of({
          run: Effect.fnUntraced(function* (launch) {
            const started = yield* Clock.monotonicTimeNanos;
            const ending = yield* road.run(launch);
            elapsed = Math.round(Number((yield* Clock.monotonicTimeNanos) - started) / 1e6);
            return ending;
          }),
        });
        const checked = yield* fx.working(
          Effect.gen(function* () {
            const input = yield* inputDecoder(ENFORCEMENT_OPERATIONS.check_rules.input)(raw);
            const caller = { _tag: 'Operator' as const };
            const ask = { projectId: fx.demo.projectId, caller, rules: 'all' as const, inspection: input.inspection };
            const version = { projectId: fx.demo.projectId, actor: caller, root: fx.demo.demoRoot, tree };
            return yield* headChecked(ask, yield* targetsOf(ask, version), { root: version.root, head: version.tree });
          }).pipe(Effect.provideService(ProgramRoad, timedRoad)),
        );
        expect(checked.violations).toMatchObject([
          { rule: '', fingerprint: expect.stringContaining('effect-style '), file: 'src/core/work.ts', line: 2 },
        ]);
        expect(checked.rules[0]!.ms).toBeGreaterThanOrEqual(elapsed);
        expect((yield* fx.working(perform(bodies.read_enforcement, {}, operator))).counts?.enforced).toBe(0);
        const rule = yield* fx.created(['rule'], 'Use effect functions');
        const owner = yield* fx.created(['task'], 'Replace generator wrappers');
        const enforced = yield* fx
          .enforce({
            blockId: rule,
            strictness: 'gate',
            inspection: 'effect-style',
            owner,
            on: [{ op: 'submit_work', phase: 'before' }],
          })
          .pipe(Effect.provideService(ProgramRoad, timedRoad));
        expect(enforced.ms!).toBeGreaterThanOrEqual(elapsed);
        const engine = (yield* fx.working(perform(bodies.read_enforcement, { rule }, operator))).engine;
        expect(engine?.row.measured?.ms).toBe(enforced.ms!);
        yield* fx.wrote(
          'src/core/work.ts',
          "import { Effect } from 'effect';\nexport const work = () => Effect.gen(function* () { return 1; });\nexport const more = () => Effect.gen(function* () { return 2; });\n",
        );
        yield* fx.committed('add a generator wrapper');
        const built = yield* fx.head();
        const change = {
          kind: 'tree' as const,
          projectId: fx.demo.projectId,
          root: fx.demo.demoRoot,
          base: tree,
          built,
          paths: ['src/core/work.ts'],
          caller: { _tag: 'Operator' as const },
        };
        const ask = { projectId: fx.demo.projectId, caller: change.caller, rules: [rule] };
        const version = { projectId: fx.demo.projectId, actor: change.caller, root: change.root, tree: built };
        const changed = yield* fx.working(
          Effect.gen(function* () {
            return yield* changeChecked(ask, yield* targetsOf(ask, version), change);
          }).pipe(Effect.provideService(ProgramRoad, timedRoad)),
        );
        expect(changed.refuses).toBe(true);
        expect(changed.rules[0]!.ms).toBeGreaterThanOrEqual(elapsed);
        const gated = yield* fx.working(
          Effect.gen(function* () {
            return yield* (yield* checksIn).before('submit_work', change);
          }).pipe(Effect.provideService(ProgramRoad, timedRoad)),
        );
        expect(gated.refused?.code).toBe('rule-violated');
        expect(gated.runs?.[0]!.ms).toBeGreaterThanOrEqual(elapsed);
        expect(gated.refused?.reason).toContain(`${gated.runs![0]!.ms} ms`);
      })(),
    ),
  );
});
