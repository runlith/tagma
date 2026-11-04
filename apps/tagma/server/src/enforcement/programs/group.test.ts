import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result } from 'effect';
import { ProgramInvocation, type ProgramAnswer } from '@tagma/inspection/program';
import { Schema } from 'effect';
import { ProgramRoad } from '../../executions/contract/service/programs.js';
import type { Checker } from './checker.js';
import { judgePrograms, type GroupSubject, type ProgramBinding } from './group.js';

const checker: Checker = {
  id: 'fixture',
  descriptor: { id: 'fixture', adapter: 'program', argv: ['checker'], layout: 'program' },
  launch: ['checker'],
  cwd: '/repo',
};
const subject: GroupSubject = {
  projectId: 1,
  root: '/repo',
  tree: 'built',
  base: 'base',
  caller: { _tag: 'Operator' },
  sides: [
    { side: 'tree', paths: ['a.ts'], files: [{ path: 'a.ts', text: 'built' }] },
    { side: 'base', paths: ['a.ts'], files: [{ path: 'a.ts', text: 'base' }] },
  ],
};
const binding: ProgramBinding = {
  rule: 'law',
  check: { key: 'check', program: { program: 'checker.ts', name: 'check', concern: 'code', needs: [], params: {} } },
  places: [''],
  debt: [],
  checker,
};
const finding = { fingerprint: 'f', path: 'a.ts', line: 1, message: 'm' };

const answerOf = (input: ProgramInvocation): ProgramAnswer => ({
  request: input.request,
  checker: input.checker,
  tree: input.tree,
  base: input.base,
  run: { tool: 'fixture', version: '1', capabilities: {} },
  readings: input.keys.flatMap((key) =>
    input.sides.map((side) => ({
      key: key.key,
      side: side.side,
      covered: ['a.ts'],
      unjudged: [],
      findings: side.side === 'tree' ? [finding] : [],
    })),
  ),
});

const run = (alter: (answer: ProgramAnswer) => unknown, debt: ProgramBinding['debt'] = [], judged: GroupSubject = subject) =>
  Effect.map(
    judgePrograms(judged, [{ ...binding, debt }]).pipe(
      Effect.provideService(ProgramRoad, {
        run: (launch) => {
          const input = Schema.decodeUnknownSync(ProgramInvocation)(JSON.parse(launch.stdin));
          return Effect.succeed({
            _tag: 'Exited' as const,
            exitCode: 0,
            stdout: JSON.stringify(alter(answerOf(input))),
            stderr: '',
            cut: false,
          });
        },
      }),
    ),
    (answers) => {
      const run = answers.get(checker.id)!;
      const failure = run.failures.get(binding.rule);
      return failure === undefined ? run.answer : Result.fail(failure);
    },
  );

const mutations: readonly [string, (answer: ProgramAnswer) => unknown][] = [
  ...(['contract', 'request', 'tree', 'base', 'checker'] as const).map((field): [string, (answer: ProgramAnswer) => unknown] => [
    field,
    (answer) => ({ ...answer, [field]: 'wrong' }),
  ]),
  ['missing', (answer) => ({ ...answer, readings: answer.readings.slice(1) })],
  ['duplicate', (answer) => ({ ...answer, readings: [...answer.readings, answer.readings[0]] })],
  ['unknown', (answer) => ({ ...answer, readings: answer.readings.map((one) => ({ ...one, key: 'unknown' })) })],
  ['coverage', (answer) => ({ ...answer, readings: answer.readings.map((one) => ({ ...one, covered: [] })) })],
  [
    'valued duplicate',
    (answer) => ({
      ...answer,
      readings: answer.readings.map((one) => ({
        ...one,
        findings: [
          { ...finding, value: 1 },
          { ...finding, value: 2 },
        ],
      })),
    }),
  ],
  [
    'unjudged',
    (answer) => ({
      ...answer,
      readings: answer.readings.map((one) => ({ ...one, unjudged: [{ file: 'a.ts', line: 1, specifier: 'suppressed' }] })),
    }),
  ],
];

for (const [name, alter] of mutations)
  it.effect(`a program answer refuses ${name} rather than accepting zero findings`, () =>
    Effect.gen(function* () {
      const result = yield* run(alter);
      expect(Result.isFailure(result) && result.failure.cause).toBe('program');
    }),
  );

const judged = (...input: Parameters<typeof run>) => Effect.flatMap(run(...input), Effect.fromResult);

it.effect('complete empty base coverage defeats debt and preserves the namespaced occurrence', () =>
  Effect.gen(function* () {
    const initial = yield* judged((one) => one);
    const fingerprint = initial[0]!.verdict.violations[0]!.fingerprint;
    const result = yield* judged((one) => one, [{ fingerprint, owner: 'task', count: 3 }]);
    expect(result[0]!.verdict.violations).toMatchObject([{ fingerprint, file: 'a.ts', line: 1 }]);
  }),
);

it.effect('a program finding whose value grew past its base or its debt is not new', () =>
  Effect.gen(function* () {
    const valued =
      (tree: number, base: number) =>
      (answer: ProgramAnswer): ProgramAnswer => ({
        ...answer,
        readings: answer.readings.map((one) => ({
          ...one,
          covered: { scope: 'reach' },
          findings: [{ ...finding, value: one.side === 'tree' ? tree : base }],
        })),
      });
    const grown = yield* judged(valued(6, 5));
    expect(grown[0]!.verdict.violations).toEqual([]);
    const whole: GroupSubject = {
      ...subject,
      sides: [
        { side: 'tree', paths: null, files: null },
        { side: 'base', paths: null, files: null },
      ],
    };
    const withoutBase = (answer: ProgramAnswer): ProgramAnswer => {
      const measured = valued(6, 0)(answer);
      return { ...measured, readings: measured.readings.map((one) => (one.side === 'base' ? { ...one, findings: [] } : one)) };
    };
    const initial = yield* judged((one) => one);
    const fingerprint = initial[0]!.verdict.violations[0]!.fingerprint;
    const indebted = yield* judged(withoutBase, [{ fingerprint, owner: 'task' }], whole);
    expect(indebted[0]!.verdict.violations).toEqual([]);
  }),
);
