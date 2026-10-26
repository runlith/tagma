import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { describe, expect } from 'bun:test';
import { execute, perform, prepare } from '../../../invocation/testing/performing.js';
import { refusalOf } from '../graphFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import type { ENFORCEMENT_OPERATIONS } from '../../../enforcement/contract/wire/operationCatalog.js';
type Modules = InputOf<typeof ENFORCEMENT_OPERATIONS.set_module>;
const cardOf = Effect.fnUntraced(function* (fx: EnforcementFixture, id: string) {
  const card = (yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId)).find((one) => one.id === id);
  if (card === undefined) return yield* Effect.die(new Error(`no module card carries the id ${id}`));
  return card;
});
const set = (fx: EnforcementFixture, input: Modules) => fx.working(perform(bodies.set_module, input, operator));
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('set_module measurement freshness', () => {
    for (const change of ['importer', 'resolver', 'added resolver'] as const)
      it.effect(`a prepared narrowing refuses after a changed ${change} creates another importer`, () =>
        withEnforcement((fx) =>
          Effect.gen(function* () {
            yield* fx.wrote('src/app/other.ts', "import { model } from '$target';");
            const config = (target: string) => JSON.stringify({ compilerOptions: { paths: { $target: [target] } } });
            if (change !== 'added resolver') yield* fx.wrote('tsconfig.json', config('./src/core/model.ts'));
            yield* fx.committed('seed an aliased consumer');
            yield* set(fx, {
              modules: [
                { id: 'app', entries: { put: [{ at: '.' }] } },
                { id: 'consumer', title: 'Consumer', root: 'src/app', imports: { put: ['app'] } },
              ],
            });
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            const narrowing: Modules = { modules: [{ id: 'app', entries: { put: [{ at: 'ui/panel.ts', role: 'testing' }] } }] };
            const prepared = yield* fx.working(prepare(bodies.set_module, narrowing, operator));
            if (change === 'importer') yield* fx.wrote('src/app/other.ts', "import { panel } from '../ui/panel';");
            else yield* fx.wrote('tsconfig.json', config('./src/ui/panel.ts'));
            yield* fx.committed(`change the ${change}`);
            const refused = yield* fx.working(refusalOf(execute(bodies.set_module, narrowing, prepared, operator)));
            expect(refused.code).toBe('enforcement-stale');
            expect((yield* cardOf(fx, 'app')).entries).toEqual([{ at: '.' }]);
          }),
        ),
      );
    it.effect(
      'a change of the cards or of the map rules between prepare and the write refuses stale, and preparing again keeps both independent changes',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const entry = (at: string): Modules => ({ modules: [{ id: 'app', entries: { put: [{ at }] } }] });
            const ats = Effect.fnUntraced(function* () {
              return (yield* cardOf(fx, 'app')).entries?.map((one) => one.at);
            });
            const first = yield* fx.working(prepare(bodies.set_module, entry('core/model.ts'), operator));
            yield* set(fx, entry('ui/panel.ts'));
            const byCards = yield* fx.working(refusalOf(execute(bodies.set_module, entry('core/model.ts'), first, operator)));
            expect(byCards.code).toBe('enforcement-stale');
            expect(yield* ats()).toEqual(['ui/panel.ts']);
            const second = yield* fx.working(prepare(bodies.set_module, entry('app/main.ts'), operator));
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'note',
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            const byRules = yield* fx.working(refusalOf(execute(bodies.set_module, entry('app/main.ts'), second, operator)));
            expect(byRules.code).toBe('enforcement-stale');
            expect(yield* ats()).toEqual(['ui/panel.ts']);
            yield* set(fx, entry('core/model.ts'));
            yield* set(fx, entry('app/main.ts'));
            expect(yield* ats()).toEqual(['ui/panel.ts', 'core/model.ts', 'app/main.ts']);
          })(),
        ),
    );
    it.effect('a card moved between ordinary blocks, or a rule whose sources changed, refuses a stale write', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const root = yield* fx.demo.graph.blocks.rootBlockOf(fx.demo.projectId);
          const plain = Effect.fnUntraced(function* (title: string, parentId: number) {
            return (yield* fx.demo.graph.blocks.create({ projectId: fx.demo.projectId, parentId, title })).id;
          });
          const first = yield* plain('First shelf', root.id);
          const second = yield* plain('Second shelf', root.id);
          const third = yield* plain('Third shelf', root.id);
          const nameOf = (id: number) => fx.demo.nameOf(id);
          yield* set(fx, { modules: [{ id: 'core', title: 'Core', parent: yield* nameOf(first), root: 'src/core' }] });
          const core = yield* cardOf(fx, 'core');
          const move = (parent: string): Modules => ({ modules: [{ id: 'core', parent }] });
          const prepared = yield* fx.working(prepare(bodies.set_module, move(yield* nameOf(second)), operator));
          yield* set(fx, move(yield* nameOf(third)));
          const moved = yield* fx.working(refusalOf(execute(bodies.set_module, move(yield* nameOf(second)), prepared, operator)));
          expect(moved.code).toBe('enforcement-stale');
          expect((yield* fx.demo.graph.blocks.blockById(core.block)).parentId).toBe(third);
          const rule = yield* fx.created(['rule'], 'Import only downward');
          yield* fx.enforce({ blockId: rule, strictness: 'note', inspection: LAYERED_KEY });
          const entry: Modules = { modules: [{ id: 'app', entries: { put: [{ at: 'app/main.ts' }] } }] };
          const measured = yield* fx.working(prepare(bodies.set_module, entry, operator));
          const ruleId = yield* fx.demo.graph.blockNames.idOfName(rule);
          yield* fx.demo.graph.sources.attach({ blockId: ruleId, kind: 'dir', ref: 'src/core' });
          const reach = yield* fx.working(refusalOf(execute(bodies.set_module, entry, measured, operator)));
          expect(reach.code).toBe('enforcement-stale');
          expect((yield* cardOf(fx, 'app')).entries).toBeUndefined();
        })(),
      ),
    );
  });
});
