import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import { gitEffect } from '../graphFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { based } from '../../../enforcement/testing/based.js';
import { perform, prepare } from '../../../invocation/testing/performing.js';
import { withServedTree } from '../../../invocation/testing/call.js';
import { block } from '../../../graph/store/tables.js';
const asked = (fx: EnforcementFixture, input: Parameters<typeof based>[0]) =>
  fx.working(
    Effect.flatMap(based(input), (full) =>
      Effect.map(prepare(bodies.enforce_rule, full, operator), (plan) => plan.consents.map((one) => one.condition)),
    ),
  );
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('enforce_rule', () => {
    it.effect('a first enforcement asks before a violation no owner removes, and with owners records the debt found at HEAD', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          expect(yield* asked(fx, { blockId: rule, strictness: 'gate', inspection: LAYERED_KEY })).toEqual(['debt-unowned']);
          const enforced = yield* fx.enforce({
            blockId: rule,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          });
          expect(enforced.debt.after).toBe(1);
          const document = yield* fx.documentOf(rule);
          expect(document?.strictness).toBe('gate');
          expect(document?.on).toEqual([]);
          expect(document?.debt).toEqual([{ fingerprint: 'app order core/view.ts -> ui/', owner }]);
        })(),
      ),
    );
    it.effect('a violation whose owner is no standing task or spec asks first, and once consented stands as escaped rather than debt', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const idea = yield* fx.created(['idea'], 'The view reads the panel');
          const input = {
            blockId: rule,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': idea },
          } as const;
          expect(yield* asked(fx, input)).toEqual(['debt-unowned']);
          const enforced = yield* fx.enforce(input);
          expect([enforced.debt.after, enforced.escaped]).toEqual([0, 1]);
          expect((yield* fx.documentOf(rule))?.escaped.map((one) => one.fingerprint)).toEqual(['app order core/view.ts -> ui/']);
        })(),
      ),
    );
    it.effect(
      'a new violation asks at re-enforcement and stays outside the debt, and absorbing it with an owner records it in the debt and the journal',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'note',
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            yield* fx.wrote('src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
            yield* fx.committed('an upward import');
            expect(yield* asked(fx, { blockId: rule, strictness: 'gate' })).toEqual(['debt-grows']);
            const grown = yield* fx.enforce({ blockId: rule, strictness: 'gate' });
            expect([grown.debt.after, grown.escaped]).toEqual([1, 1]);
            const absorbed = yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              absorb: ['app order core/boot.ts -> app/'],
              owners: { 'app order core/boot.ts -> app/': owner },
            });
            expect(absorbed.debt.after).toBe(2);
            expect((yield* fx.documentOf(rule))?.debt.map((entry) => entry.fingerprint).sort()).toEqual([
              'app order core/boot.ts -> app/',
              'app order core/view.ts -> ui/',
            ]);
            const [entry] = yield* fx.journal(rule);
            expect(
              (
                JSON.parse(entry?.payload ?? '{}') as {
                  absorbed: {
                    fingerprint: string;
                  }[];
                }
              ).absorbed.map((one) => one.fingerprint),
            ).toEqual(['app order core/boot.ts -> app/']);
          })(),
        ),
    );
    it.effect('one owner adopts every violation a first enforcement finds, and absorb all takes every later one under it', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move every import downward');
          expect(yield* asked(fx, { blockId: rule, strictness: 'gate', inspection: LAYERED_KEY, owner })).toEqual([]);
          yield* fx.enforce({ blockId: rule, strictness: 'gate', inspection: LAYERED_KEY, owner });
          expect((yield* fx.documentOf(rule))?.debt).toEqual([{ fingerprint: 'app order core/view.ts -> ui/', owner }]);
          yield* fx.wrote('src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
          yield* fx.committed('an upward import');
          expect(yield* asked(fx, { blockId: rule, strictness: 'gate', absorb: 'all', owner })).toEqual([]);
          const absorbed = yield* fx.enforce({ blockId: rule, strictness: 'gate', absorb: 'all', owner });
          expect([absorbed.debt.after, absorbed.escaped]).toEqual([2, 0]);
          expect((yield* fx.documentOf(rule))?.debt.map((entry) => entry.owner)).toEqual([owner, owner]);
        })(),
      ),
    );
    it.effect('absorption refuses every fingerprint absent at HEAD without writing partial debt or a journal entry', () =>
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
          const standing = yield* fx.documentOf(rule);
          const entries = yield* fx.journal(rule);
          const fingerprint = 'app order core/boot.ts -> app/';
          yield* fx.wrote('src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
          const input = {
            blockId: rule,
            strictness: 'gate' as const,
            absorb: [fingerprint, 'app order core/view.ts -> ui/'],
            owners: { [fingerprint]: owner },
          };
          const refusal = yield* fx.refused(input);
          expect(refusal.code).toBe('inspection-failed');
          expect(refusal.reason).toContain(fingerprint);
          expect(refusal.reason).toContain(yield* fx.head());
          expect(yield* fx.documentOf(rule)).toEqual(standing);
          expect(yield* fx.journal(rule)).toEqual(entries);
          yield* fx.committed('an upward import to absorb');
          expect((yield* fx.enforce(input)).absorbed.map((entry) => entry.fingerprint)).toEqual([fingerprint]);
        })(),
      ),
    );
    it.effect('re-enforcement drops the debt no longer found', () =>
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
          yield* fx.wrote('src/core/view.ts', "import { model } from './model';\nexport const view = model;\n");
          yield* fx.committed('the view reads the model');
          const again = yield* fx.enforce({ blockId: rule, strictness: 'gate' });
          expect(again.debt.after).toBe(0);
          expect(again.retired).toEqual(['app order core/view.ts -> ui/']);
        })(),
      ),
    );
    it.effect('a checkout with no measurement of its own follows a renamed file from the commit before its rule file last changed', () =>
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
          const root = fx.demo.demoRoot;
          const id = yield* fx.demo.graph.blockNames.idOfName(rule);
          yield* fx.demo.graph.graphStore.db.update(block).set({ path: 'import-only-downward.md' }).where(eq(block.id, id));
          yield* fx.wrote('.tagma/import-only-downward.md', 'the rule as the tree carries it\n');
          yield* fx.committed('the graph lands beside the code');
          rmSync(join(root, '.git', 'tagma'), { recursive: true, force: true });
          yield* gitEffect(root, ['mv', 'src/core/view.ts', 'src/core/screen.ts']);
          yield* fx.committed('the view is renamed');
          const tree = { treeRoot: join(root, '.tagma'), conflicts: () => Effect.succeed([]) };
          const again = yield* fx.working(
            Effect.flatMap(based({ blockId: rule, strictness: 'gate' }), (full) => perform(bodies.enforce_rule, full, operator)).pipe(
              withServedTree(tree),
            ),
          );
          expect(again.debt.after).toBe(1);
          expect((yield* fx.documentOf(rule))?.debt).toEqual([{ fingerprint: 'app order core/screen.ts -> ui/', owner }]);
        })(),
      ),
    );
    it.effect('re-enforcement resolves the owner of every kept entry again', () =>
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
          yield* fx.demo.graph.tasks.finish({ id: yield* fx.demo.graph.blockNames.idOfName(owner) });
          expect(yield* asked(fx, { blockId: rule, strictness: 'gate' })).toEqual(['debt-unowned']);
        })(),
      ),
    );
    it.effect('a rule whose reach misses the inspection base refuses reach-empty', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward', { sources: [{ kind: 'dir', ref: 'docs' }] });
          expect((yield* fx.refused({ blockId: rule, strictness: 'gate', inspection: LAYERED_KEY })).code).toBe('reach-empty');
        })(),
      ),
    );
  });
});
