import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { MINE, THEIRS } from '../composition/testing/checkoutFixture.js';
import { landingFixture, type LandingFixture, withLanding } from '../composition/testing/landingFixture.js';
import type { LawEnforcement } from '../graph/contract/wire/enforcement.js';
import { TRIGGERS } from '../graph/testing/triggers.js';
import { actChecks } from './contract/service/ruleChecks.js';
import { LAYERED_KEY } from './testing/layered.js';
import { checksOver, driverOver, type Lanes, quiet, ruleRemeasured, withLanes } from './testing/wiring.js';

const FINGERPRINT = 'app order core/shared.ts -> app/';
const CROSSING = "export const a = 1;\nimport { main } from '../app/main';\nexport const b = main;\n";

const debt = Effect.fnUntraced(function* (gate: LandingFixture, fingerprint = FINGERPRINT) {
  const graph = gate.demo;
  const row = yield* Effect.flatMap(graph.graph.blockNames.idOfName(gate.rule), (id) => graph.graph.blocks.blockById(id));
  return (row.fields.enforcement as LawEnforcement).debt.find((entry) => entry.fingerprint === fingerprint);
});

const remeasured = (gate: LandingFixture) =>
  ruleRemeasured(gate.demo.projectId, gate.rule).pipe(Effect.provideContext(quiet(gate.workers)));

const absorbing = Effect.fnUntraced(function* (gate: LandingFixture) {
  const owner = yield* gate.created(['task'], 'Move the shared values off the app floor');
  return { input: { blockId: gate.rule, strictness: 'gate' as const, absorb: [FINGERPRINT], owners: { [FINGERPRINT]: owner } }, owner };
});

layer(landingFixture(), { excludeTestServices: true })('held debt', (it) => {
  it.effect(
    'enforce_rule absorbs a crossing the session’s change brings into a file clean at HEAD as held debt, a re-measure keeps it, and the change lands carrying it',
    () =>
      withLanding((gate) =>
        Effect.gen(function* () {
          const head = yield* gate.sh(['rev-parse', 'HEAD']);
          yield* gate.wrote(MINE, 'src/core/shared.ts', CROSSING);
          const { input, owner } = yield* absorbing(gate);
          expect((yield* gate.enforceRefused(THEIRS, input)).code).toBe('inspection-failed');
          const held = { fingerprint: FINGERPRINT, owner, held: { base: head, path: 'src/core/shared.ts' } };
          expect((yield* gate.enforced(MINE, input)).absorbed).toEqual([held]);
          expect((yield* gate.enforced(MINE, input)).debt.after).toBe(2);
          yield* remeasured(gate);
          expect(yield* debt(gate)).toEqual(held);
          expect(gate.landed(yield* gate.submit(MINE)).committed).toEqual(['src/core/shared.ts']);
          yield* remeasured(gate);
          expect(yield* debt(gate)).toEqual({ fingerprint: FINGERPRINT, owner });
        }),
      ),
  );

  it.effect('opening preserves held debt, reopening retires a vanished file, and a clean landing retires its crossing', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        const path = 'src/core/pending.ts';
        const fingerprint = 'app order core/pending.ts -> app/';
        const owner = yield* gate.created(['task'], 'Move pending values off the app floor');
        yield* gate.wrote(MINE, path, CROSSING);
        yield* gate.enforced(MINE, { blockId: gate.rule, strictness: 'gate', absorb: [fingerprint], owner });
        const boot = Effect.fnUntraced(function* () {
          const driver = yield* driverOver({
            graphOf: () => Effect.succeed(withLanes(gate.demo.context, { ...gate.workers, code: 'held-debt' })),
            delayMs: 0,
          });
          yield* driver.ready(gate.demo.projectId, gate.demo.demoRoot);
        }, Effect.scoped);
        yield* boot();
        expect(yield* debt(gate, fingerprint)).toEqual({
          fingerprint,
          owner,
          held: { base: yield* gate.sh(['rev-parse', 'HEAD']), path },
        });
        yield* gate.wrote(MINE, path, null);
        yield* boot();
        expect(yield* debt(gate, fingerprint)).toBeUndefined();

        yield* gate.wrote(MINE, 'src/core/shared.ts', CROSSING);
        yield* gate.enforced(MINE, (yield* absorbing(gate)).input);
        yield* gate.put('src/core/shared.ts', 'export const a = 1;\nexport const b = 2;\n');
        yield* gate.committed('shared without the crossing');
        yield* remeasured(gate);
        expect(yield* debt(gate)).toBeUndefined();
      }),
    ),
  );

  it.effect('a landing waits on the opening re-measurement for the debt of every rule, never on tracing where a new escape came from', () =>
    withLanding((gate) =>
      Effect.gen(function* () {
        const owner = yield* gate.created(['task'], 'Keep the floors of core');
        const twin = yield* gate.created(['rule'], 'Import only downward, judged twice');
        yield* gate.enforced(MINE, { blockId: twin, strictness: 'gate', inspection: LAYERED_KEY, on: TRIGGERS.landing, owner });
        yield* gate.put('src/core/view.ts', "import { model } from './model';\nexport const view = model;\n");
        yield* gate.put('src/core/late.ts', "import { main } from '../app/main';\nexport const late = main;\n");
        yield* gate.committed('a commit no hook judged');
        const untraceable: Lanes = { ...gate.workers, history: () => Effect.never };
        const graphOf = () => Effect.succeed(withLanes(gate.demo.context, untraceable));
        const driver = yield* driverOver({ graphOf, delayMs: 0 });
        yield* gate.wrote(MINE, 'src/core/notes.ts', 'export const notes = 1;\n');
        const receipt = yield* gate.submit(MINE, { checks: actChecks(checksOver({ graphOf, driver }), 'submit_work') });
        expect(gate.landed(receipt).committed).toEqual(['src/core/notes.ts']);
        expect(yield* debt(gate, 'app order core/view.ts -> ui/')).toBeUndefined();
      }),
    ),
  );
});
