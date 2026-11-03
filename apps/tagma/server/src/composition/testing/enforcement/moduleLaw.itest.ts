import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect } from 'effect';
import { perform, prepare } from '../../../invocation/testing/performing.js';
import { LAYERED, LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import type { ENFORCEMENT_OPERATIONS } from '../../../enforcement/contract/wire/operationCatalog.js';
import { refusalOf } from '../graphFixture.js';
import { Enforcements } from './enforceFixture.js';
import { checksOver, withLanes } from '../../../enforcement/testing/wiring.js';
import { actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { MINE, PLACE } from '../checkoutFixture.js';
import { landingServices } from '../landingServices.js';
import { submitOver } from '../../../landing/testing/doubles.js';
import {
  claimPreparedInstance,
  judgingFns,
  makePreparedChanges,
  preparedReads,
  preparedBase,
  quietCommands,
  recordWrite,
} from '../../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { testPlace } from '../../../workspace/testing/doubles.js';
import type { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { atPlace, inWorkspace } from '../../../invocation/testing/call.js';
type Modules = InputOf<typeof ENFORCEMENT_OPERATIONS.set_module>;
const TESTED_KEY = 'tested';
const submitted = Effect.fnUntraced(function* (fx: EnforcementFixture) {
  const { workers } = yield* Enforcements;
  const served = withLanes(fx.demo.context, workers);
  const checks = actChecks(checksOver({ graphOf: () => Effect.succeed(served) }), 'submit_work');
  const services = yield* Effect.provide(landingServices, fx.demo.context);
  const inst = yield* claimPreparedInstance(preparedBase(fx.demo.graph.store));
  const producer = makePreparedChanges(preparedReads(quietCommands), judgingFns(CHECKOUT_DIRECTORY), inst.dir);
  const origin = { ...PLACE, generation: 0, work: { projectId: fx.demo.projectId, threadId: MINE } } as WorkingOrigin;
  return yield* Effect.ensuring(
    submitOver(
      fx.demo.graph.git,
      fx.demo.demoRoot,
      fx.demo.graph.store,
      fx.demo.graph.units,
      origin,
      { projectId: fx.demo.projectId, tasks: [], coAuthored: true, everything: false },
      checks,
      producer,
    ).pipe(Effect.provideContext(services)),
    inst.release,
  );
});
const FLIPPED = [['ui/'], ['core/'], ['app/']];
const OPENED = 'app order ui/panel.ts -> core/';
const moduleCard = Effect.fnUntraced(function* (fx: EnforcementFixture) {
  const [card] = yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId);
  return yield* fx.demo.graph.blocks.blockById(card!.block);
});
const cardOf = Effect.fnUntraced(function* (fx: EnforcementFixture, id: string) {
  const card = (yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId)).find((one) => one.id === id);
  if (card === undefined) return yield* Effect.die(new Error(`no module card carries the id ${id}`));
  return card;
});
const set = (fx: EnforcementFixture, input: Modules) => fx.working(perform(bodies.set_module, input, operator));
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('set_module enforcement', () => {
    it.effect('a boundary change that opens a violation asks first, and with absorb and owners lands the cards and the debt together', () =>
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
          const core = yield* fx.created(['rule'], 'Core imports only downward', { sources: [{ kind: 'dir', ref: 'src/core' }] });
          yield* fx.enforce({
            blockId: core,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          });
          const flipped: Modules = { modules: [{ id: 'app', order: [['ui/'], ['core/'], ['app/']] }] };
          const plan = yield* fx.working(prepare(bodies.set_module, flipped, operator));
          expect(plan.measured.flatMap((one) => one.consents.map((consent) => [consent.condition, consent.fact.includes(OPENED)]))).toEqual(
            [['debt-grows', true]],
          );
          const set = yield* fx.working(
            perform(bodies.set_module, { ...flipped, absorb: [OPENED], owners: { [OPENED]: owner } }, operator),
          );
          expect(set.rules).toHaveLength(2);
          expect(set.rules.find((one) => one.rule === rule)).toMatchObject({
            debt: { before: 1, after: 1 },
            retired: ['app order core/view.ts -> ui/'],
            absorbed: [{ fingerprint: OPENED, owner }],
          });
          expect(set.rules.find((one) => one.rule === core)).toMatchObject({
            debt: { before: 1, after: 0 },
            retired: ['app order core/view.ts -> ui/'],
            absorbed: [],
          });
          expect((yield* fx.documentOf(core))?.debt).toEqual([]);
          expect((yield* fx.documentOf(rule))?.debt).toEqual([{ fingerprint: OPENED, owner }]);
          expect((yield* moduleCard(fx)).fields.order).toEqual(FLIPPED);
        })(),
      ),
    );
    it.effect('a module whose id changes keeps its debt and its owner under the new id', () =>
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
          const result = yield* set(fx, { modules: [{ id: 'shell', block: (yield* cardOf(fx, 'app')).name }] });
          expect(result.rules.map((one) => [one.debt, one.retired, one.escaped])).toEqual([[{ before: 1, after: 1 }, [], []]]);
          expect((yield* fx.documentOf(rule))?.debt).toEqual([{ fingerprint: 'shell order core/view.ts -> ui/', owner }]);
        })(),
      ),
    );
    it.effect(
      'a lower module’s test reaching the module above is told to take imports-tests, which set_module writes beside the reverse relation',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            fx.demo.described.set(TESTED_KEY, { ...LAYERED, params: { ...LAYERED.params, files: { extensions: ['.ts'], exclude: [] } } });
            yield* fx.wrote('src/domain/rates.ts', 'export const rate = 1;\n');
            yield* fx.wrote('src/web/view.ts', "import { rate } from '../domain/rates';\nexport const view = rate;\n");
            yield* fx.committed('domain and the ui above it');
            const parent = yield* fx.demo.nameOf((yield* fx.demo.graph.blocks.rootBlockOf(fx.demo.projectId)).id);
            yield* set(fx, {
              modules: [
                { id: 'domain', title: 'Domain', parent, root: 'src/domain', entries: { put: [{ at: 'rates.ts' }] } },
                { id: 'ui', title: 'UI', parent, root: 'src/web', entries: { put: [{ at: 'view.ts' }] }, imports: { put: ['domain'] } },
              ],
            });
            const rule = yield* fx.created(['rule'], 'Import along relations');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              on: TRIGGERS.landing,
              inspection: TESTED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            const test = "import { view } from '../web/view';\nexport const seen = view;\n";
            yield* fx.wrote('src/domain/rates.test.ts', test);
            yield* recordWrite(fx.demo.graph.units, fx.demo.graph.store, fx.demo.projectId, MINE, testPlace('src/domain/rates.test.ts'), {
              before: '',
              after: test,
              mode: '100644',
            });
            const refused = yield* refusalOf(submitted(fx));
            expect(refused.code).toBe('rule-violated');
            expect(refused.reason).toContain('src/domain/rates.test.ts:1');
            expect(refused.reason).toContain('`imports-tests`');
            const homeRoot = yield* fx.demo.fixture.directory('thread-home');
            const home = yield* fx.demo.graph.projectLifecycle.create({ name: 'thread-home', rootPath: homeRoot });
            const thread: Caller = {
              actor: { kind: 'thread', threadId: MINE, projectId: home.id, principalId: 'tagma', session: { harness: 'tagma', key: MINE } },
              files: null,
            };
            yield* fx.working(
              perform(
                bodies.set_module,
                { modules: [{ id: 'domain', importsTests: { put: ['ui'] } }], project: fx.demo.projectId },
                thread,
              ).pipe(
                atPlace({ projectId: fx.demo.projectId, checkout: fx.demo.demoRoot, branch: null }),
                inWorkspace({ root: homeRoot, origin: null }),
              ),
            );
            expect((yield* cardOf(fx, 'domain')).importsTests).toEqual([(yield* cardOf(fx, 'ui')).block]);
            expect((yield* submitted(fx)).status).toBe('landed');
          })(),
        ),
    );
    it.effect('opening a card entry preserves existing debt without parsing unrelated consumers', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          yield* set(fx, { modules: [{ id: 'app', entries: { put: [{ at: 'core/model.ts' }, { at: 'ui/panel.ts' }] } }] });
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          const fingerprint = 'app order core/view.ts -> ui/';
          yield* fx.enforce({ blockId: rule, strictness: 'gate', inspection: LAYERED_KEY, owners: { [fingerprint]: owner } });
          yield* fx.wrote('src/app/main.ts', 'export const broken = ;');
          yield* fx.committed('change an unrelated consumer');
          const result = yield* set(fx, { modules: [{ id: 'app', entries: { put: [{ at: 'app/main.ts' }] } }] });
          expect(result.rules.map((one) => one.debt)).toEqual([{ before: 1, after: 1 }]);
          expect((yield* fx.documentOf(rule))?.debt).toEqual([{ fingerprint, owner }]);
          expect((yield* cardOf(fx, 'app')).entries?.map(({ at }) => at)).toEqual(['core/model.ts', 'ui/panel.ts', 'app/main.ts']);
        })(),
      ),
    );
  });
});
