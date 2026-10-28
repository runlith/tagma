import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem } from 'effect';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { based, type Unbased } from '../../../enforcement/testing/based.js';
import { refusalOf } from '../graphFixture.js';
import { Enforcements, enforceFixture, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import { MINE, PLACE } from '../checkoutFixture.js';
import { landingServices } from '../landingServices.js';
import { submitOver } from '../../../landing/testing/doubles.js';
import { landingAdmission } from '../../preparedChanges.js';
import {
  makePreparedChanges,
  quietCommands,
  evidenceInGroups,
  pathsOfThread,
  recordWrite,
  claimPreparedInstance,
  preparedBase,
  judgingFns,
  prepareChange,
  releasePrepared,
} from '../../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { perform } from '../../../invocation/testing/performing.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import type { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import { type ActChecks, actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { TEST_CHECKOUT, testPlace } from '../../../workspace/testing/doubles.js';
import { changeChecked, checksOver, targetsOf, withLanes } from '../../../enforcement/testing/wiring.js';
import { ProgramRoad } from '../../../executions/contract/service/programs.js';
import { localRoad } from '../../../executions/testing/road.js';
import type { Remeasure } from '../../../enforcement/contract/service/remeasure.js';
import { bodies, operator } from './enforceFixture.js';

const CHECK = `
export default {
  forbidden: async ({ tree }) => {
    const found = [];
    for (const path of tree.paths.filter((one) => one.startsWith('src/'))) {
      ((await tree.read(path)) ?? '').split('\\n').forEach((line, at) => {
        if (line.includes('FORBIDDEN'))
          found.push({ fingerprint: path + ' × ' + line.slice(line.indexOf('FORBIDDEN')).trim(), path, line: at + 1, message: 'forbidden', value: line.length });
      });
    }
    return { tree: { covered: 'reach', findings: found } };
  },
};
`;
const LAYER = 'forbidden';
const fp = (text: string) => `${LAYER} ${text}`;
const SEED = fp('src/a.ts × FORBIDDEN one');
const AFTER = TRIGGERS.merge;

const makeCase = Effect.fnUntraced(function* (fixture: EnforcementFixture) {
  const { demo } = fixture;
  const { workers } = yield* Enforcements;
  const files = yield* FileSystem.FileSystem;
  const put = Effect.fnUntraced(function* (path: string, text: string) {
    const at = join(demo.demoRoot, path);
    yield* files.makeDirectory(dirname(at), { recursive: true });
    yield* files.writeFileString(at, text);
  });
  yield* put('tools/check.js', CHECK);
  yield* put('src/a.ts', 'export const a = 1; // FORBIDDEN one\n');
  yield* fixture.committed('program seed');
  demo.described.set(LAYER, { program: 'tools/check.js', name: 'forbidden', concern: 'code', needs: [], params: {} });
  const rule = yield* fixture.created(['rule'], 'Nothing forbidden stands');
  const owner = yield* fixture.created(['task'], 'Take the forbidden line out of a.ts');
  const road = localRoad([]);
  const context = withLanes(demo.context, workers).pipe(Context.add(ProgramRoad, road));
  const mine = () => ({ _tag: 'Thread' as const, threadId: ThreadId.make(MINE), projectId: demo.projectId });
  const originFor = (threadId: string) => ({ ...PLACE, generation: 0, work: { projectId: demo.projectId, threadId } }) as WorkingOrigin;
  const enforce = (input: Unbased) =>
    fixture.working(
      Effect.flatMap(based(input), (full) => perform(bodies.enforce_rule, full, operator)).pipe(Effect.provideService(ProgramRoad, road)),
    );
  const documentOf = () => fixture.documentOf(rule);
  const wrote = Effect.fnUntraced(function* (path: string, text: string) {
    const at = join(demo.demoRoot, path);
    const before = (yield* files.exists(at)) ? yield* files.readFileString(at) : '';
    yield* put(path, text);
    yield* recordWrite(demo.graph.units, demo.graph.store, demo.projectId, MINE, testPlace(path), { before, after: text, mode: '100644' });
  });
  const checksWith = (driver?: Remeasure['Service']): ActChecks =>
    actChecks(checksOver({ graphOf: () => Effect.succeed(context), driver }), 'submit_work');
  const landed = Effect.fnUntraced(function* (checks: ActChecks) {
    const services = yield* landingServices;
    return yield* Effect.acquireUseRelease(
      claimPreparedInstance(preparedBase(demo.graph.store)),
      (inst) =>
        Effect.gen(function* () {
          const producer = makePreparedChanges(
            { commands: quietCommands, pathsOfThread, evidenceInGroups },
            landingAdmission(makeLandingHolds()),
            judgingFns(CHECKOUT_DIRECTORY),
            inst.dir,
          );
          const receipt = yield* submitOver(
            demo.graph.git,
            demo.demoRoot,
            demo.graph.store,
            demo.graph.units,
            originFor(MINE),
            { projectId: demo.projectId, tasks: [], taking: [], coAuthored: true },
            checks,
            producer,
          ).pipe(Effect.provide(services));
          if (receipt.status !== 'landed') return yield* Effect.die(new Error(`expected a landing, got ${JSON.stringify(receipt)}`));
          return receipt;
        }),
      (inst) => inst.release,
    );
  });
  const checked = Effect.fnUntraced(
    function* (rules: readonly string[] | 'all') {
      const ask = { projectId: demo.projectId, caller: mine(), rules };
      return yield* Effect.acquireUseRelease(
        claimPreparedInstance(preparedBase(demo.graph.store)),
        (inst) =>
          Effect.gen(function* () {
            const { prepared } = yield* prepareChange(
              { commands: quietCommands, pathsOfThread, evidenceInGroups },
              judgingFns(CHECKOUT_DIRECTORY),
              inst.dir,
              {
                projectId: demo.projectId,
                git: demo.graph.git,
                root: demo.demoRoot,
                store: demo.graph.store,
                units: demo.graph.units,
                origin: originFor(MINE),
                checkout: TEST_CHECKOUT,
                input: { taking: [] },
                job: `check:${randomUUID()}`,
                caller: mine(),
                act: { kind: 'thread', ...originFor(MINE).work },
              },
            );
            if (prepared === null) return null;
            const { subject } = prepared;
            const version = { projectId: demo.projectId, actor: mine(), root: subject.root, tree: subject.built };
            return yield* targetsOf(ask, version).pipe(
              Effect.flatMap((targets) => changeChecked(ask, targets, subject)),
              Effect.ensuring(releasePrepared(prepared)),
            );
          }),
        (inst) => inst.release,
      );
    },
    (effect) => Effect.provide(effect, context),
  );
  return { rule, owner, enforce, documentOf, wrote, checksWith, landed, checked };
});
type Case = Effect.Success<ReturnType<typeof makeCase>>;
const withCase = <A, E, R>(body: (scene: Case) => Effect.Effect<A, E, R>) =>
  withEnforcement((fixture) => Effect.flatMap(makeCase(fixture), body));

layer(enforceFixture(), { excludeTestServices: true })('checker bindings', (it) => {
  it.effect('check_rules explicitly judges a merge-only rule against the landing tree and its debt without recording changes', () =>
    withCase((scene) =>
      Effect.gen(function* () {
        const { rule, owner } = scene;
        yield* scene.enforce({ blockId: rule, strictness: 'gate', on: AFTER, inspection: LAYER, owners: { [SEED]: owner } });
        const standing = yield* scene.documentOf();
        expect(standing?.on).toEqual(AFTER);
        expect(standing?.debt).toEqual([{ fingerprint: SEED, owner, value: 'export const a = 1; // FORBIDDEN one'.length }]);
        yield* scene.wrote('src/b.ts', 'export const b = 2; // FORBIDDEN two\n');
        const asked = yield* scene.checked([rule]);
        expect(asked?.violations.map((one) => one.fingerprint)).toEqual([fp('src/b.ts × FORBIDDEN two')]);
        expect(asked?.rules).toEqual([{ rule, strictness: 'gate', on: AFTER, reached: true, ms: expect.any(Number) }]);
        expect(asked?.refuses).toBe(false);
        expect(yield* scene.documentOf()).toEqual(standing);
        expect((yield* refusalOf(scene.checked(['deadbeef']))).code).toBe('not-enforced');
      }),
    ),
  );

  it.effect('a note rule is judged explicitly without changing its declaration or blocking the landing', () =>
    withCase((scene) =>
      Effect.gen(function* () {
        yield* scene.enforce({ blockId: scene.rule, strictness: 'note', inspection: LAYER, owners: { [SEED]: scene.owner } });
        const standing = yield* scene.documentOf();
        expect(standing?.on).toEqual([]);
        yield* scene.wrote('src/b.ts', 'export const b = 2; // FORBIDDEN two\n');
        const asked = yield* scene.checked('all');
        expect(asked?.violations.map((one) => one.fingerprint)).toEqual([fp('src/b.ts × FORBIDDEN two')]);
        expect(yield* scene.documentOf()).toEqual(standing);
        expect((yield* scene.landed(scene.checksWith())).watched).toBeUndefined();
      }),
    ),
  );
});
