import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Result } from 'effect';
import { ProjectIdentification, Projects } from '../../../projects/contract/service/registry.js';
import { commandRule, COMMAND_RULE_PAIRS, resolveCommandPolicy } from '../../../executions/testing/doubles.js';
import { project as projectRow } from '../../../projects/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { demoGraphLayer, withDemo, type EffectDemo } from '../graphFixture.js';
import { threadStack } from '../threadParts.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../../projects/contract/service/caller.js';
import { type CommandRule, type RuleMeasure, RULES_PER_LIST } from '../../../executions/contract/wire/commandRules.js';
import { overridesOf, resolveCommandTime } from '../../../executions/commands/ruleResolution.js';
import { tagIndex } from '../../../graph/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import type { COMMAND_RULE_OPERATIONS } from '../../../executions/contract/wire/operations/commandRules.js';
import { currentRules } from '../../../executions/store/standingRules.js';
import { forProject } from '../../../invocation/testing/call.js';
import { BEHAVIOUR_REGISTRY, ENTRY_KINDS } from '../composed.js';

const DEFAULT_LIFE_MS = 3_600_000;
const fixture = demoGraphLayer().pipe(Layer.provide(BunFileSystem.layer));

const mustRefuse = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<GateRefusal, never, R> =>
  Effect.flatMap(Effect.result(work), (answer) =>
    Result.isFailure(answer) && answer.failure instanceof GateRefusal
      ? Effect.succeed(answer.failure)
      : Effect.die(new Error('the act was not refused with a gate condition')),
  );

const makeRules = Effect.fnUntraced(function* (demo: EffectDemo) {
  const records = yield* makeThreadRecords;
  const { store, threads } = yield* threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: ENTRY_KINDS });
  const born = (projectId: number) =>
    demo.graph.units.write('commandRules.born', (tx) =>
      Effect.gen(function* () {
        const row = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, tx);
        yield* threads.rows.attachFacet({ threadId: row.id, projectId }, tx);
        return row.id;
      }),
    );
  const first = yield* born(demo.projectId);
  const second = yield* born(demo.projectId);
  const callerOf = (threadId: string): Caller => ({
    actor: { kind: 'thread', threadId, projectId: demo.projectId, principalId: 'operator', session: { harness: 'tagma', key: threadId } },
    files: null,
  });
  const performed = <A, E>(work: Effect.Effect<A, E, CurrentProject | MachineStore | Projects | ProjectIdentification>) =>
    work.pipe(
      Effect.provideService(Projects, demo.graph.projects),
      Effect.provideService(ProjectIdentification, Context.get(demo.context, ProjectIdentification)),
      forProject(
        Effect.succeed({
          project: { id: demo.projectId, name: 'demo' },
          vocabulary: tagIndex([], BEHAVIOUR_REGISTRY),
          lens: { scope: undefined, names: 'law-and-reflections' as const },
          deliveredTags: new Set<string>(),
        }),
      ),
      Effect.provideService(MachineStore, demo.graph.store),
    );
  const written = (by: string, input: InputOf<typeof COMMAND_RULE_OPERATIONS.write_command_rule>) => {
    const body = COMMAND_RULE_PAIRS().write_command_rule.body;
    return performed(Effect.flatMap(body.prepare!(input, callerOf(by)), (prepared) => body.execute(input, prepared, callerOf(by))));
  };
  const refusal = (by: string, input: InputOf<typeof COMMAND_RULE_OPERATIONS.write_command_rule>) => mustRefuse(written(by, input));
  const remove = (rule: CommandRule) => {
    const body = COMMAND_RULE_PAIRS().remove_command_rule.body;
    return performed(
      Effect.flatMap(body.prepare!({ id: rule.id }, callerOf(first)), (prepared) =>
        body.execute({ id: rule.id }, prepared, callerOf(first)),
      ),
    );
  };
  const read = (by: string, input: InputOf<typeof COMMAND_RULE_OPERATIONS.read_command_rules>) =>
    performed(COMMAND_RULE_PAIRS().read_command_rules.body.execute(input, undefined, callerOf(by)));
  const standing = (thread: string | null) =>
    Effect.map(currentRules(demo.graph.store, demo.projectId, thread), (rows) => rows.map((row) => row.rule));
  const timeOf = (thread: string, requested: number | undefined, tool = 'bash', measure: RuleMeasure = 'life') =>
    Effect.map(standing(thread), (rules) => resolveCommandTime({ rules, thread, tool, measure, requested }));
  return { demo, first, second, born, callerOf, performed, written, refusal, remove, read, standing, timeOf };
});

