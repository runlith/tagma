import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { block, event } from '../../../graph/store/tables.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { refusalOf } from '../graphFixture.js';
import { headChecked, targetsOf } from '../../../enforcement/testing/wiring.js';
import { execute, perform } from '../../../invocation/testing/performing.js';
import type { Unbased } from '../../../enforcement/testing/based.js';
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('enforce_rule writes', () => {
    it.effect('a path added under the base between prepare and execute refuses the write; a commit outside the base does not', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          const input: Unbased = {
            blockId: rule,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          };
          const measured = yield* fx.planned(input);
          yield* fx.wrote('src/ui/extra.ts', 'export const extra = 1;\n');
          yield* fx.committed('a commit under the base');
          const stale = yield* fx.working(refusalOf(execute(bodies.enforce_rule, fx.written(input), measured, operator)));
          expect(stale.code).toBe('enforcement-stale');
          expect(yield* fx.documentOf(rule)).toBeUndefined();
          const again = yield* fx.planned(input);
          yield* fx.wrote('README.md', 'moved\n');
          yield* fx.committed('a commit outside the base');
          yield* fx.working(execute(bodies.enforce_rule, fx.written(input), again, operator));
          const engine = (yield* fx.working(perform(bodies.read_enforcement, { rule: again.rule }, operator))).engine;
          expect(engine?.row.measured?.commit).toBe(again.head ?? '');
        })(),
      ),
    );
    it.effect(
      'a changed file under the base that the inspection does not select leaves the write standing; a changed file it read refuses, naming it',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            const input: Unbased = {
              blockId: rule,
              strictness: 'gate',
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            };
            const measured = yield* fx.planned(input);
            yield* fx.wrote('src/core/view.test.ts', "import { model } from './model';\n");
            yield* fx.committed('an excluded file changes');
            yield* fx.working(execute(bodies.enforce_rule, fx.written(input), measured, operator));
            expect((yield* fx.documentOf(rule))?.strictness).toBe('gate');
            const again = yield* fx.planned({ blockId: rule, strictness: 'watch' });
            yield* fx.wrote('src/core/model.ts', 'export const model = 2;\n');
            yield* fx.committed('a selected file changes');
            const stale = yield* fx.working(
              refusalOf(execute(bodies.enforce_rule, fx.written({ blockId: rule, strictness: 'watch' }), again, operator)),
            );
            expect(stale.code).toBe('enforcement-stale');
            expect(stale.reason).toContain('src/core/model.ts');
            expect((yield* fx.documentOf(rule))?.strictness).toBe('gate');
          })(),
        ),
    );
    it.effect('a document that changed between prepare and execute refuses the write', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          const input: Unbased = {
            blockId: rule,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          };
          const measured = yield* fx.planned(input);
          yield* fx.enforce({ ...input, strictness: 'note' });
          const stale = yield* fx.working(refusalOf(execute(bodies.enforce_rule, fx.written(input), measured, operator)));
          expect(stale.code).toBe('enforcement-stale');
          expect((yield* fx.documentOf(rule))?.strictness).toBe('note');
        })(),
      ),
    );
    it.effect('a document that does not decode refuses every enforcement but off, and off removes it', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const ruleId = yield* fx.demo.graph.blockNames.idOfName(rule);
          yield* Effect.flatMap(MachineStore, ({ db }) =>
            db
              .update(block)
              .set({ fields: { enforcement: { strictness: 'gate' } } })
              .where(eq(block.id, ruleId)),
          );
          expect((yield* fx.refused({ blockId: rule, strictness: 'note', inspection: LAYERED_KEY })).code).toBe('field-invalid');
          const removed = yield* fx.enforce({ blockId: rule, strictness: 'off' });
          expect(removed.was).toBe('unreadable');
          expect(yield* fx.documentOf(rule)).toBeUndefined();
        })(),
      ),
    );
    it.effect('off removes the document, and the journal keeps the whole document it removed', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          yield* fx.enforce({
            blockId: rule,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          });
          const document = yield* fx.documentOf(rule);
          yield* fx.enforce({ blockId: rule, strictness: 'off' });
          expect(yield* fx.documentOf(rule)).toBeUndefined();
          const [entry] = yield* fx.journal(rule);
          expect(
            (
              JSON.parse(entry?.payload ?? '{}') as {
                was: unknown;
              }
            ).was,
          ).toEqual(document);
        })(),
      ),
    );
  });
  const checkedOverHead = (fx: EnforcementFixture, rule: string) =>
    fx.working(
      Effect.gen(function* () {
        const row = yield* fx.demo.graph.blocks.blockById(yield* fx.demo.graph.blockNames.idOfName(rule));
        const ask = { projectId: fx.demo.projectId, caller: null, rules: 'all' as const, inspection: LAYERED_KEY, row };
        const version = {
          projectId: fx.demo.projectId,
          actor: { _tag: 'Operator' } as const,
          root: fx.demo.demoRoot,
          tree: yield* fx.head(),
        };
        return yield* headChecked(ask, yield* targetsOf(ask, version), { root: version.root, head: version.tree });
      }),
    );
  describe('check over HEAD with an unsaved inspection', () => {
    it.effect("answers what a first enforcement would record over the rule's reach, and writes nothing", () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const events = Effect.fnUntraced(function* () {
            return (yield* Effect.flatMap(MachineStore, ({ db }) => db.select().from(event))).length;
          });
          const before = yield* events();
          const tried = yield* checkedOverHead(fx, rule);
          expect(tried.violations).toEqual([
            {
              rule,
              title: `inspection ${LAYERED_KEY}`,
              fingerprint: 'app order core/view.ts -> ui/',
              file: 'src/core/view.ts',
              line: 1,
              specifier: '../ui/panel',
              message: expect.any(String),
              fix: expect.any(String),
              generalFix: expect.any(String),
            },
          ]);
          expect(tried.rules).toEqual([{ rule, ms: expect.any(Number), reached: true }]);
          expect(yield* events()).toBe(before);
          expect(yield* fx.documentOf(rule)).toBeUndefined();
        })(),
      ),
    );
    it.effect('a rule with its own directory source reaches only that directory', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward', { sources: [{ kind: 'dir', ref: 'src/ui' }] });
          const tried = yield* checkedOverHead(fx, rule);
          expect(tried.violations).toEqual([]);
        })(),
      ),
    );
  });
});
