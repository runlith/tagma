import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Git } from '@runlith/git/Git';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { config } from '../../../config/config.js';
import { Configs } from '../../../config/contract/service/configs.js';
import { ProgramRoad } from '../../../executions/contract/service/programs.js';
import { localRoad } from '../../../executions/testing/road.js';
import { based, type Unbased } from '../../../enforcement/testing/based.js';
import { changeChecked, checksOver, targetsOf, withLanes } from '../../../enforcement/testing/wiring.js';
import { actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import {
  claimPreparedInstance,
  evidenceInGroups,
  judgingFns,
  makePreparedChanges,
  pathsOfThread,
  preparedBase,
  prepareChange,
  quietCommands,
  recordWrite,
  releasePrepared,
} from '../../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { perform } from '../../../invocation/testing/performing.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import type { ENFORCEMENT_OPERATIONS } from '../../../enforcement/contract/wire/operationCatalog.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import type { WorkingOrigin } from '../../../workspace/contract/wire/place.js';
import { TEST_CHECKOUT, testPlace } from '../../../workspace/testing/doubles.js';
import { submitOver } from '../../../landing/testing/doubles.js';
import { landingAdmission } from '../../preparedChanges.js';
import { landingServices } from '../landingServices.js';
import { MINE, PLACE } from '../checkoutFixture.js';
import { gitEffect, refusalOf } from '../graphFixture.js';
import { bodies, Enforcements, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
import { OperationId } from '../../../platform/contract/wire/ids.js';

const CROSSING = 'packages/domain/src/summary.ts -> @law-lab/ui';

const configOf = (refuses: readonly string[], key = 'domain-no-ui') =>
  `export default ${JSON.stringify({ inspections: { [key]: { builtin: 'loads', params: { from: ['packages/domain'], refuses } } } })};\n`;

const TOOL_TEXT = 3_000;

const makeCase = Effect.fnUntraced(function* (fixture: EnforcementFixture) {
  const { demo } = fixture;
  const { workers } = yield* Enforcements;
  const files = yield* FileSystem.FileSystem;
  const configs = Context.get(
    yield* Layer.build(
      config.lifetimes.serving.pipe(
        Layer.provide(Layer.mergeAll(Layer.succeed(ProgramRoad, localRoad([])), Layer.succeed(Git, demo.graph.git), BunFileSystem.layer)),
      ),
    ),
    Configs,
  );
  const put = Effect.fnUntraced(function* (path: string, text: string) {
    const at = join(demo.demoRoot, path);
    yield* files.makeDirectory(dirname(at), { recursive: true });
    yield* files.writeFileString(at, text);
  });
  yield* put(
    'package.json',
    JSON.stringify({ name: 'law-lab', private: true, workspaces: ['packages/*'], dependencies: { effect: '4.0.1' } }),
  );
  yield* put('packages/ui/package.json', JSON.stringify({ name: '@law-lab/ui', type: 'module', exports: './src/index.ts' }));
  yield* put('packages/ui/src/index.ts', 'export const panel = 1;\n');
  yield* put('packages/core/package.json', JSON.stringify({ name: '@law-lab/core', type: 'module', exports: './src/index.ts' }));
  yield* put('packages/core/src/index.ts', 'export const base = 1;\n');
  yield* put('packages/domain/package.json', JSON.stringify({ name: '@law-lab/domain', type: 'module' }));
  yield* put('packages/domain/src/legacy.ts', "import { base } from '@law-lab/core';\nexport const legacy = base;\n");
  yield* put('packages/domain/src/summary.ts', 'export const summary = 1;\n');
  yield* fixture.committed('law-lab seed');
  const rule = yield* fixture.created(['rule'], 'Domain code never loads the UI', { sources: [{ kind: 'dir', ref: 'packages/domain' }] });
  const context = withLanes(demo.context, workers).pipe(Context.add(Configs, configs));
  const mine = () => ({ _tag: 'Thread' as const, threadId: ThreadId.make(MINE), projectId: demo.projectId });
  const origin = { ...PLACE, generation: 0, work: { projectId: demo.projectId, threadId: MINE } } as WorkingOrigin;
  const enforced = (input: Unbased) =>
    fixture.working(
      Effect.flatMap(based(input), (full) => perform(bodies.enforce_rule, full, operator)).pipe(Effect.provideService(Configs, configs)),
    );
  const wrote = Effect.fnUntraced(function* (path: string, text: string) {
    const at = join(demo.demoRoot, path);
    const before = (yield* files.exists(at)) ? yield* files.readFileString(at) : '';
    yield* put(path, text);
    yield* recordWrite(demo.graph.units, demo.graph.store, demo.projectId, MINE, testPlace(path), { before, after: text, mode: '100644' });
  });
  const landedAlone = Effect.fnUntraced(function* (path: string) {
    yield* gitEffect(demo.demoRoot, ['add', path]);
    yield* gitEffect(demo.demoRoot, ['commit', '-qm', `land ${path}`]);
  });
  const submitted = Effect.fnUntraced(function* () {
    const services = yield* landingServices;
    return yield* Effect.acquireUseRelease(
      claimPreparedInstance(preparedBase(demo.graph.store)),
      (inst) =>
        submitOver(
          demo.graph.git,
          demo.demoRoot,
          demo.graph.store,
          demo.graph.units,
          origin,
          { projectId: demo.projectId, tasks: [], taking: [] },
          actChecks(checksOver({ graphOf: () => Effect.succeed(context) }), 'submit_work'),
          makePreparedChanges(
            { commands: quietCommands, pathsOfThread, evidenceInGroups },
            landingAdmission(makeLandingHolds()),
            judgingFns(CHECKOUT_DIRECTORY),
            inst.dir,
          ),
        ).pipe(Effect.provide(services)),
      (inst) => inst.release,
    );
  });
  const checked = Effect.fnUntraced(
    function* (inspection: string) {
      const row = yield* demo.graph.blocks.blockById(yield* demo.graph.blockNames.idOfName(rule));
      const ask = { projectId: demo.projectId, caller: mine(), rules: 'all' as const, inspection, row };
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
                origin,
                checkout: TEST_CHECKOUT,
                input: { taking: [] },
                job: `check:${randomUUID()}`,
                caller: mine(),
                act: { kind: 'thread', ...origin.work },
              },
            );
            if (prepared === null) return yield* Effect.die('the session holds no change to check');
            const { subject } = prepared;
            const version = { projectId: demo.projectId, actor: mine(), root: subject.root, tree: subject.built };
            const targets = yield* targetsOf(ask, version);
            return yield* changeChecked(ask, targets, subject).pipe(Effect.ensuring(releasePrepared(prepared)));
          }),
        (inst) => inst.release,
      );
    },
    (effect) => Effect.provide(effect, context),
  );
  const inspections = (input: InputOf<typeof ENFORCEMENT_OPERATIONS.read_inspections>) =>
    fixture.working(perform(bodies.read_inspections, input, operator).pipe(Effect.provideService(Configs, configs)));
  const enforcement = (input: InputOf<typeof ENFORCEMENT_OPERATIONS.read_enforcement>) =>
    fixture.working(perform(bodies.read_enforcement, input, operator).pipe(Effect.provideService(Configs, configs)));
  const voiced = (answer: Parameters<NonNullable<typeof bodies.read_inspections.voice>>[0]) =>
    fixture.working(
      bodies.read_inspections.voice!(
        answer,
        {},
        {
          caller: operator,
          operation: OperationId.make('read_inspections'),
          budget: { bytes: TOOL_TEXT, lines: TOOL_TEXT },
        },
      ).pipe(
        Effect.provideService(Configs, configs),
        Effect.flatMap((spoken) => (typeof spoken === 'string' ? Effect.succeed(spoken) : Effect.die('read_inspections spoke no text'))),
      ),
    );
  return {
    rule,
    enforced,
    inspections,
    voiced,
    enforcement,
    created: fixture.created,
    wrote,
    landedAlone,
    submitted,
    checked,
    rev: fixture.head,
    documentOf: () => fixture.documentOf(rule),
  };
});

