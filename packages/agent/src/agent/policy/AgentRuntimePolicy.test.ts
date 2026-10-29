import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Tracer } from 'effect';
import { AgentRunState } from '../AgentRunState';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import {
  AgentRuntimePolicy,
  agentCallDirective,
  agentGuides,
  agentRule,
  agentStepToolPolicy,
  type AgentDirective,
  type AgentRuleContext,
  type AgentRuleOptions,
} from './AgentRuntimePolicy';
const rule = (
  id: string,
  evaluate: (ctx: AgentRuleContext) => Effect.Effect<AgentDirective | null, unknown> | AgentDirective | null,
  options: Partial<AgentRuleOptions> = {},
) => agentRule<unknown>(id, evaluate, { owner: 'test', ...options });
const facts = (run: AgentRunState) => ({ hook: 'beforeStep' as const, runId: 'run-1', run, modelMessages: [] });
const ids = (directives: readonly AgentDirective[]) => agentGuides(directives).map((directive) => directive.ruleId);
describe('AgentRuntimePolicy', () => {
  it.effect(
    'rule gates and cooldowns use deterministic invocation ordinals, including retries',
    Effect.fnUntraced(function* () {
      const run = new AgentRunState();
      const everySecond = new AgentRuntimePolicy([
        rule('every-second-guide', (ctx) => (ctx.everyNth(2) ? { type: 'guide', text: 'second' } : null)),
      ]);
      const at = (policy: AgentRuntimePolicy, ordinal: number) =>
        policy.evaluate({ ...facts(run), invocationKey: `step:${ordinal - 1}`, ordinal });
      expect(agentGuides(yield* at(everySecond, 1))).toEqual([]);
      expect(ids(yield* at(everySecond, 2))).toEqual(['every-second-guide']);
      const cooldown = new AgentRuntimePolicy([
        rule('cooldown-guide', (ctx) => (ctx.cooldown('run', 3) ? { type: 'guide', text: `ordinal:${ctx.run.stepNumber}` } : null)),
      ]);
      expect(ids(yield* at(cooldown, 1))).toEqual(['cooldown-guide']);
      expect(ids(yield* at(cooldown, 1))).toEqual(['cooldown-guide']);
      expect(agentGuides(yield* at(cooldown, 2))).toEqual([]);
      expect(agentGuides(yield* at(cooldown, 2))).toEqual([]);
      expect(agentGuides(yield* at(cooldown, 3))).toEqual([]);
      expect(ids(yield* at(cooldown, 4))).toEqual(['cooldown-guide']);
      const gate = () =>
        new AgentRuntimePolicy([rule('cooldown-guide', (ctx) => (ctx.cooldown('run', 2) ? { type: 'guide', text: 'now' } : null))]);
      const forward = gate();
      const firstThenSecond = [yield* at(forward, 1), yield* at(forward, 2)];
      const backward = gate();
      const secondThenFirst = [yield* at(backward, 2), yield* at(backward, 1)];
      expect(firstThenSecond.map((directives) => agentGuides(directives).length)).toEqual([1, 0]);
      expect(secondThenFirst.map((directives) => agentGuides(directives).length)).toEqual([0, 1]);
    }),
  );
  it.effect(
    'slow notes distinguish synchronous invocation from asynchronous waiting',
    Effect.fnUntraced(function* () {
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<null>();
      let nanos = 0n;
      const base = yield* Clock.Clock;
      const clock: Clock.Clock = {
        currentTimeMillis: base.currentTimeMillis,
        currentTimeMillisUnsafe: () => base.currentTimeMillisUnsafe(),
        currentTimeNanos: base.currentTimeNanos,
        currentTimeNanosUnsafe: () => base.currentTimeNanosUnsafe(),
        monotonicTimeNanos: Effect.sync(() => nanos),
        monotonicTimeNanosUnsafe: () => nanos,
        sleep: (duration) => base.sleep(duration),
      };
      const policy = new AgentRuntimePolicy([
        rule('waited', () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)))),
        rule('blocked', () => {
          nanos += 120_000_000n;
          return null;
        }),
      ]);
      const recording = activityRecording();
      const evaluating = yield* policy
        .evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 })
        .pipe(Effect.provideService(Clock.Clock, clock), Effect.provideService(ActivityLog, recording.log), Effect.forkScoped);
      yield* Deferred.await(entered);
      nanos += 150_000_000n;
      yield* Deferred.succeed(gate, null);
      yield* Fiber.join(evaluating);
      expect(recording.runNotes('run-1')).toEqual([
        { type: 'rule-slow', ruleId: 'waited', owner: 'test', hook: 'beforeStep', invokeMs: 0, settleMs: 150 },
        { type: 'rule-slow', ruleId: 'blocked', owner: 'test', hook: 'beforeStep', invokeMs: 120, settleMs: 0 },
      ]);
    }),
  );
  test('restrict directives intersect active tool sets', () => {
    expect(
      agentStepToolPolicy(
        [
          { type: 'restrict', tools: ['get_learner_context', 'search_learning_objects'] },
          { type: 'restrict', tools: ['search_learning_objects', 'get_learning_object_detail'] },
        ],
        ['get_learner_context', 'search_learning_objects', 'get_learning_object_detail', 'record_learning_result'],
      ).activeTools,
    ).toEqual(['search_learning_objects']);
  });
  test('a require re-arms against restrict and never against exclude', () => {
    const restricted = agentStepToolPolicy(
      [
        { type: 'restrict', tools: ['read_file'], ruleId: 'focus' },
        { type: 'require', tool: 'report', ruleId: 'sealing' },
      ],
      ['read_file', 'report', 'write_file'],
    );
    expect(restricted.activeTools).toEqual(['read_file', 'report']);
    expect(restricted.toolChoice).toEqual({ type: 'tool', toolName: 'report' });
    const locked = agentStepToolPolicy(
      [
        { type: 'exclude', tools: ['write_artifact'], ruleId: 'skills' },
        { type: 'require', tool: 'write_artifact', ruleId: 'sealing' },
      ],
      ['load_skill', 'write_artifact'],
    );
    expect(locked.activeTools).toEqual(['load_skill']);
    expect(locked.toolChoice).toBeNull();
  });
  test('a tool-less require forbids a text-only step whatever the rules narrowed', () => {
    const policy = agentStepToolPolicy([{ type: 'require', ruleId: 'sealing' }], ['report']);
    expect(policy.activeTools).toBeNull();
    expect(policy.toolChoice).toBe('required');
  });
  it.effect(
    'a requirement can publish guidance without weakening its forced tool choice',
    Effect.fnUntraced(function* () {
      const policy = new AgentRuntimePolicy([
        rule('requested-resource', () => ({ type: 'require', tool: 'load', text: 'Load the requested resource.' })),
      ]);
      const directives = yield* policy.evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 });
      expect(ids(directives)).toEqual(['requested-resource']);
      expect(agentStepToolPolicy(directives, ['load', 'write']).toolChoice).toEqual({ type: 'tool', toolName: 'load' });
    }),
  );
  it.effect(
    'a request preserves guidance and tool locks across declared choice modes',
    Effect.fnUntraced(function* () {
      const policy = new AgentRuntimePolicy([
        rule('load-request', () => ({ type: 'request', tool: 'load', text: 'Load the resource.' })),
        rule('focus', () => ({ type: 'restrict', tools: ['read'] })),
        rule('lock', () => ({ type: 'exclude', tools: ['write'] })),
      ]);
      const directives = yield* policy.evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 });
      expect(ids(directives)).toEqual(['load-request']);
      expect(agentStepToolPolicy(directives, ['load', 'read', 'write'], ['auto', 'none'])).toEqual({
        activeTools: ['read', 'load'],
        toolChoice: null,
      });
      expect(agentStepToolPolicy(directives, ['load', 'read', 'write'], ['auto', 'tool'])).toEqual({
        activeTools: ['read', 'load'],
        toolChoice: { type: 'tool', toolName: 'load' },
      });
      expect(
        agentStepToolPolicy([...directives, { type: 'exclude', tools: ['load'] }], ['load', 'read', 'write'], ['auto', 'tool']),
      ).toEqual({
        activeTools: ['read'],
        toolChoice: null,
      });
      expect(agentStepToolPolicy(directives, ['read', 'write'], ['auto', 'tool'])).toEqual({ activeTools: ['read'], toolChoice: null });
    }),
  );
  test('a soft request never replaces a hard requirement, even on an auto-only model', () => {
    expect(
      agentStepToolPolicy(
        [
          { type: 'request', tool: 'load', text: 'Load the resource.' },
          { type: 'require', tool: 'report' },
        ],
        ['load', 'report'],
        ['auto', 'none'],
      ).toolChoice,
    ).toEqual({ type: 'tool', toolName: 'report' });
  });
  it.effect(
    'a critical rule failure fails the evaluation instead of logging away',
    Effect.fnUntraced(function* () {
      const cause = new Error('gate broke');
      const policy = new AgentRuntimePolicy([
        rule(
          'capability-gate',
          () => {
            throw cause;
          },
          { critical: true },
        ),
      ]);
      const failed = yield* Effect.flip(policy.evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 }));
      expect(failed).toMatchObject({ _tag: 'AgentRuleFailed', ruleId: 'capability-gate', cause });
    }),
  );
  it.effect(
    'a non-critical rule failure is noted on the run as a typed note and skipped',
    Effect.fnUntraced(function* () {
      const policy = new AgentRuntimePolicy([
        rule('flaky-guide', () => {
          throw new Error('guide broke');
        }),
      ]);
      const recording = activityRecording();
      const directives = yield* policy
        .evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 })
        .pipe(Effect.provideService(ActivityLog, recording.log));
      expect(directives).toEqual([]);
      expect(recording.runNotes('run-1')).toEqual([
        { type: 'rule-failed', ruleId: 'flaky-guide', owner: 'test', hook: 'beforeStep', message: expect.any(String) },
      ]);
    }),
  );
  it.effect(
    'rules run by priority, then in the order they were given, and only at the hook they name',
    Effect.fnUntraced(function* () {
      const guide = (id: string) => () => ({ type: 'guide' as const, text: id });
      const policy = new AgentRuntimePolicy([
        rule('late', guide('late'), { priority: 10 }),
        rule('first', guide('first')),
        rule('second', guide('second')),
        rule('after-tool', guide('after-tool'), { hook: 'afterTool' }),
        rule('early', guide('early'), { priority: -1 }),
      ]);
      const directives = yield* policy.evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 });
      expect(directives.map((directive) => directive.ruleId)).toEqual(['early', 'first', 'second', 'late']);
    }),
  );
  it.effect(
    'a cancelled evaluation stops at its rule and finishes its resource release before ending',
    Effect.fnUntraced(function* () {
      const entered = yield* Deferred.make<void>();
      let after = 0;
      let released = false;
      const policy = new AgentRuntimePolicy([
        rule('held', () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                released = true;
              }),
            ),
          ),
        ),
        rule('after', () => {
          after += 1;
          return null;
        }),
      ]);
      const evaluating = yield* Effect.forkScoped(policy.evaluate({ ...facts(new AgentRunState()), invocationKey: 'step:0', ordinal: 1 }));
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(evaluating);
      const exit = yield* Fiber.await(evaluating);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(after).toBe(0);
      expect(released).toBe(true);
    }),
  );
  it.effect.each(['beforeStep', 'afterTool'] as const)(
    'effect rules inherit the %s tracer and parent span',
    Effect.fnUntraced(function* (hook) {
      const spans: Tracer.Span[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const policy = new AgentRuntimePolicy([
        rule('law', () => Effect.succeed({ type: 'restrict' as const, tools: ['read'] }).pipe(Effect.withSpan('law.read'))),
      ]);
      const result = yield* policy
        .evaluate({ ...facts(new AgentRunState()), hook, invocationKey: hook, ordinal: 1 })
        .pipe(Effect.withSpan('hook'), Effect.withTracer(tracer));
      expect(result).toEqual([{ type: 'restrict', tools: ['read'], ruleId: 'law' }]);
      const parent = spans.find((span) => span.name === 'hook')!;
      const child = spans.find((span) => span.name === 'law.read')!;
      expect(Option.getOrThrow(child.parent).spanId).toBe(parent.spanId);
      expect(child.traceId).toBe(parent.traceId);
    }),
  );
  it.effect.each([Effect.fail(new Error('unavailable')), Effect.die(new Error('unavailable'))])(
    'critical effect failure remains a rule failure',
    Effect.fnUntraced(function* (failure) {
      const policy = new AgentRuntimePolicy([rule('law', () => failure, { critical: true })]);
      expect(yield* Effect.flip(policy.evaluate({ ...facts(new AgentRunState()), invocationKey: 'step', ordinal: 1 }))).toMatchObject({
        _tag: 'AgentRuleFailed',
        ruleId: 'law',
      });
    }),
  );
  test('exclude directives subtract without naming the rest of the catalog', () => {
    expect(
      agentStepToolPolicy(
        [{ type: 'exclude', tools: ['save_lexeme', 'save_artifact'] }],
        ['load_skill', 'web_search', 'save_lexeme', 'save_artifact', 'spawn_agent'],
      ).activeTools,
    ).toEqual(['load_skill', 'web_search', 'spawn_agent']);
    expect(agentStepToolPolicy([], ['load_skill']).activeTools).toBeNull();
  });
});
describe('directives resolve by the published precedence exclude > require > request > restrict, whatever order they arrive in', () => {
  const catalog = ['a', 'b', 'c'];
  const pairs: readonly [string, AgentDirective, AgentDirective, ReturnType<typeof agentStepToolPolicy>][] = [
    [
      'exclude over require',
      { type: 'exclude', tools: ['a'] },
      { type: 'require', tool: 'a' },
      { activeTools: ['b', 'c'], toolChoice: null },
    ],
    [
      'exclude over request',
      { type: 'exclude', tools: ['a'] },
      { type: 'request', tool: 'a', text: 'use a' },
      { activeTools: ['b', 'c'], toolChoice: null },
    ],
    [
      'exclude over restrict',
      { type: 'exclude', tools: ['a'] },
      { type: 'restrict', tools: ['a', 'b'] },
      { activeTools: ['b'], toolChoice: null },
    ],
    [
      'require over request',
      { type: 'require', tool: 'a' },
      { type: 'request', tool: 'b', text: 'use b' },
      { activeTools: null, toolChoice: { type: 'tool', toolName: 'a' } },
    ],
    [
      'require over restrict',
      { type: 'require', tool: 'a' },
      { type: 'restrict', tools: ['b'] },
      { activeTools: ['b', 'a'], toolChoice: { type: 'tool', toolName: 'a' } },
    ],
    [
      'request over restrict',
      { type: 'request', tool: 'a', text: 'use a' },
      { type: 'restrict', tools: ['b'] },
      { activeTools: ['b', 'a'], toolChoice: { type: 'tool', toolName: 'a' } },
    ],
  ];
  test.each(pairs)('%s', (_name, stronger, weaker, resolved) => {
    expect(agentStepToolPolicy([stronger, weaker], catalog)).toEqual(resolved);
    expect(agentStepToolPolicy([weaker, stronger], catalog)).toEqual(resolved);
  });
  test('deny over rewrite, and the first rewrite over a later one', () => {
    const deny: AgentDirective = { type: 'deny', reason: 'blocked' };
    const first: AgentDirective = { type: 'rewrite', input: { a: 1 } };
    const second: AgentDirective = { type: 'rewrite', input: { a: 2 } };
    expect(agentCallDirective([first, deny])).toBe(deny);
    expect(agentCallDirective([deny, first])).toBe(deny);
    expect(agentCallDirective([first, second])).toBe(first);
  });
});
