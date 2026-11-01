import { expect, test } from 'vitest';
import { NO_WORK, observe, type WorkInput, type WorkMemory, type WorkPhase } from './workLine.js';

const input = (phase: WorkPhase | null, ...calls: readonly [string, string?][]): WorkInput => ({
  phase,
  since: null,
  calls: calls.map(([name, title], index) => ({ id: `call-${index}`, name, title: title ?? null, since: 0 })),
  queued: 0,
});

function run(steps: readonly (readonly [number, WorkInput])[]): WorkMemory {
  return steps.reduce((memory, [at, next]) => observe(memory, next, at), NO_WORK);
}

test('an open call outranks the phase, and with no call the phase stands with the last call as its trail', () => {
  const calling = run([[0, input('tools', ['edit', 'edit ThreadRow.svelte'])]]);
  expect(calling.shown?.view).toMatchObject({ kind: 'call', label: 'edit ThreadRow.svelte', more: 0 });
  const together = run([[0, input('tools', ['read', 'read a.ts'], ['bash', 'bun test'])]]);
  expect(together.shown?.view).toMatchObject({ kind: 'call', label: 'read a.ts', more: 1 });

  const thinking = observe(calling, input('reasoning'), 1_500);
  expect(thinking.shown?.view).toEqual({
    kind: 'phase',
    phase: 'thinking',
    after: { kind: 'call', label: 'edit ThreadRow.svelte', more: 0, elapsedMs: null, queued: 0 },
    queued: 0,
    elapsedMs: null,
  });
});

test('a call waiting its turn does not hide what the model does meanwhile; with the model idle the queue is the line', () => {
  expect(run([[0, { ...input('reasoning'), queued: 1 }]]).shown?.text).toBe('thinking… · 1 queued');
  expect(run([[0, { ...input('writing'), queued: 2 }]]).shown?.view).toMatchObject({ kind: 'phase', phase: 'writing', queued: 2 });
  expect(run([[0, { ...input('tools'), queued: 1 }]]).shown?.text).toBe('1 queued');
});

test('before any call, a working row still shows its phase, and a tools phase with no call falls back to the last one', () => {
  for (const phase of ['reasoning', 'calling', 'preparing'] as const) {
    expect(run([[0, input(phase)]]).shown?.view).toMatchObject({ kind: 'phase', phase: 'thinking', after: null });
  }
  expect(run([[0, input('tools')]]).shown).toBeNull();

  const after = run([
    [0, input('tools', ['read', 'read a.ts'])],
    [1_200, input('tools')],
  ]);
  expect(after.shown?.view).toMatchObject({ kind: 'call', label: 'read a.ts' });
});

test('what the line shows stands for the dwell, then gives way — and nothing ever blanks it', () => {
  const shown = run([[0, input('tools', ['edit', 'edit a.ts'])]]);
  const closed = observe(shown, input('reasoning'), 200);
  expect(closed.shown).toBe(shown.shown);

  const given = observe(closed, input('reasoning'), 1_000);
  expect(given.shown?.view.kind).toBe('phase');
  expect(given.shown?.at).toBe(1_000);

  const quiet = run([[0, input('reasoning')]]);
  expect(observe(quiet, input(null), 3_000).shown).toBe(quiet.shown);
});

test('calls seen within the dwell fold by name, and the burst becomes the trail once the calls stop', () => {
  const steps: (readonly [number, WorkInput])[] = [];
  for (let index = 0; index < 6; index += 1) {
    steps.push([index * 150, input('tools', ['read', `read ${index}.ts`])], [index * 150 + 100, input('tools')]);
  }
  steps.push([900, input('tools', ['grep', 'grep x'])]);
  const burst = run([...steps, [1_000, input('tools', ['grep', 'grep x'])]]);
  expect(burst.shown?.view).toEqual({
    kind: 'burst',
    calls: [
      { name: 'read', count: 6 },
      { name: 'grep', count: 1 },
    ],
  });

  const trailing = observe(burst, input('reasoning'), 2_100);
  expect(trailing.shown?.view).toMatchObject({
    kind: 'phase',
    phase: 'thinking',
    after: {
      kind: 'burst',
      calls: [
        { name: 'read', count: 6 },
        { name: 'grep', count: 1 },
      ],
    },
  });
});

