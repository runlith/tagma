import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect } from 'effect';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { perform, prepare } from '../../../invocation/testing/performing.js';
import { refusalOf } from '../graphFixture.js';
import { eq } from 'drizzle-orm';
import { block } from '../../../graph/store/tables.js';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { LAYERED, LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { checksIn } from '../../../enforcement/testing/wiring.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import type { ENFORCEMENT_OPERATIONS } from '../../../enforcement/contract/wire/operationCatalog.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { atPlace, inWorkspace } from '../../../invocation/testing/call.js';
type Modules = InputOf<typeof ENFORCEMENT_OPERATIONS.set_module>;
const moduleCard = Effect.fnUntraced(function* (fx: EnforcementFixture) {
  const [card] = yield* fx.demo.graph.blocks.moduleCards(fx.demo.projectId);
  return yield* fx.demo.graph.blocks.blockById(card!.block);
});
const cards = (fx: EnforcementFixture) => fx.demo.graph.blocks.moduleCards(fx.demo.projectId);
const cardOf = Effect.fnUntraced(function* (fx: EnforcementFixture, id: string) {
  const card = (yield* cards(fx)).find((one) => one.id === id);
  if (card === undefined) return yield* Effect.die(new Error(`no module card carries the id ${id}`));
  return card;
});
const rootName = (fx: EnforcementFixture) =>
  Effect.flatMap(fx.demo.graph.blocks.rootBlockOf(fx.demo.projectId), (row) => fx.demo.graph.blockNames.nameOf(row.id));
const set = (fx: EnforcementFixture, input: Modules) => fx.working(perform(bodies.set_module, input, operator));
const refused = (fx: EnforcementFixture, input: Modules) => fx.working(refusalOf(perform(bodies.set_module, input, operator)));
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('set_module', () => {
    it.effect('a thread closing web → ui into a cycle receives a map refusal, as do enforcement and landing over a standing cycle', () =>
      withEnforcement((fx) =>
        Effect.gen(function* () {
          const homeRoot = yield* fx.demo.fixture.directory('thread-home');
          const home = yield* fx.demo.graph.projectLifecycle.create({ name: 'thread-home', rootPath: homeRoot });
          const threadId = 'map-author';
          const caller: Caller = {
            actor: {
              kind: 'thread',
              threadId,
              projectId: home.id,
              principalId: 'tagma',
              session: { harness: 'tagma', key: threadId },
            },
            files: null,
          };
          const call = (input: Modules) =>
            fx.working(
              perform(bodies.set_module, { ...input, project: fx.demo.projectId }, caller).pipe(
                atPlace({ projectId: fx.demo.projectId, checkout: fx.demo.demoRoot, branch: null }),
                inWorkspace({ root: homeRoot, origin: null }),
              ),
            );
          yield* call({
            modules: [
              { id: 'ui', title: 'UI', root: 'src/ui', entries: { put: [{ at: 'panel.ts' }] } },
              { id: 'web', title: 'Web', root: 'src/app', imports: { put: ['ui'] } },
            ],
          });
          const rule = yield* fx.created(['rule'], 'Module relations stand without cycles');
          const owner = yield* fx.created(['task'], 'Correct the standing imports');
          yield* fx.enforce({
            blockId: rule,
            strictness: 'gate',
            inspection: LAYERED_KEY,
            on: [{ op: 'submit_work', phase: 'before' }],
            owner,
          });
          const cycle: Modules = { modules: [{ id: 'ui', imports: { put: ['web'] } }] };
          const refusal = yield* refusalOf(call(cycle));
          expect(refusal.code).toBe('module-map-invalid');
          expect(refusal.unblock.length).toBeGreaterThan(0);
          expect(refusal.unblock.every((way) => way.startsWith('set_module') && !/\benforce\b/u.test(way))).toBe(true);
          expect((yield* cardOf(fx, 'ui')).imports).toEqual([]);
          fx.demo.described.set(LAYERED_KEY, { ...LAYERED, params: { ...LAYERED.params, cycles: 'allow' } });
          yield* call(cycle);
          fx.demo.described.set(LAYERED_KEY, LAYERED);
          const enforce = yield* fx.refused({ blockId: rule, strictness: 'gate' });
          const head = yield* fx.head();
          const landing = yield* fx.working(
            Effect.flatMap(checksIn, (checks) =>
              checks.before('submit_work', {
                kind: 'tree',
                projectId: fx.demo.projectId,
                root: fx.demo.demoRoot,
                built: head,
                base: head,
                paths: ['src/app/main.ts'],
                caller: { _tag: 'Thread', threadId: ThreadId.make(threadId), projectId: home.id },
              }),
            ),
          );
          expect([enforce.code, landing.refused?.code]).toEqual(['module-map-invalid', 'module-map-invalid']);
          expect(enforce.unblock).toEqual(refusal.unblock);
          expect(landing.refused?.unblock).toEqual(refusal.unblock);
        }),
      ),
    );
    it.effect('a root the working tree does not hold and a relation on a module that holds modules refuse module-shape', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const card = yield* moduleCard(fx);
          const name = yield* fx.demo.nameOf(card.id);
          const gone: Modules = { modules: [{ id: 'app', root: 'gone' }] };
          const nowhere = yield* fx.working(refusalOf(perform(bodies.set_module, gone, operator)));
          const parent: Modules = { modules: [{ id: 'core', title: 'Core', parent: name, root: 'src/core', imports: { put: ['app'] } }] };
          const holding = yield* fx.working(refusalOf(perform(bodies.set_module, parent, operator)));
          const self: Modules = { modules: [{ id: 'app', parent: name }] };
          const cyclic = yield* fx.working(refusalOf(perform(bodies.set_module, self, operator)));
          expect([nowhere.code, holding.code, cyclic.code]).toEqual(['module-shape', 'module-shape', 'module-shape']);
        })(),
      ),
    );
    it.effect(
      'modules are born and linked in one call in any order, the values a card shows go back unchanged, and a rename keeps what refers to it',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const parent = yield* rootName(fx);
            yield* set(fx, {
              modules: [
                {
                  id: 'ui',
                  title: 'Panels',
                  parent,
                  root: 'src/ui',
                  imports: { put: ['core'] },
                  entries: { put: [{ at: 'panel.ts', for: ['app', 'core'] }] },
                },
                { id: 'core', title: 'Core', parent, root: 'src/core', entries: { put: [{ at: 'model.ts' }] } },
              ],
            });
            const [app, core, ui] = [yield* cardOf(fx, 'app'), yield* cardOf(fx, 'core'), yield* cardOf(fx, 'ui')];
            expect(ui.imports).toEqual([core.block]);
            expect(ui.entries).toEqual([{ at: 'panel.ts', for: [app.name, core.name] }]);
            yield* set(fx, { modules: [{ id: 'ui', entries: { put: [...(ui.entries ?? []), { at: '.', role: 'port' }] } }] });
            expect((yield* cardOf(fx, 'ui')).entries).toEqual([
              { at: 'panel.ts', for: [app.name, core.name] },
              { at: '.', role: 'port' },
            ]);
            yield* set(fx, { modules: [{ id: 'kernel', block: core.name }] });
            expect((yield* cardOf(fx, 'kernel')).block).toBe(core.block);
            expect((yield* cardOf(fx, 'ui')).imports).toEqual([core.block]);
            const drawn = (yield* fx.working(perform(bodies.read_inspections, { map: true }, operator))).map;
            expect(drawn?.problems).toEqual([]);
            expect(drawn?.modules.find((one) => one.id === 'ui')?.entries?.[0]?.for).toEqual(['app', 'kernel']);
            const renamed = yield* refused(fx, {
              modules: [
                { id: 'edge', block: (yield* cardOf(fx, 'kernel')).name },
                { id: 'ui', imports: { put: ['kernel'] } },
              ],
            });
            expect(renamed.unblock.join('\n')).toContain('edge');
          })(),
        ),
    );
    it.effect('a string that is the id of one module and the name of another picks neither, and { block } and { id } choose', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const parent = yield* rootName(fx);
          yield* set(fx, {
            modules: [
              { id: 'core', title: 'Core', parent, root: 'src/core' },
              { id: 'ui', title: 'Panels', parent, root: 'src/ui' },
            ],
          });
          const core = yield* cardOf(fx, 'core');
          yield* set(fx, { modules: [{ id: core.name, title: 'Namesake', parent, root: 'src/app' }] });
          const namesake = yield* cardOf(fx, core.name);
          const collision = yield* refused(fx, { modules: [{ id: 'ui', imports: { put: [core.name] } }] });
          expect(collision.code).toBe('module-shape');
          expect(collision.unblock.join('\n')).toContain(core.name);
          expect(collision.unblock.join('\n')).toContain(namesake.name);
          expect((yield* cardOf(fx, 'ui')).imports).toEqual([]);
          yield* set(fx, { modules: [{ id: 'ui', imports: { put: [{ block: core.name }] } }] });
          expect((yield* cardOf(fx, 'ui')).imports).toEqual([core.block]);
          yield* set(fx, { modules: [{ id: 'ui', imports: { replace: [{ id: core.name }] } }] });
          expect((yield* cardOf(fx, 'ui')).imports).toEqual([namesake.block]);
        })(),
      ),
    );
    it.effect(
      'entries added beside a path the tree no longer holds pass, a sent path that is missing refuses, a drop never needs the path, and a root move reads what stays',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            yield* set(fx, { modules: [{ id: 'app', entries: { put: [{ at: 'ui/panel.ts' }, { at: 'core/model.ts' }] } }] });
            rmSync(join(fx.demo.demoRoot, 'src/ui/panel.ts'));
            yield* set(fx, { modules: [{ id: 'app', entries: { put: [{ at: 'app/main.ts' }] } }] });
            expect((yield* cardOf(fx, 'app')).entries?.map((entry) => entry.at)).toEqual(['ui/panel.ts', 'core/model.ts', 'app/main.ts']);
            for (const [entries, path] of [
              [{ put: [{ at: 'ui/panel.ts', role: 'port' as const }] }, 'ui/panel.ts'],
              [{ replace: [{ at: 'ui/panel.ts' }] }, 'ui/panel.ts'],
              [{ drop: ['absent.ts'] }, 'absent.ts'],
            ] as const) {
              const one = yield* refused(fx, { modules: [{ id: 'app', entries }] });
              expect(one.code).toBe('module-shape');
              expect(one.reason).toContain(path);
            }
            const moved = yield* refused(fx, { modules: [{ id: 'app', root: 'src/core' }] });
            expect(moved.code).toBe('module-shape');
            expect(moved.reason).toContain('ui/panel.ts');
            expect((yield* cardOf(fx, 'app')).roots).toEqual(['src']);
            yield* set(fx, { modules: [{ id: 'app', entries: { drop: ['ui/panel.ts'] } }] });
            expect((yield* cardOf(fx, 'app')).entries?.map((entry) => entry.at)).toEqual(['core/model.ts', 'app/main.ts']);
            yield* set(fx, { modules: [{ id: 'app', entries: { replace: [] } }] });
            expect((yield* cardOf(fx, 'app')).entries).toBeUndefined();
          })(),
        ),
    );
    it.effect('every independent fault of a request is named in one refusal, and neither the card nor the debt changes', () =>
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
          const debt = (yield* fx.documentOf(rule))?.debt;
          const card = yield* moduleCard(fx);
          const refusal = yield* refused(fx, {
            modules: [
              {
                id: 'app',
                order: [['ui/'], ['core/'], ['app/'], ['nope/']],
                imports: { put: ['ghost', { block: 'deadbeef' }] },
                entries: { put: [{ at: 'gone.ts' }, { at: 'gone.ts' }], drop: ['absent.ts'] },
                cuts: { put: ['missing.txt'] },
              },
            ],
          });
          expect(refusal.code).toBe('module-shape');
          for (const field of [
            'imports.put[0]',
            'imports.put[1]',
            'entries.put[0]',
            'entries.put[1]',
            'entries.drop[0]',
            'cuts',
            'order[3]',
          ]) {
            expect(refusal.reason).toContain(field);
          }
          expect((yield* fx.documentOf(rule))?.debt).toEqual(debt);
          expect((yield* moduleCard(fx)).fields).toEqual(card.fields);
        })(),
      ),
    );
    it.effect('a module that stays in another module’s for is not removed silently, and the same call can correct that for', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const parent = yield* rootName(fx);
          yield* set(fx, { modules: [{ id: 'core', title: 'Core', parent, root: 'src/core' }] });
          yield* set(fx, { modules: [{ id: 'app', entries: { put: [{ at: 'ui/panel.ts', for: ['core'] }] } }] });
          const refusal = yield* refused(fx, { modules: [{ id: 'core', remove: true }] });
          expect(refusal.code).toBe('module-shape');
          expect(refusal.unblock.join('\n')).toContain('ui/panel.ts');
          expect((yield* cards(fx)).map((one) => one.id)).toContain('core');
          yield* set(fx, {
            modules: [
              { id: 'core', remove: true },
              { id: 'app', entries: { drop: ['ui/panel.ts'] } },
            ],
          });
          expect((yield* cards(fx)).map((one) => one.id)).not.toContain('core');
          expect((yield* cardOf(fx, 'app')).entries).toBeUndefined();
        })(),
      ),
    );
    it.effect('every fault is in the refusal however many there are, and a repeated entry beside an unknown for is still named', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const many = Array.from({ length: 25 }, (_, index) => `missing${index}.txt`);
          const refusal = yield* refused(fx, {
            modules: [
              {
                id: 'app',
                cuts: { put: many },
                entries: { put: [{ at: 'a.ts', for: ['ghost'] }, { at: 'a.ts' }] },
              },
            ],
          });
          expect(refusal.code).toBe('module-shape');
          for (const path of many) expect(refusal.reason).toContain(path);
          expect(refusal.reason).toContain('entries.put[0].for[0]');
          expect(refusal.reason).toContain('entries.put[1]');
          expect((yield* cardOf(fx, 'app')).entries).toBeUndefined();
        })(),
      ),
    );
    it.effect('entries that do not read are kept by a delta and by any other edit, and a replace corrects them', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const card = yield* moduleCard(fx);
          const spoil = (entries: unknown) =>
            Effect.flatMap(GraphStore, ({ db }) =>
              db
                .update(block)
                .set({ fields: { ...card.fields, entries } })
                .where(eq(block.id, card.id)),
            );
          yield* spoil('not entries');
          const kept = Effect.fnUntraced(function* () {
            return (yield* fx.demo.graph.blocks.blockById(card.id)).fields.entries;
          });
          const delta = yield* refused(fx, { modules: [{ id: 'app', entries: { put: [{ at: 'core/model.ts' }] } }] });
          expect(delta.code).toBe('module-shape');
          expect(delta.reason).toContain('entries');
          const other = yield* refused(fx, { modules: [{ id: 'app', title: 'Renamed' }] });
          expect(other.code).toBe('module-shape');
          expect(yield* kept()).toBe('not entries');
          yield* set(fx, { modules: [{ id: 'app', entries: { replace: [{ at: 'core/model.ts' }] } }] });
          expect((yield* cardOf(fx, 'app')).entries?.map((one) => one.at)).toEqual(['core/model.ts']);
          expect((yield* cardOf(fx, 'app')).unreadable).toBeUndefined();
        })(),
      ),
    );
    it.effect('removing a module rechecks restored children when the write lands', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const card = yield* moduleCard(fx);
          const child = yield* fx.demo.graph.blocks.create({
            projectId: fx.demo.projectId,
            parentId: card.id,
            title: 'A child',
          });
          yield* fx.demo.graph.trash.delete({ id: child.id });
          yield* fx.working(prepare(bodies.set_module, { modules: [{ id: 'app', remove: true }] }, operator));
          yield* fx.demo.graph.trash.restore({ id: child.id });
          const remove = () => fx.demo.graph.blocks.writeModules(fx.demo.projectId, [{ id: 'app', block: card.id, remove: true }], []);
          const refused = yield* fx.demo.refusal(remove());
          expect(refused.code).toBe('module-shape');
          expect((yield* fx.demo.graph.blocks.blockById(child.id)).parentId).toBe(card.id);
          expect(yield* fx.demo.graph.blocks.liveBlock(card.id)).toBeDefined();
          yield* fx.demo.graph.trash.delete({ id: child.id });
          yield* remove();
          expect(yield* fx.demo.graph.blocks.liveBlock(card.id)).toBeUndefined();
        })(),
      ),
    );
    it.effect('the generic doors refuse a module’s boundary parts and name set_module, while its text stays free', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const card = yield* moduleCard(fx);
          const refused = yield* Effect.all([
            fx.demo.refusal(fx.demo.graph.blocks.update({ id: card.id, fields: { ...card.fields, order: [['app/']] } })),
            fx.demo.refusal(fx.demo.graph.sources.unanchor({ blockId: card.id, kind: 'dir', ref: 'src' })),
          ]);
          expect(refused.map((one) => [one.code, one.unblock.some((way) => way.includes('set_module'))])).toEqual([
            ['operation-only', true],
            ['operation-only', true],
          ]);
          yield* fx.demo.graph.blocks.update({ id: card.id, body: 'The application, drawn in three floors.' });
          expect((yield* moduleCard(fx)).body).toBe('The application, drawn in three floors.');
        })(),
      ),
    );
  });
});
