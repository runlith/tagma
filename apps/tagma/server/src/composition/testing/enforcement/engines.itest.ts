import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect } from 'effect';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { perform } from '../../../invocation/testing/performing.js';
import { refusalOf } from '../graphFixture.js';
import { checksKeeping, refusalsOver } from '../../../enforcement/testing/wiring.js';
type RefusalRecord = Parameters<typeof checksKeeping>[0];
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
const read = (fx: EnforcementFixture, input: Parameters<typeof bodies.read_enforcement.execute>[0]) =>
  fx.working(perform(bodies.read_enforcement, input, operator));
const recordHere = Effect.gen(function* () {
  return refusalsOver((yield* MachineStore).db, yield* MachineUnits);
});
const revision = Effect.fnUntraced(function* (fx: EnforcementFixture, spec: string) {
  return (yield* spawnedEffect(['git', 'rev-parse', spec], { cwd: fx.demo.demoRoot })).stdout.toString().trim();
});
const upward = Effect.fnUntraced(function* (fx: EnforcementFixture) {
  yield* fx.wrote('src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
  yield* fx.committed('an upward import');
  return { base: yield* revision(fx, 'HEAD~1'), built: yield* revision(fx, 'HEAD^{tree}') };
});
const landing = (
  fx: EnforcementFixture,
  refusals: (record: RefusalRecord) => RefusalRecord,
  tree: {
    readonly base: string;
    readonly built: string;
  },
) =>
  fx.working(
    Effect.gen(function* () {
      const checks = yield* checksKeeping(refusals(yield* recordHere));
      return yield* checks.before('submit_work', {
        kind: 'tree',
        projectId: fx.demo.projectId,
        root: fx.demo.demoRoot,
        ...tree,
        paths: ['src/core/boot.ts'],
        caller: { _tag: 'Thread', threadId: ThreadId.make('thread-1'), projectId: fx.demo.projectId },
      });
    }),
  );
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('read_enforcement', () => {
    it.effect(
      'answers the project’s rules and one rule’s engine: strictness, checker, debt by owner, and the count the debt fell from',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              on: TRIGGERS.landing,
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            const all = yield* read(fx, {});
            expect(all.counts).toMatchObject({ enforced: 1, gate: 1, watch: 0, note: 0, debt: 1 });
            expect(all.rules?.rows[0]).toMatchObject({
              rule,
              strictness: 'gate',
              checker: { kind: 'builtin', builtin: 'modules', concern: 'imports' },
              debt: { count: 1, owners: 1, was: null },
              refused: null,
            });
            const engine = yield* read(fx, { rule });
            expect(engine.engine?.figures).toEqual([{ kind: 'modules', modules: 1, relations: 0, focus: null }]);
            expect(engine.engine?.owners).toEqual([
              { name: owner, title: 'Move the view off the panel', status: 'open', standing: 'open', entries: 1 },
            ]);
            expect(engine.debt?.rows).toEqual([
              { fingerprint: 'app order core/view.ts -> ui/', file: 'src/core/view.ts', owner, value: null, count: null },
            ]);
            yield* fx.wrote('src/core/view.ts', "import { model } from './model';\nexport const view = model;\n");
            yield* fx.committed('the view reads the model');
            yield* fx.enforce({ blockId: rule, strictness: 'gate' });
            const after = yield* read(fx, {});
            expect(after.rules?.rows[0]?.debt).toMatchObject({ count: 0, owners: 0, was: { count: 1 } });
            expect((yield* read(fx, { rule })).engine?.history[0]?.count).toBe(0);
          })(),
        ),
    );
    it.effect(
      'a refused landing records each crossing with its caller, newest first, and a rule without enforcement refuses not-enforced',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              on: TRIGGERS.landing,
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            const judged = yield* landing(fx, (record) => record, yield* upward(fx));
            expect(judged.refused?.code).toBe('rule-violated');
            const engine = yield* read(fx, { rule });
            expect(engine.refusals?.total).toBe(1);
            expect(engine.refusals?.rows[0]).toMatchObject({
              rule,
              op: 'submit_work',
              file: 'src/core/boot.ts',
              line: 1,
              fingerprint: 'app order core/boot.ts -> app/',
              branch: (yield* spawnedEffect(['git', 'branch', '--show-current'], { cwd: fx.demo.demoRoot })).stdout.toString().trim(),
              actor: { kind: 'thread', threadId: 'thread-1' },
            });
            expect(judged.refused?.reason).not.toContain('recorded without its branch');
            expect((yield* read(fx, {})).rules?.rows[0]?.refused).toMatchObject({ file: 'src/core/boot.ts', line: 1, op: 'submit_work' });
            const plain = yield* fx.created(['rule'], 'Nothing checks this');
            expect((yield* fx.working(refusalOf(perform(bodies.read_enforcement, { rule: plain }, operator)))).code).toBe('not-enforced');
          })(),
        ),
    );
    it.effect('a refusal the record cannot keep still refuses and says it was not recorded', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          yield* fx.enforce({
            blockId: rule,
            strictness: 'gate',
            on: TRIGGERS.landing,
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          });
          const down = (record: RefusalRecord): RefusalRecord => ({
            ...record,
            keep: () => Effect.fail(new SqlError({ reason: new ConnectionError({ cause: new Error('the record store is down') }) })),
          });
          const judged = yield* landing(fx, down, yield* upward(fx));
          expect(judged.refused?.code).toBe('rule-violated');
          expect(judged.refused?.reason).toContain('this refusal could not be recorded');
        })(),
      ),
    );
    it.effect(
      'refusals page by place, newest first: each fingerprint’s newest refusal with how often it was refused, its own fix only',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the view off the panel');
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              on: TRIGGERS.landing,
              inspection: LAYERED_KEY,
              owners: { 'app order core/view.ts -> ui/': owner },
            });
            const at = Date.parse('2026-10-01T00:00:00Z');
            const refused = (fingerprint: string, fix: string | null) => ({
              rule,
              op: 'submit_work',
              file: `src/core/${fingerprint}.ts`,
              line: 1,
              fingerprint,
              said: null,
              reached: '../app/main',
              fix,
              base: null,
              branch: null,
              actor: null,
            });
            yield* fx.working(
              Effect.gen(function* () {
                const record = yield* recordHere;
                yield* record.keep(fx.demo.projectId, [refused('boot', null)], new Date(at));
                yield* record.keep(fx.demo.projectId, [refused('main', 'load it from core')], new Date(at + 1000));
                yield* record.keep(fx.demo.projectId, [refused('boot', null)], new Date(at + 2000));
              }),
            );
            const first = yield* read(fx, { rule, limit: 1 });
            expect(first.engine?.generalFix).toEqual(expect.any(String));
            expect(first.refusals).toMatchObject({
              total: 2,
              times: 3,
              rows: [{ fingerprint: 'boot', times: 2, first: '2026-10-01T00:00:00.000Z', fix: null, reached: '../app/main' }],
            });
            const second = yield* read(fx, { rule, cursor: first.refusals?.next ?? '', limit: 1 });
            expect(second.refusals?.rows.map((row) => [row.fingerprint, row.times, row.fix])).toEqual([['main', 1, 'load it from core']]);
            expect(second.refusals?.next).toBeNull();
          })(),
        ),
    );
    it.effect('the record keeps the newest 2000 refusals of a project and none older than 90 days', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const at = new Date('2026-06-01T00:00:00Z');
          const one = {
            rule: 'aaaaaaaa',
            op: 'submit_work',
            file: 'src/a.ts',
            line: 1,
            fingerprint: 'a',
            said: 'loads x',
            reached: 'x',
            fix: 'load y instead',
            base: null,
            branch: null,
            actor: null,
          };
          const kept = yield* fx.working(
            Effect.gen(function* () {
              const record = yield* recordHere;
              yield* record.keep(fx.demo.projectId, [one], at);
              yield* record.keep(fx.demo.projectId, [{ ...one, file: 'src/b.ts' }], new Date(at.getTime() + 91 * 86400000));
              const aged = yield* record.places(fx.demo.projectId, null, null, 10);
              yield* record.keep(
                fx.demo.projectId,
                Array.from({ length: 2001 }, (_, n) => ({ ...one, file: `src/${n}.ts` })),
                new Date(at.getTime() + 92 * 86400000),
              );
              return {
                aged,
                counted: yield* record.counted(fx.demo.projectId, null),
                newest: yield* record.places(fx.demo.projectId, null, null, 1),
              };
            }),
          );
          expect(kept.aged.map((row) => [row.file, row.times])).toEqual([['src/b.ts', 1]]);
          expect(kept.counted).toEqual({ times: 2000, places: 1 });
          expect(kept.newest[0]).toMatchObject({ file: 'src/2000.ts', said: 'loads x', fix: 'load y instead', times: 2000 });
        })(),
      ),
    );
    it.effect('a modules rule answers each module as a unit and the neighbourhood of the module asked for', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Modules import along relations');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          const parent = yield* fx.demo.nameOf((yield* fx.demo.graph.blocks.rootBlockOf(fx.demo.projectId)).id);
          yield* fx.working(
            perform(
              bodies.set_module,
              {
                modules: [
                  { id: 'core', title: 'Core', parent, root: 'src/core', entries: { put: [{ at: '.' }] } },
                  { id: 'ui', title: 'Panels', parent, root: 'src/ui', entries: { put: [{ at: 'panel.ts' }] }, imports: { put: ['core'] } },
                  { id: 'app', root: 'src/app', entries: { replace: [] }, order: null, imports: { put: ['ui'] } },
                ],
              },
              operator,
            ),
          );
          yield* fx.enforce({ blockId: rule, strictness: 'note', inspection: LAYERED_KEY, owners: { 'core -> ui @ core/view.ts': owner } });
          const engine = yield* read(fx, { rule, focus: 'ui' });
          expect(engine.units?.rows).toEqual([
            { id: 'app', territory: 1, entries: 0, imports: 1, importedBy: 0 },
            { id: 'core', territory: 1, entries: 1, imports: 0, importedBy: 1 },
            { id: 'ui', territory: 1, entries: 1, imports: 1, importedBy: 1 },
          ]);
          expect(engine.engine?.figures[0]).toEqual({
            kind: 'modules',
            modules: 3,
            relations: 2,
            focus: {
              module: 'ui',
              territory: ['src/ui/'],
              entries: [{ at: 'src/ui/panel.ts' }],
              imports: [{ to: 'core' }],
              importedBy: [{ from: 'app' }],
            },
          });
        })(),
      ),
    );
    it.effect('a debt page continues by its cursor and refuses stale once the rule’s enforcement moved', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the view off the panel');
          yield* upward(fx);
          yield* fx.enforce({
            blockId: rule,
            strictness: 'note',
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner, 'app order core/boot.ts -> app/': owner },
          });
          const first = yield* fx.working(perform(bodies.read_enforcement, { rule, limit: 1 }, operator));
          expect(first.debt?.total).toBe(2);
          const next = first.debt?.next ?? '';
          const second = yield* fx.working(perform(bodies.read_enforcement, { rule, cursor: next, limit: 1 }, operator));
          expect(second.debt?.rows.map((row) => row.fingerprint)).toEqual(['app order core/view.ts -> ui/']);
          yield* fx.wrote('src/core/boot.ts', 'export const boot = 1;\n');
          yield* fx.committed('the boot no longer imports the app');
          yield* fx.enforce({ blockId: rule, strictness: 'note' });
          expect((yield* fx.working(refusalOf(perform(bodies.read_enforcement, { rule, cursor: next }, operator)))).code).toBe(
            'cursor-stale',
          );
        })(),
      ),
    );
  });
});
