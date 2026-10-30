import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { ProgramInvocation, type ProgramAnswer } from '@tagma/inspection/program';
import { ProgramRoad } from '../executions/contract/service/programs.js';
import { Git } from '@runlith/git/Git';
import { Inspections } from './workers/inspectionLanes.js';
import { headChecked } from './testing/wiring.js';

const unused = () => Effect.die('a program check over HEAD reads neither git nor builtin inspections');

it.effect('a rule reports its checker run, shared in full by its keys, including a failed run', () =>
  Effect.gen(function* () {
    const checked = yield* headChecked(
      { projectId: 1, caller: { _tag: 'Operator' }, rules: 'all' },
      {
        targets: [
          ['first', 'shared.ts'],
          ['second', 'shared.ts'],
          ['third', 'other.ts'],
          ['fourth', 'broken.ts'],
        ].map(([name, program]) => ({
          name: name!,
          title: name!,
          body: '',
          said: { rule: name! },
          gatesLanding: false,
          places: [''],
          debt: [],
          inspection: {
            key: name!,
            program: { program: program!, name: 'check', concern: 'code', needs: [], params: {} },
          },
        })),
      },
      { root: '/repo', head: 'head' },
    ).pipe(
      Effect.provideService(Git, Git.of({ run: unused })),
      Effect.provideService(Inspections, Inspections.of({ reach: unused, judge: unused, packs: unused, facts: unused, history: unused })),
      Effect.provideService(
        ProgramRoad,
        ProgramRoad.of({
          run: Effect.fnUntraced(function* (launch) {
            const input = yield* Schema.decodeUnknownEffect(ProgramInvocation)(JSON.parse(launch.stdin)).pipe(Effect.orDie);
            const ms = input.checker === 'shared.ts' ? 200 : input.checker === 'other.ts' ? 400 : 600;
            yield* TestClock.adjust(ms);
            const answer: ProgramAnswer = {
              request: input.request,
              checker: input.checker,
              tree: input.tree,
              base: input.base,
              run: { tool: 'fixture', version: '1', capabilities: {} },
              readings: input.keys.map((key) => ({
                key: key.key,
                side: 'tree',
                covered: { scope: 'reach' },
                unjudged: [],
                findings: [],
              })),
            };
            return {
              _tag: 'Exited',
              exitCode: input.checker === 'broken.ts' ? 1 : 0,
              stdout: JSON.stringify(answer),
              stderr: '',
              cut: false,
            };
          }),
        }),
      ),
    );
    expect(checked.rules.map(({ rule, ms }) => [rule, ms])).toEqual([
      ['first', 200],
      ['second', 200],
      ['third', 400],
      ['fourth', 600],
    ]);
    expect(checked.rules[3]!.failed).toContain('checker exited 1');
  }),
);