test('a call that ran long and ended does not fold into a burst with the next one', () => {
  const test = input('tools', ['bash', 'bun test']);
  const next = run([
    [0, test],
    [6_000, test],
    [12_000, test],
    [13_000, input('tools', ['read', 'read a.ts'])],
  ]);
  expect(next.shown?.view).toMatchObject({ kind: 'call', label: 'read a.ts' });
});

test('the trail holds a whole burst, however long it ran, as long as no gap in it reached the dwell', () => {
  const steps: (readonly [number, WorkInput])[] = [];
  for (let index = 0; index < 8; index += 1) {
    steps.push([index * 400, input('tools', ['read', `read ${index}.ts`])], [index * 400 + 100, input('tools')]);
  }
  const trailing = run([[-3_000, input('tools', ['edit', 'edit a.ts'])], ...steps, [5_000, input('reasoning')]]);
  expect(trailing.shown?.view).toMatchObject({ kind: 'phase', after: { kind: 'burst', calls: [{ name: 'read', count: 8 }] } });
});

test('an open call past five seconds carries its time from the instant the server dated it, however late this page first saw it', () => {
  const test = input('tools', ['bash', 'bun test']);
  const early = run([
    [0, test],
    [4_000, test],
  ]);
  expect(early.shown?.view).toMatchObject({ kind: 'call', elapsedMs: null });

  const late = observe(early, test, 12_000);
  expect(late.shown?.view).toMatchObject({ kind: 'call', label: 'bun test', elapsedMs: 12_000 });
  expect(observe(late, test, 80_000).shown?.view).toMatchObject({ elapsedMs: 80_000 });

  const reloaded: WorkInput = { ...test, calls: test.calls.map((call) => ({ ...call, since: 500 })) };
  expect(run([[45_500, reloaded]]).shown?.view).toMatchObject({ kind: 'call', label: 'bun test', elapsedMs: 45_000 });
});

test('the line says what runs, who runs beside it and how much waits; a call nobody dated carries no time', () => {
  const calls = [
    { id: 'call-1', name: 'bash', title: 'bun test', since: 0 },
    { id: 'call-2', name: 'read', title: 'a.ts', since: 0 },
  ];
  const dated = run([[30_000, { ...input('tools'), calls, queued: 2 }]]);
  expect(dated.shown?.text).toBe('bun test · +1 · 2 queued');
  expect(dated.shown?.elapsed).toBe('30s');

  const undated = run([[30_000, { ...input('tools'), calls: [{ id: 'call-1', name: 'bash', title: null, since: null }], queued: 0 }]]);
  expect(undated.shown?.text).toBe('bash');

  expect(run([[0, { ...input('tools'), queued: 3 }]]).shown?.text).toBe('3 queued');
});

test('thinking past twenty seconds carries its time from the instant the server dated the spell, however late this page first saw it', () => {
  const spell = (phase: WorkPhase): WorkInput => ({ ...input(phase), since: 500 });
  const thought = run([
    [0, input('tools', ['edit', 'edit a.ts'])],
    [8_000, spell('calling')],
    [20_000, spell('reasoning')],
  ]);
  expect(thought.shown?.view).toMatchObject({ kind: 'phase', phase: 'thinking', elapsedMs: null });

  const long = observe(thought, spell('preparing'), 45_500);
  expect(long.shown?.view).toMatchObject({
    kind: 'phase',
    phase: 'thinking',
    after: { kind: 'call', label: 'edit a.ts' },
    elapsedMs: 45_000,
  });

  expect(run([[45_500, spell('reasoning')]]).shown?.view).toMatchObject({ kind: 'phase', phase: 'thinking', elapsedMs: 45_000 });
});