type Rules = Effect.Success<ReturnType<typeof makeRules>>;
const withRules = <A, E, R>(body: (rules: Rules) => Effect.Effect<A, E, R>) => withDemo((demo) => Effect.flatMap(makeRules(demo), body));

layer(fixture, { excludeTestServices: true })('command rules', (it) => {
  it.effect("a thread's tighter rule decides its own calls, a looser one lengthens nothing, and another thread keeps the project's", () =>
    withRules(({ first, second, written, timeOf }) =>
      Effect.gen(function* () {
        const project = yield* written(first, {
          reach: 'project',
          measure: 'life',
          limitMs: 1_200_000,
          words: 'any bash gets twenty minutes',
        });
        const own = yield* written(first, { reach: 'thread', measure: 'life', limitMs: 300_000, words: 'this thread gets five' });
        const looser = yield* written(second, {
          reach: 'thread',
          measure: 'life',
          limitMs: 1_800_000,
          words: 'this thread gets half an hour',
        });
        expect(looser.overriddenBy.map((rule) => rule.id)).toEqual([project.rule.id]);
        expect(yield* timeOf(first, undefined)).toEqual({ limitMs: 300_000, origin: 'rule', rule: own.rule });
        expect(yield* timeOf(second, undefined)).toEqual({ limitMs: 1_200_000, origin: 'rule', rule: project.rule });
        expect(yield* timeOf(first, 600_000)).toEqual({ limitMs: 300_000, origin: 'rule', rule: own.rule });
        expect(yield* timeOf(first, 60_000)).toEqual({ limitMs: 60_000, origin: 'caller', rule: own.rule });
      }),
    ),
  );

  it.effect('the default answers where no rule reaches: an act of no thread, a tool rules do not bound, a thread with none', () =>
    withRules(({ first, written, standing, timeOf }) =>
      Effect.gen(function* () {
        yield* written(first, { reach: 'project', measure: 'life', limitMs: 120_000, words: 'two minutes for everything' });
        const rules = yield* standing(first);
        expect(resolveCommandTime({ rules, thread: null, tool: 'bash', measure: 'life', requested: undefined })).toEqual({
          limitMs: DEFAULT_LIFE_MS,
          origin: 'default',
          rule: null,
        });
        expect((yield* timeOf(first, undefined, 'submit_work')).origin).toBe('default');
        expect((yield* timeOf(first, undefined, 'bash', 'wait')).origin).toBe('default');
      }),
    ),
  );

  it.effect('a wait rule written for every project and one for a thread decide the wait of bash alone, the tighter binding', () =>
    withRules(({ first, second, written, remove, timeOf }) =>
      Effect.gen(function* () {
        const everywhere = yield* written(first, {
          reach: 'machine',
          measure: 'wait',
          limitMs: 30_000,
          words: 'wait 30 seconds for all projects',
        });
        const here = yield* written(first, { reach: 'thread', measure: 'wait', limitMs: 60_000, words: 'wait 1 minute on this thread' });
        expect(here.overriddenBy.map((rule) => rule.id)).toEqual([everywhere.rule.id]);
        expect(yield* timeOf(first, undefined, 'bash', 'wait')).toEqual({ limitMs: 30_000, origin: 'rule', rule: everywhere.rule });
        expect((yield* timeOf(first, undefined, 'bash', 'life')).origin).toBe('default');
        expect((yield* timeOf(first, undefined, 'inspection', 'wait')).origin).toBe('default');
        yield* remove(everywhere.rule);
        expect(yield* timeOf(first, 600_000, 'bash', 'wait')).toEqual({ limitMs: 60_000, origin: 'rule', rule: here.rule });
        expect((yield* timeOf(second, undefined, 'bash', 'wait')).origin).toBe('default');
      }),
    ),
  );

  it.effect('a wait is refused where nothing waits — inspection, commit-step, a program — and a figure past its measure’s ceiling', () =>
    withRules(({ first, refusal, standing }) =>
      Effect.gen(function* () {
        for (const through of ['inspection', 'commit-step']) {
          expect(
            (yield* refusal(first, { reach: 'project', measure: 'wait', through, limitMs: 60_000, words: 'wait a minute' })).code,
          ).toBe('command-rule-measure');
        }
        expect(
          (yield* refusal(first, { reach: 'project', measure: 'wait', program: { words: ['tsc'] }, limitMs: 60_000, words: 'tsc waits' }))
            .code,
        ).toBe('command-rule-measure');
        expect((yield* refusal(first, { reach: 'project', measure: 'wait', limitMs: 600_001, words: 'wait long' })).code).toBe(
          'command-rule-measure',
        );
        expect((yield* refusal(first, { reach: 'project', measure: 'life', limitMs: 21_600_001, words: 'live long' })).code).toBe(
          'command-rule-measure',
        );
        expect(yield* standing(first)).toEqual([]);
      }),
    ),
  );

  it.effect('a program folder outside the project and a tool rules do not reach are refused and stand nowhere', () =>
    withRules(({ first, refusal, standing }) =>
      Effect.gen(function* () {
        for (const folder of ['/opt/workspaces/runlith/apps/api', '../elsewhere', 'apps/../../elsewhere']) {
          const outside = yield* refusal(first, {
            reach: 'project',
            measure: 'life',
            program: { words: ['tsc'], folder },
            limitMs: 60_000,
            words: 'tsc gets a minute',
          });
          expect(outside.code).toBe('command-rule-folder');
        }
        const through = yield* refusal(first, {
          reach: 'project',
          measure: 'life',
          through: 'submit_work',
          limitMs: 60_000,
          words: 'commits get a minute',
        });
        expect(through.code).toBe('command-rule-through');
        expect(yield* standing(first)).toEqual([]);
      }),
    ),
  );

  it.effect(
    'a program rule stands, joins no whole-call decision, and is copied for admission after the project list and before the thread list',
    () =>
      withRules(({ first, second, written, standing, timeOf, refusal }) =>
        Effect.gen(function* () {
          const project = yield* written(first, {
            reach: 'project',
            measure: 'life',
            program: { words: ['tsc'], folder: 'apps/api/../api' },
            limitMs: 60_000,
            words: 'tsc in apps/api gets a minute',
          });
          const own = yield* written(first, {
            reach: 'thread',
            measure: 'life',
            program: { words: ['tsc'] },
            limitMs: 30_000,
            words: 'my tsc gets thirty seconds',
          });
          expect(own.overrides.map((rule) => rule.id)).toEqual([project.rule.id]);
          expect((yield* timeOf(first, undefined)).origin).toBe('default');
          const receipt = resolveCommandPolicy(
            { rules: yield* standing(first) },
            { thread: first, tool: 'bash', requested: undefined, root: '/checkout' },
          );
          expect(receipt.time.programs?.root).toBe('/checkout');
          expect(receipt.time.programs?.rules.map((copy) => [copy.id, copy.program.words, copy.limitMs])).toEqual([
            [project.rule.id, ['tsc'], 60_000],
            [own.rule.id, ['tsc'], 30_000],
          ]);
          expect(receipt.time.rules).toEqual([]);
          const other = resolveCommandPolicy(
            { rules: yield* standing(second) },
            { thread: second, tool: 'bash', requested: undefined, root: '/checkout' },
          );
          expect(other.time.programs?.rules.map((copy) => copy.id)).toEqual([project.rule.id]);
          const unrooted = resolveCommandPolicy(
            { rules: yield* standing(first) },
            { thread: first, tool: 'bash', requested: undefined, root: null },
          );
          expect(unrooted.time.programs?.root).toBeUndefined();
          expect(unrooted.time.programs?.rules.map((copy) => copy.id)).toEqual([own.rule.id]);
          const named = yield* refusal(first, {
            reach: 'project',
            measure: 'life',
            program: { words: ['node_modules/.bin/tsc'] },
            limitMs: 60_000,
            words: 'tsc by path',
          });
          expect(named.code).toBe('command-rule-program');
        }),
      ),
  );

  it.effect('program rules overlap only where one could bind a process the other binds', () =>
    Effect.sync(() => {
      const rule = (id: string, words: [string, ...string[]], folder?: string): CommandRule => ({
        id,
        project: 1,
        thread: null,
        through: null,
        program: { words, folder },
        measure: 'life',
        limitMs: 60_000,
        origin: { writer: 'operator', at: new Date(0).toISOString(), words: id },
      });
      const wide = rule('wide', ['git']);
      const commit = rule('commit', ['git', 'commit'], 'apps');
      const inner = rule('inner', ['git', 'commit', '-m'], 'apps/api');
      const push = rule('push', ['git', 'push']);
      const sibling = rule('sibling', ['git', 'commit'], 'packages');
      const whole: CommandRule = { ...wide, id: 'whole', program: null };
      const all = [wide, commit, inner, push, sibling, whole];
      expect(overridesOf(inner, all).overrides.map((one) => one.id)).toEqual(['wide', 'commit']);
      expect(overridesOf(sibling, all).overrides.map((one) => one.id)).toEqual(['wide']);
      expect(overridesOf(whole, all).overrides).toEqual([]);
    }),
  );

  it.effect('a place beside a rule that is gone, or that stands in another list, is refused', () =>
    withRules(({ first, written, refusal, remove }) =>
      Effect.gen(function* () {
        const project = yield* written(first, { reach: 'project', measure: 'life', limitMs: 120_000, words: 'two minutes' });
        const beside = yield* refusal(first, {
          reach: 'thread',
          measure: 'life',
          limitMs: 60_000,
          words: 'one minute here',
          at: 'after',
          anchor: project.rule.id,
        });
        expect(beside.code).toBe('command-rule-anchor');
        yield* remove(project.rule);
        const gone = yield* refusal(first, {
          reach: 'project',
          measure: 'life',
          limitMs: 60_000,
          words: 'one minute',
          at: 'before',
          anchor: project.rule.id,
        });
        expect(gone.code).toBe('command-rule-anchor');
      }),
    ),
  );

  it.effect(
    'a rule stands where its place names it, across the gaps a removal leaves, and the answer names what it overrides and what overrides it',
    () =>
      withRules(({ first, second, written, remove, standing }) =>
        Effect.gen(function* () {
          const last = yield* written(first, { reach: 'project', measure: 'life', limitMs: 300_000, words: 'five minutes' });
          const opening = yield* written(first, {
            reach: 'project',
            measure: 'life',
            limitMs: 900_000,
            words: 'fifteen minutes',
            at: 'start',
          });
          const own = yield* written(second, { reach: 'thread', measure: 'life', limitMs: 60_000, words: 'one minute for this thread' });
          const middle = yield* written(first, {
            reach: 'project',
            measure: 'life',
            through: 'bash',
            limitMs: 600_000,
            words: 'ten minutes for bash',
            at: 'after',
            anchor: opening.rule.id,
          });
          expect(middle.overrides.map((rule) => rule.id)).toEqual([opening.rule.id]);
          expect(middle.overriddenBy.map((rule) => rule.id)).toEqual([last.rule.id, own.rule.id]);
          expect(own.overrides.map((rule) => rule.id)).toEqual([opening.rule.id, last.rule.id]);
          expect(own.overriddenBy).toEqual([]);
          const late = yield* written(first, {
            reach: 'project',
            measure: 'life',
            limitMs: 450_000,
            words: 'seven and a half',
            at: 'before',
            anchor: last.rule.id,
          });
          expect((yield* standing(null)).map((rule) => rule.id)).toEqual([opening.rule.id, middle.rule.id, late.rule.id, last.rule.id]);
          yield* remove(middle.rule);
          const again = yield* written(first, {
            reach: 'project',
            measure: 'life',
            limitMs: 480_000,
            words: 'eight',
            at: 'after',
            anchor: opening.rule.id,
          });
          const head = yield* written(first, {
            reach: 'project',
            measure: 'life',
            limitMs: 30_000,
            words: 'thirty seconds first',
            at: 'start',
          });
          expect((yield* standing(null)).map((rule) => rule.id)).toEqual([
            head.rule.id,
            opening.rule.id,
            again.rule.id,
            late.rule.id,
            last.rule.id,
          ]);
        }),
      ),
  );

  it.effect("a thread's list is walked page by page in the order that decides it, the project's rules before the thread's", () =>
    withRules(({ first, second, written, read }) =>
      Effect.gen(function* () {
        const a = yield* written(first, { reach: 'thread', measure: 'life', limitMs: 60_000, words: 'thread one' });
        const b = yield* written(first, { reach: 'project', measure: 'life', limitMs: 120_000, words: 'project one' });
        const c = yield* written(first, { reach: 'thread', measure: 'life', limitMs: 180_000, words: 'thread two', at: 'start' });
        const d = yield* written(first, { reach: 'project', measure: 'life', limitMs: 240_000, words: 'project two' });
        yield* written(second, { reach: 'thread', measure: 'life', limitMs: 300_000, words: 'not this thread' });
        const walked: string[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = yield* read(first, { limit: 1, cursor });
          expect(page.total).toBe(4);
          walked.push(...page.rules.map((rule) => rule.id));
          if (page.next === null) break;
          cursor = page.next;
        }
        expect(walked).toEqual([b.rule.id, d.rule.id, c.rule.id, a.rule.id]);
        expect((yield* mustRefuse(read(second, { limit: 1, cursor }))).code).toBe('cursor-stale');
      }),
    ),
  );

  it.effect('a machine rule caps the threads of every project, and another project is written into, read and removed by naming it', () =>
    withRules(({ demo, first, second, born, callerOf, performed, written, refusal, read, remove }) =>
      Effect.gen(function* () {
        const otherProject = demo.projectId + 1;
        yield* demo.graph.store.db
          .insert(projectRow())
          .values({ id: otherProject, name: 'other', repoKey: '/other', rootPath: '/other', createdAt: new Date(0) });
        const stranger = yield* born(otherProject);
        const ids = (rules: readonly CommandRule[]) => rules.map((rule) => rule.id);
        const standingIn = (projectId: number, thread: string) =>
          Effect.map(currentRules(demo.graph.store, projectId, thread), (rows) => rows.map((row) => row.rule));
        const machine = yield* written(first, { reach: 'machine', measure: 'life', limitMs: 60_000, words: 'one minute everywhere' });
        expect(machine.rule).toMatchObject({ project: null, thread: null });
        const theirs = yield* written(first, {
          reach: 'project',
          measure: 'life',
          project: 'other',
          limitMs: 30_000,
          words: 'thirty seconds over there',
        });
        expect(theirs.rule.project).toBe(otherProject);
        const asked = { reach: 'thread', measure: 'life', thread: stranger, limitMs: 90_000, words: 'ninety for that thread' } as const;
        const confirmed = yield* performed(COMMAND_RULE_PAIRS().write_command_rule.body.prepare!(asked, callerOf(first)));
        expect(confirmed).toMatchObject({ projectId: otherProject, thread: stranger });
        const strangers = yield* written(first, asked);
        expect(strangers.rule.project).toBe(otherProject);
        expect(ids(strangers.overriddenBy)).toEqual([machine.rule.id, theirs.rule.id]);
        const looser = yield* written(second, { reach: 'machine', measure: 'life', limitMs: 120_000, words: 'later and looser' });
        expect(ids(looser.overrides)).toEqual([machine.rule.id]);
        expect(ids(looser.overriddenBy)).toEqual([theirs.rule.id, strangers.rule.id]);
        const decided = (projectId: number, thread: string) =>
          Effect.map(standingIn(projectId, thread), (rules) =>
            resolveCommandTime({ rules, thread, tool: 'bash', measure: 'life', requested: undefined }),
          );
        expect(yield* decided(otherProject, stranger)).toMatchObject({ limitMs: 30_000, rule: { id: theirs.rule.id } });
        expect(yield* decided(demo.projectId, first)).toMatchObject({ limitMs: 120_000, origin: 'rule' });
        expect((yield* read(first, { thread: stranger })).rules.map((rule) => rule.origin.words)).toEqual([
          'one minute everywhere',
          'later and looser',
          'thirty seconds over there',
          'ninety for that thread',
        ]);
        expect(ids((yield* read(first, { reach: 'project', project: String(otherProject) })).rules)).toHaveLength(3);
        expect((yield* read(first, { reach: 'machine' })).rules.every((rule) => rule.project === null)).toBe(true);
        expect(
          (yield* refusal(first, { reach: 'machine', measure: 'life', project: 'other', limitMs: 60_000, words: 'narrow' })).code,
        ).toBe('command-rule-thread');
        expect(
          (yield* refusal(first, {
            reach: 'thread',
            measure: 'life',
            thread: stranger,
            project: String(demo.projectId),
            limitMs: 60_000,
            words: 'wrong home',
          })).code,
        ).toBe('command-rule-thread');
        expect(
          (yield* refusal(first, { reach: 'project', measure: 'life', project: 'nowhere', limitMs: 60_000, words: 'no such' })).code,
        ).toBe('unknown-project');
        yield* remove(theirs.rule);
        expect(ids(yield* standingIn(otherProject, stranger))).not.toContain(theirs.rule.id);
      }),
    ),
  );

  it.effect('a write past the ceiling is refused, naming the ceiling', () =>
    withRules(({ first, written, refusal, standing }) =>
      Effect.gen(function* () {
        for (let count = 0; count < RULES_PER_LIST; count += 1)
          yield* written(first, { reach: 'thread', measure: 'life', limitMs: 60_000 + count, words: `rule ${count}` });
        expect((yield* refusal(first, { reach: 'thread', measure: 'life', limitMs: 30_000, words: 'one too many' })).code).toBe(
          'command-rule-ceiling',
        );
        expect((yield* standing(first)).length).toBe(RULES_PER_LIST);
      }),
    ),
  );

  it.effect("a thread's rules leave with the thread, and a project rule outlives the thread that wrote it", () =>
    withRules(({ demo, first, second, written, standing }) =>
      Effect.gen(function* () {
        const project = yield* written(second, { reach: 'project', measure: 'life', limitMs: 1_200_000, words: 'twenty minutes for all' });
        yield* written(second, { reach: 'thread', measure: 'life', limitMs: 300_000, words: 'five for this one' });
        yield* demo.graph.store.db.delete(threadRecord()).where(eq(threadRecord().id, second));
        expect(yield* standing(null)).toEqual([project.rule]);
        expect(project.rule.origin.writer).toBe(`thread:${second}`);
        expect(yield* demo.graph.store.db.select().from(commandRule()).where(eq(commandRule().threadId, second))).toEqual([]);
      }),
    ),
  );
});
