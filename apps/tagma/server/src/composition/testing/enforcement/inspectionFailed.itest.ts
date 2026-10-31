import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, FileSystem } from 'effect';
import { eq } from 'drizzle-orm';
import { block } from '../../../graph/store/tables.js';
import type { GraphStore, MachineStore } from '../../../platform/contract/service/store.js';
import type { GraphUnits, MachineUnits } from '../../../platform/contract/service/units.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import type { GraphServices } from '../../../graph/contract/service/services.js';
import type { Configs } from '../../../config/contract/service/configs.js';
import { GraphCall } from '../../../graph/contract/service/serving.js';
import { MINE } from '../checkoutFixture.js';
import { landingFixture, withLanding, type LandingFixture } from '../landingFixture.js';
import { CurrentProject } from '../../../projects/contract/service/caller.js';
import { enforcementBodies } from '../../../enforcement/testing/bodies.js';
import { checkSubjectOf } from '../composed.js';
import { perform } from '../../../invocation/testing/performing.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { OperationCatalog } from '../../../invocation/contract/service/catalog.js';
import { fixtureOperationCatalog as operationCatalog } from '../nativeCatalog.js';
import { operationChecks } from '../../operationChecks.js';
import { checksOver, dyingLanes, type Graphing, quiet, type QuietServices, withLanes } from '../../../enforcement/testing/wiring.js';
import { actChecks, RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { UNBOUND_CHECKS } from '../../../enforcement/testing/doubles.js';
import { based } from '../../../enforcement/testing/based.js';
import { forProject, withGraphCall } from '../../../invocation/testing/call.js';
const bodies = enforcementBodies(checkSubjectOf);
const operator: Caller = { actor: { kind: 'operator' }, files: null };
const deadFaces = Effect.fnUntraced(function* (gate: LandingFixture) {
  const path = join(yield* gate.demo.fixture.directory('dead-worker'), 'worker.ts');
  writeFileSync(path, 'declare const self: Worker;\nself.addEventListener("message", () => { throw new Error("the worker dies"); });\n');
  return yield* Effect.acquireRelease(
    Effect.sync(() => dyingLanes(path)),
    (dead) => Effect.sync(() => dead.close()),
  );
});
const judged = (graphOf: Graphing, path: string) => actChecks(checksOver({ graphOf, kept: path }), 'submit_work');
const unopened = (path: string) => judged(() => Effect.fail({ message: 'no-checkout: the checkout this graph lives in is gone' }), path);
const demoCall = (gate: LandingFixture) =>
  Effect.orDie(gate.demo.table()).pipe(
    Effect.map((vocabulary) => ({
      project: { id: gate.demo.projectId, name: 'demo' },
      vocabulary,
      lens: { scope: undefined, names: 'law-and-reflections' as const },
      deliveredTags: new Set<string>(),
    })),
  );
const remembering = <A, E>(
  gate: LandingFixture,
  kept: string,
  effect: Effect.Effect<
    A,
    E,
    | GraphServices
    | GraphStore
    | GraphUnits
    | MachineStore
    | MachineUnits
    | CurrentProject
    | GraphCall
    | QuietServices
    | RuleChecks
    | OperationChecks
    | OperationCatalog
    | Configs
    | FileSystem.FileSystem
  >,
) =>
  Effect.flatMap(operationCatalog, (catalog) =>
    effect.pipe(
      Effect.provideContext(quiet(gate.workers, { kept })),
      Effect.provideService(RuleChecks, UNBOUND_CHECKS),
      Effect.provideService(OperationChecks, operationChecks(UNBOUND_CHECKS)),
      Effect.provideService(OperationCatalog, catalog),
      forProject(demoCall(gate)),
      withGraphCall(demoCall(gate)),
    ),
  );
layer(landingFixture(), { excludeTestServices: true })('landing enforcement', (it) => {
  it.effect('a worker that cannot answer refuses inspection-failed at gate and lands at watch, named in watched', () =>
    withLanding((gate) =>
      Effect.fnUntraced(function* () {
        const dead = yield* deadFaces(gate);
        yield* gate.wrote(MINE, 'src/core/boot.ts', "import { model } from './model';\nexport const boot = model;\n");
        const refusal = yield* gate.refused(MINE, { faces: dead });
        expect(refusal.code).toBe('inspection-failed');
        expect(refusal.reason).toContain(gate.rule);
        yield* gate.enforcedAt('watch');
        const receipt = gate.landed(yield* gate.submit(MINE, { faces: dead }));
        expect(receipt.watched).toEqual([{ rule: gate.rule, cause: 'worker', failed: expect.any(String) }]);
      })(),
    ),
  );

  it.effect(
    'enforce_rule keeps whether the project gates: a graph that does not open refuses after a gate and lands after it is switched off',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          const kept = join(yield* gate.demo.fixture.directory('enforced'), 'gated.json');
          yield* remembering(
            gate,
            kept,
            Effect.flatMap(based({ blockId: gate.rule, strictness: 'gate' }), (full) => perform(bodies.enforce_rule, full, operator)),
          );
          yield* gate.wrote(MINE, 'README.md', 'outside the rule’s reach\n');
          expect((yield* gate.refused(MINE, { checks: unopened(kept) })).code).toBe('inspection-failed');
          yield* remembering(
            gate,
            kept,
            Effect.flatMap(based({ blockId: gate.rule, strictness: 'off' }), (full) => perform(bodies.enforce_rule, full, operator)),
          );
          expect(gate.landed(yield* gate.submit(MINE, { checks: unopened(kept) })).unjudged).toEqual([
            { gate: 'unread', cause: expect.any(String) },
          ]);
        })(),
      ),
  );
  it.effect(
    'a graph that does not open, or a law-bearing declaration that stops reading, refuses the landing of a project last read gating across a restart, and lets one never read gating land unjudged naming its cause',
    () =>
      withLanding((gate) =>
        Effect.fnUntraced(function* () {
          const gated = join(yield* gate.demo.fixture.directory('vocabulary'), 'gated.json');
          const read = judged(() => Effect.succeed(withLanes(gate.demo.context, gate.workers)), gated);
          yield* gate.wrote(MINE, 'README.md', 'outside the rule’s reach\n');
          gate.landed(yield* gate.submit(MINE, { checks: read }));
          yield* gate.wrote(MINE, 'NOTES.md', 'outside the rule’s reach too\n');
          const head = yield* gate.sh(['rev-parse', 'HEAD']);
          expect((yield* gate.refused(MINE, { checks: unopened(gated) })).code).toBe('inspection-failed');
          expect(yield* gate.sh(['rev-parse', 'HEAD'])).toBe(head);
          const { db } = gate.demo.graph.graphStore;
          const declared = (yield* db.select().from(block).where(eq(block.projectId, gate.demo.projectId))).find(
            (row) => row.deletedAt === null && row.tags.includes('tag') && row.fields.id === 'rule',
          );
          if (declared === undefined) return yield* Effect.die(new Error('the fixture declares no #rule'));
          yield* db
            .update(block)
            .set({ fields: { ...declared.fields, roles: { ...(declared.fields.roles as object), retired: 'enabled' } } })
            .where(eq(block.id, declared.id));
          yield* gate.demo.graph.tags.forget(gate.demo.projectId);
          const name = yield* gate.demo.nameOf(declared.id);
          const refusal = yield* gate.refused(MINE, { checks: read });
          expect(refusal.code).toBe('inspection-failed');
          expect(refusal.reason).toContain(name);
          const never = join(yield* gate.demo.fixture.directory('never'), 'gated.json');
          const receipt = gate.landed(
            yield* gate.submit(MINE, { checks: judged(() => Effect.succeed(withLanes(gate.demo.context, gate.workers)), never) }),
          );
          expect(receipt.unjudged).toEqual([{ gate: 'unread', cause: expect.stringContaining(name) }]);
          const ungated = join(yield* gate.demo.fixture.directory('ungated'), 'gated.json');
          yield* gate.wrote(MINE, 'src/core/boot.ts', "import { main } from '../app/main';\nexport const boot = main;\n");
          const crossing = gate.landed(yield* gate.submit(MINE, { checks: unopened(ungated) }));
          expect(crossing.unjudged).toEqual([{ gate: 'unread', cause: expect.stringContaining('no-checkout') }]);
        })(),
      ),
  );
});
