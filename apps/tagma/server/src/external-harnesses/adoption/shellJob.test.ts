import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { it } from '@runlith/effect-test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { ProcessReport, ProcessSnapshot, ProcessWitness } from '@runlith/executions/protocol/evidence';
import { ForegroundRefusal, type ForegroundAnswer } from '@runlith/executions/protocol/terminal';
import { jobState, jobUnder } from './shellJob.js';

const execution = { installation: InstallationId.make('shell-job'), execution: ExecutionId.make('shell-1'), incarnation: 1 };
const here = { _tag: 'Local', machine: 'this-mac' } as const;
const scope = { host: here, network: here };
const source = { adapter: 'darwin', probe: 'ps' };
const birth = '1:123';
const witness = (pid = 200): ProcessWitness => ({ pid, birth });
const foreground = (pid = 200): ForegroundAnswer => ({ _tag: 'Foreground', process: witness(pid) });

const row = (pid: number, parent: number, state: string, relation: 'leader' | 'terminal' | null, work = pid): ProcessSnapshot => ({
  scope,
  source,
  observedAt: 1,
  completeness: 'complete',
  unmeasured: [],
  identity: witness(pid),
  parent,
  work,
  state,
  association: relation === null ? undefined : { execution, relation, identity: relation === 'leader' ? 'same' : 'unknown' },
});

const reading = (processes: readonly ProcessSnapshot[], completeness: ProcessReport['completeness'] = 'complete'): ProcessReport => ({
  scope,
  source,
  observedAt: 1,
  completeness,
  unmeasured: [],
  revision: 1,
  subject: { _tag: 'Execution', execution },
  processes,
});

const shell = row(100, 1, 'Ss', 'leader');
const cli = row(200, 100, 'S', 'terminal');
const hook = row(300, 200, 'S+', 'terminal', 200);
const under = (report: ProcessReport | undefined, ancestry: readonly number[], namespace = here, answer = foreground()) =>
  jobUnder(report, ancestry, namespace, answer);
const state = (report: ProcessReport | undefined, pid = 200, answer = foreground()) =>
  jobState(report, witness(pid), Effect.succeed(answer));

test('adoption follows the host foreground witness through the caller ancestry', () => {
  expect(under(reading([shell, cli, hook]), [300, 200, 100, 1])).toEqual({ _tag: 'Job', witness: witness() });
  expect(under(reading([shell, cli, hook]), [200, 100])).toEqual({ _tag: 'Job', witness: witness() });
  const nested = row(150, 100, 'S+', 'terminal');
  const inner = row(200, 150, 'S', 'terminal');
  expect(under(reading([shell, nested, inner, hook]), [300, 200, 150, 100])).toEqual({ _tag: 'Job', witness: witness() });
});

test('every ancestry link must descend from the proven shell in the same namespace', () => {
  expect(under(reading([shell, cli]), [300, 200, 100])._tag).toBe('NotUnder');
  expect(under(reading([shell, cli, row(300, 999, 'S+', 'terminal', 200)]), [300, 200, 100])._tag).toBe('NotUnder');
  expect(under(reading([shell, cli]), [900, 800, 1])._tag).toBe('NotUnder');
  expect(under(reading([shell, cli]), [100, 1])._tag).toBe('NotUnder');
  expect(jobUnder(reading([shell, cli]), [200, 100], { _tag: 'Local', machine: 'another-mac' }, foreground())._tag).toBe('NotUnder');
});

it.effect('an incomplete reading or absent foreground capability cannot prove adoption', () =>
  Effect.gen(function* () {
    expect(under(reading([shell, cli], 'partial'), [200, 100])._tag).toBe('Unread');
    expect(under(reading([row(100, 1, 'Ss', 'terminal'), cli]), [200, 100])._tag).toBe('Unread');
    expect(under(undefined, [200, 100])._tag).toBe('Unread');
    const unsupported = ForegroundRefusal.make({ reason: 'unsupported', detail: 'the adapter does not serve foreground' });
    expect(under(reading([shell, cli]), [200, 100], here, unsupported)).toEqual({ _tag: 'Unread', reason: unsupported.detail });
    expect(yield* state(reading([shell, cli]), 200, unsupported)).toBe('unread');
  }),
);

it.effect('foreground is the host answer even when process-state flags disagree', () =>
  Effect.gen(function* () {
    expect(yield* state(reading([shell, cli]))).toBe('foreground');
    expect(yield* state(reading([shell, row(200, 100, 'S+', 'terminal')]), 200, foreground(100))).toBe('background');
    expect(yield* state(reading([shell]))).toBe('gone');
    expect(yield* state(reading([shell, cli], 'partial'))).toBe('unread');
    expect(under(reading([shell, cli, hook]), [300, 200, 100], here, foreground(100))._tag).toBe('NotUnder');
  }),
);

it.effect('an absent birth witness cannot prove the adopted job', () =>
  Effect.gen(function* () {
    const unread = { ...cli, identity: { pid: 200 } };
    expect(under(reading([shell, unread]), [200, 100])._tag).toBe('Unread');
    expect(yield* state(reading([shell, unread]))).toBe('unread');
  }),
);

it.effect('a complete process reading proves departure despite a refused foreground read', () =>
  Effect.gen(function* () {
    const refused = ForegroundRefusal.make({ reason: 'unreadable', detail: 'the terminal foreground could not be read' });
    expect(yield* state(reading([shell]), 200, refused)).toBe('gone');
    expect(yield* state(reading([shell, cli]), 200, refused)).toBe('unread');
    expect(yield* jobState(reading([shell]), witness(), Effect.fail(new Error('the foreground transport failed')))).toBe('gone');
  }),
);

it.effect('a replacement pid ends the adopted job even when the replacement holds foreground', () =>
  Effect.gen(function* () {
    const replacement = { ...cli, identity: { pid: 200, birth: '2:123' } };
    const current: ForegroundAnswer = { _tag: 'Foreground', process: replacement.identity };
    expect(yield* state(reading([shell, replacement]), 200, current)).toBe('gone');
    expect(yield* state(reading([shell, cli]), 200, current)).toBe('gone');
    expect(under(reading([shell, replacement, hook]), [300, 200, 100])._tag).toBe('NotUnder');
  }),
);
