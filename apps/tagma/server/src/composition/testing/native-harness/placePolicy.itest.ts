import { callerInThread } from '../callers';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from '@runlith/agent/tool';
import { toolExecute, toolPrepare } from '@runlith/agent/tool';
import { CommandRefused, type CommandWork } from '@runlith/agent-tools/CommandWork';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import { landedOf } from '@runlith/agent-tools/WorkspaceChanges';
import type { CommentPolicy } from '@runlith/source-comments';
import { Effect } from 'effect';
import { graphFixture, type EffectDemo } from '../graphFixture.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { checkoutWorld, makeMachineWorld, writeRule } from '../../../executions/testing/doubles.js';
import { commandTimes } from '../../../executions/commands/times.js';
import { commentPolicy } from '../../../graph/settings.js';
import { governingProject } from '../../../workspace/governing.js';
import { asThreadContext, worldTools } from '../../../native-harness/testing/doubles.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { checkoutPaths, fixedCoverage } from '../../../workspace/testing/doubles.js';

const fixture = graphFixture({ projects: ['other'] });
const THREAD = '01a07000-0000-7000-8000-0000000000d1';

const unrecorded = {
  changes: () => ({
    land: <E, R>(_changes: readonly unknown[], write: Effect.Effect<boolean, E, R>) =>
      Effect.map(write, (written) => landedOf(written, false)),
    landEach: <E, R>(_changes: readonly unknown[], write: Effect.Effect<readonly boolean[], E, R>) =>
      Effect.map(write, (written) => written.map((one) => landedOf(one, false))),
    command: () => Effect.succeed(null),
  }),
};

const toolsAt = Effect.fnUntraced(function* (
  demo: EffectDemo,
  home: string,
  other: string,
  asked: number[],
  comments: CommentPolicy = 'allowed',
) {
  const otherId = demo.project('other').id;
  const homeCoverage = fixedCoverage(demo.projectId, [{ checkout: 'home', root: home }]);
  const otherCoverage = fixedCoverage(otherId, [{ checkout: 'other', root: other }]);
  const paths = yield* checkoutPaths(
    { ...homeCoverage, covered: (id) => (id === otherId ? otherCoverage : homeCoverage).covered(id) },
    demo.graph.projects,
  );
  const places = {
    locate: (path: string) => paths.placeAcross(path),
    resource: (path: string) => paths.resourceAcross(path),
    enter: () => Effect.void,
  };
  const work: CommandWork = {
    retainedBytes: 4096,
    startedBy: () => Effect.succeed(null),
    start: (request) => {
      asked.push(request.waitMs ?? -1);
      return Effect.fail(new CommandRefused({ reason: 'the test only reads what the command was given', certainty: 'unsubmitted' }));
    },
  };
  const base = checkoutWorld({ projectRoot: home, scratch: join(home, 'scratch'), world: makeMachineWorld(() => null) });
  return worldTools(
    asThreadContext({
      thread: { id: THREAD, model: null, authority: { mode: 'trust', bypassFrom: null } },
      world: { ...base, world: { ...base.world, commandWork: work } },
      projectId: demo.projectId,
      projectRoot: home,
      workingRoot: home,
      origin: null,
      settings: demo.graph.settings,
      comments: () => comments,
      commandTimes: commandTimes(demo.graph.store, demo.projectId, governingProject(places.resource, demo.projectId)),
      places,
      identity: sessionIdentity,
      grants: testGrantSigner,
      changeRecord: unrecorded,
      checkoutFlights: new CheckoutFlights(),
    }),
    { web: false },
  );
});

const called = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const execute = toolExecute(tool);
  if (!execute) return yield* Effect.die(new Error('the tool declares no execute'));
  const call = { toolCallId: 'call-1', caller: callerInThread(THREAD, 'run-1') };
  const prepare = toolPrepare(tool);
  const prepared = prepare === null ? null : (yield* prepare(input, call)).prepared;
  yield* execute(input, { ...call, messages: [], prepared }) as Effect.Effect<unknown, unknown>;
});

