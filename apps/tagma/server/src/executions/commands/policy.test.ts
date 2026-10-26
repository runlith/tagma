import { expect, test } from 'bun:test';
import type { CommandRule, RuleMeasure } from '../contract/wire/commandRules.js';
import { resolveCommandPolicy } from './policy.js';
import { resolveCommandTime } from './ruleResolution.js';

const thread = 'thread-1';

const fiveMinutes: CommandRule = {
  id: 'r1',
  project: 5,
  thread,
  through: 'bash',
  program: null,
  measure: 'life',
  limitMs: 300_000,
  origin: { writer: 'tagma:thread-1', at: '2026-09-23T00:00:00.000Z', words: 'bash gets five minutes' },
};

const under = (rules: readonly CommandRule[]) => ({ rules });

const decided = (rules: readonly CommandRule[], measure: RuleMeasure, requested?: number) => {
  const time = resolveCommandTime({ rules, thread, tool: 'bash', measure, requested });
  return [time.limitMs, time.origin, time.rule?.id ?? null];
};

test('with no rule a call takes the default of each measure, and what it asks only up to that measure’s ceiling', () => {
  expect(decided([], 'wait')).toEqual([120_000, 'default', null]);
  expect(decided([], 'life')).toEqual([3_600_000, 'default', null]);
  expect(decided([], 'wait', 30_000)).toEqual([30_000, 'caller', null]);
  expect(decided([], 'wait', 3_600_000)).toEqual([600_000, 'caller', null]);
  expect(decided([], 'life', 24 * 3_600_000)).toEqual([21_600_000, 'caller', null]);
});

test('a rule decides only its own measure, lowers what a call asks above it and replaces the default, never raising a lower ask', () => {
  const wait: CommandRule = { ...fiveMinutes, id: 'wait', measure: 'wait', limitMs: 60_000 };
  expect(decided([wait], 'wait')).toEqual([60_000, 'rule', 'wait']);
  expect(decided([wait], 'life')).toEqual([3_600_000, 'default', null]);
  expect(decided([wait], 'wait', 120_000)).toEqual([60_000, 'rule', 'wait']);
  expect(decided([wait], 'wait', 30_000)).toEqual([30_000, 'caller', 'wait']);
  expect(decided([fiveMinutes], 'life', 600_000)).toEqual([300_000, 'rule', 'r1']);
  expect(decided([fiveMinutes], 'life', 60_000)).toEqual([60_000, 'caller', 'r1']);
});

test('inside one list the last matching rule of a measure decides, and across the machine, project and thread lists the tightest binds', () => {
  for (const measure of ['wait', 'life'] as const) {
    const of = (id: string, project: number | null, at: string | null, limitMs: number): CommandRule => ({
      ...fiveMinutes,
      id,
      project,
      thread: at,
      through: null,
      measure,
      limitMs,
    });
    const machine = of('machine', null, null, 60_000);
    const project = of('project', 5, null, 120_000);
    const looser = of('looser', 5, thread, 90_000);
    const tighter = of('tighter', 5, thread, 30_000);
    expect(decided([machine, project, looser], measure)[2]).toBe('machine');
    expect(decided([project, looser], measure)[2]).toBe('looser');
    expect(decided([machine, project, looser, tighter], measure)[2]).toBe('tighter');
    expect(decided([machine, project, tighter, looser], measure)[2]).toBe('machine');
    expect(decided([machine, of('machine-later', null, null, 300_000), project], measure)[2]).toBe('project');
  }
});

test('the admission resolves the life alone: a wait rule never bounds it, and the ceiling of a revision is the rule’s or the life ceiling', () => {
  const wait: CommandRule = { ...fiveMinutes, id: 'wait', measure: 'wait', limitMs: 60_000 };
  expect(resolveCommandPolicy(under([wait]), { thread, tool: 'bash', requested: undefined }).limits).toEqual({
    executionMs: 3_600_000,
    executionCeilingMs: 21_600_000,
    origin: 'default',
  });
  expect(resolveCommandPolicy(under([fiveMinutes]), { thread, tool: 'bash', requested: 60_000 }).limits).toEqual({
    executionMs: 60_000,
    executionCeilingMs: 300_000,
    origin: 'caller',
  });
  const anyTool: CommandRule = { ...fiveMinutes, id: 'r2', through: null };
  expect(resolveCommandPolicy(under([anyTool]), { thread, tool: 'submit_work', requested: undefined }).limits.origin).toBe('default');
});

test("program rules are copied in the order the host decides them — the machine's, the project's, the thread's — each machine rule marked", () => {
  const program = { words: ['bun', 'test'] as [string, ...string[]] };
  const own: CommandRule = { ...fiveMinutes, id: 'own', program };
  const machine: CommandRule = { ...fiveMinutes, id: 'machine', project: null, thread: null, program };
  const project: CommandRule = { ...fiveMinutes, id: 'project', thread: null, program };
  const copies = resolveCommandPolicy(under([own, project, machine]), { thread, tool: 'bash', requested: undefined }).time.programs?.rules;
  expect(copies?.map((copy) => [copy.id, copy.machine === true, copy.thread])).toEqual([
    ['machine', true, undefined],
    ['project', false, undefined],
    ['own', false, thread],
  ]);
});

test('the policy identity moves with the rules, never with the time a caller asked for', () => {
  const identity = (rules: readonly CommandRule[], requested: number | undefined) =>
    resolveCommandPolicy(under(rules), { thread, tool: 'bash', requested }).policyIdentity;

  expect(identity([], 60_000)).toBe(identity([], undefined));
  expect(identity([fiveMinutes], undefined)).not.toBe(identity([], undefined));
  expect(identity([{ ...fiveMinutes, measure: 'wait' }], undefined)).not.toBe(identity([fiveMinutes], undefined));
});