const withCase = <A, E, R>(body: (scene: Effect.Success<ReturnType<typeof makeCase>>) => Effect.Effect<A, E, R>) =>
  withEnforcement((fixture) => Effect.flatMap(makeCase(fixture), body));

const GATED = { strictness: 'gate', on: TRIGGERS.landing } as const;

const required = (signature: string): readonly string[] => {
  const source = ts.createSourceFile(
    'params.d.ts',
    signature.startsWith('{') ? `type Params = ${signature}` : signature,
    ts.ScriptTarget.Latest,
    true,
  );
  const alias = source.statements.find(ts.isTypeAliasDeclaration);
  if (alias === undefined || !ts.isTypeLiteralNode(alias.type)) return [];
  return alias.type.members.flatMap((one) => (ts.isPropertySignature(one) && one.questionToken === undefined ? [one.name.getText()] : []));
};

const callsOf = (signature: string): readonly ts.FunctionDeclaration[] => {
  const calls: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('inspection.d.ts', signature, ts.ScriptTarget.Latest, true));
  return calls;
};

layer(enforceFixture(), { excludeTestServices: true })('rules name an inspection key of tagma.config.ts', (it) => {
  it.effect(
    'read_inspections describes SDK calls separately from builtin params and resolves keys at HEAD with their defaults and rules; read_enforcement answers an enforced rule with its key and function and one followed as text with its title; a config that loses the gated key refuses inspection-failed',
    () =>
      withCase((scene) =>
        Effect.gen(function* () {
          const listed = yield* scene.inspections({});
          expect(listed.rows?.map((one) => one.name)).toEqual(expect.arrayContaining(['Loading.forbid', 'Effect.noSwallowedFailures']));
          expect((yield* scene.voiced(listed)).length).toBeLessThanOrEqual(TOOL_TEXT);
          const named = yield* scene.inspections({ name: 'Loading.forbid' });
          expect(named.form?.builtin).toBe('loads');
          expect(required(named.form?.signature ?? '')).toEqual(['from', 'refuses']);
          expect((yield* scene.voiced(named)).length).toBeLessThanOrEqual(TOOL_TEXT);
          const ceiling = yield* scene.inspections({ name: 'Files.maxLines' });
          const parameters = callsOf(ceiling.form?.signature ?? '')[0]?.parameters;
          expect(parameters?.map((one) => one.type?.kind)).toEqual([ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.TypeReference]);
          expect(parameters?.[1]?.questionToken).toBeDefined();
          const size = yield* scene.inspections({ name: 'size' });
          expect(required(size.form?.signature ?? '')).toEqual(['thresholds']);
          const command = yield* scene.inspections({ name: 'Linters.command' });
          expect(callsOf(command.form?.signature ?? '').map((one) => one.parameters.length)).toEqual([1, 2]);
          const program = yield* scene.inspections({ name: 'defineInspection' });
          expect(callsOf(program.form?.signature ?? '').map((one) => one.parameters.length)).toEqual([1]);
          yield* scene.wrote('tagma.config.ts', configOf(['@law-lab/ui']));
          yield* scene.landedAlone('tagma.config.ts');
          yield* scene.enforced({ blockId: scene.rule, inspection: 'domain-no-ui', ...GATED });
          const keyed = yield* scene.inspections({ key: 'domain-no-ui' });
          expect(JSON.parse(keyed.key?.description ?? '{}')).toMatchObject({
            builtin: 'loads',
            params: { base: '', from: ['packages/domain'], refuses: ['@law-lab/ui'], allows: [], reads: 'runtime', conditions: [] },
          });
          expect(keyed.key?.rules.map((one) => one.rule)).toEqual([scene.rule]);

          const text = yield* scene.created(['rule'], 'Domain code names things by meaning');
          const rows = (yield* scene.enforcement({})).rules?.rows ?? [];
          expect(rows.find((one) => one.rule === scene.rule)).toMatchObject({
            inspection: 'domain-no-ui',
            function: 'Loading.forbid',
            enabled: true,
          });
          expect(rows.find((one) => one.rule === text)).toMatchObject({
            title: 'Domain code names things by meaning',
            inspection: null,
            checker: null,
            strictness: null,
            delivery: 'prompt',
            enabled: true,
            unreadable: false,
          });

          yield* scene.wrote('tagma.config.ts', configOf(['@law-lab/ui'], 'domain-pure'));
          const lost = yield* refusalOf(scene.submitted());
          expect(lost.code).toBe('inspection-failed');
          expect(lost.reason).toContain('domain-no-ui');
          expect(lost.reason).toContain(scene.rule);
        }),
      ),
  );

  it.effect(
    'a key in the uncommitted config is tried over the change, refused by enforce_rule until the config lands, then gates the landing',
    () =>
      withCase((scene) =>
        Effect.gen(function* () {
          yield* scene.wrote('tagma.config.ts', configOf(['@law-lab/ui']));
          yield* scene.wrote('packages/domain/src/summary.ts', "import { panel } from '@law-lab/ui';\nexport const summary = panel;\n");
          const tried = yield* scene.checked('domain-no-ui');
          expect(tried.violations.map((one) => one.fingerprint)).toContain(CROSSING);
          expect((yield* refusalOf(scene.enforced({ blockId: scene.rule, inspection: 'domain-no-ui', ...GATED }))).code).toBe(
            'inspection-unknown',
          );
          yield* scene.landedAlone('tagma.config.ts');
          yield* scene.enforced({ blockId: scene.rule, inspection: 'domain-no-ui', ...GATED });
          expect(yield* scene.documentOf()).toMatchObject({ inspection: 'domain-no-ui', debt: [], escaped: [] });
          const refused = yield* refusalOf(scene.submitted());
          expect(refused.code).toBe('rule-violated');
          expect(refused.reason).toMatch(/· gate\n {4}fix: .+\n {4}packages\/domain\/src\/summary\.ts:1 loads `@law-lab\/ui`/u);
          expect(refused.unblock.join('\n')).toContain(`"${CROSSING}"`);
        }),
      ),
  );
});