it.live('a command and a write in another project are judged by that project’s command rule and comment policy', () =>
  Effect.acquireUseRelease(
    fixture.openEffect(),
    (opened) =>
      Effect.gen(function* () {
        const demo = opened.effects;
        const home = realpathSync(demo.demoRoot);
        const other = realpathSync(demo.project('other').root);
        const otherId = demo.project('other').id;
        yield* demo.graph.settings.write({ scope: 'project', projectId: otherId, key: commentPolicy.id, value: 'forbid' });
        yield* writeRule(demo.graph.store, {
          projectId: otherId,
          thread: null,
          through: null,
          program: null,
          measure: 'wait',
          limitMs: 45_000,
          writer: 'operator',
          words: 'wait 45 seconds in the other project',
          position: { at: 'end' },
        });
        const asked: number[] = [];
        const tools = yield* toolsAt(demo, home, other, asked);
        yield* called(tools.bash as Tool, { command: 'true', description: 'Run in the other project', workdir: other });
        yield* called(tools.bash as Tool, { command: 'true', description: 'Run at home', workdir: home });
        expect(asked).toEqual([45_000, 120_000]);

        const written = 'const a = 1; // why it is one\n';
        yield* called(tools.write as Tool, { path: join(other, 'a.ts'), content: written });
        yield* called(tools.write as Tool, { path: join(home, 'a.ts'), content: written });
        expect(readFileSync(join(other, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
        expect(readFileSync(join(home, 'a.ts'), 'utf8')).toBe(written);

        const link = join(home, 'linked');
        symlinkSync(join(other, 'a.ts'), link);
        yield* called(tools.write as Tool, { path: link, content: 'const a = 2; // why it is two\n' });
        expect(readFileSync(join(other, 'a.ts'), 'utf8')).toBe('const a = 2;\n');
        yield* called(tools.edit as Tool, { path: link, oldString: 'const a = 2;', newString: 'const a = 3; // why it is three' });
        expect(readFileSync(join(other, 'a.ts'), 'utf8')).toBe('const a = 3;\n');

        const outside = yield* demo.fixture.directory('outside');
        const outsideLink = join(outside, 'linked.ts');
        symlinkSync(join(other, 'a.ts'), outsideLink);
        yield* called(tools.write as Tool, { path: outsideLink, content: written });
        expect(readFileSync(join(other, 'a.ts'), 'utf8')).toBe('const a = 1;\n');

        writeFileSync(join(home, 'local.ts'), written);
        symlinkSync(join(home, 'local.ts'), join(other, 'back.ts'));
        yield* called(tools.write as Tool, { path: join(other, 'back.ts'), content: written });
        expect(readFileSync(join(home, 'local.ts'), 'utf8')).toBe(written);
      }).pipe(Effect.provide(opened.context)),
    () => Effect.orDie(fixture.releaseEffect),
  ),
);

it.live('a write outside every checkout keeps its comments though the home project forbids them', () =>
  Effect.acquireUseRelease(
    fixture.openEffect(),
    (opened) =>
      Effect.gen(function* () {
        const demo = opened.effects;
        const home = realpathSync(demo.demoRoot);
        const other = realpathSync(demo.project('other').root);
        const tools = yield* toolsAt(demo, home, other, [], 'forbid');
        const written = 'const a = 1; // why it is one\n';
        const scratch = realpathSync(yield* demo.fixture.directory('scratch'));
        yield* called(tools.write as Tool, { path: join(scratch, 'a.ts'), content: written });
        yield* called(tools.write as Tool, { path: join(home, 'a.ts'), content: written });
        expect(readFileSync(join(scratch, 'a.ts'), 'utf8')).toBe(written);
        expect(readFileSync(join(home, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
      }).pipe(Effect.provide(opened.context)),
    () => Effect.orDie(fixture.releaseEffect),
  ),
);
