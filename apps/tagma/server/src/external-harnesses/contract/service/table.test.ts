import { expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import { it } from '@runlith/effect-test';
import { sessionName } from '../../../platform/contract/wire/session.js';
import { harnessArgv } from './table.js';
import { sessionIdentity } from '../../sessionPrefix.js';
import { harnessHookSchema } from '../../../threads/contract/wire/harness/observation.js';
import { SESSION_SIGNERS } from '../wire/sessionVariables.js';
import { terminalCapabilities } from '../../birth/seat.js';
import { BUILTIN_HARNESSES } from '../../vendors/builtin.js';
import { builtinHarness } from '../../testing/builtin.js';

const launchOf = (name: string) => builtinHarness(name).launch!;

test('the session signers the CLI reads without loading the rows are every row that publishes its session, in row order', () => {
  const signers: readonly { readonly harness: string; readonly variable: string }[] = SESSION_SIGNERS;
  expect(signers).toEqual(BUILTIN_HARNESSES.flatMap(({ harness, variable }) => (variable === undefined ? [] : [{ harness, variable }])));
});

test('terminal copy fidelity names the vendor only on the sides that have a vendor cut', () => {
  const copies = Object.fromEntries(BUILTIN_HARNESSES.map((row) => [row.harness, terminalCapabilities(row, false).copies]));
  expect(copies).toEqual({
    'claude-code': { whole: 'vendor', point: 'vendor' },
    codex: { whole: 'vendor', point: 'vendor' },
    devin: { whole: 'record', point: 'record' },
    cursor: { whole: 'record', point: 'record' },
    gemini: { whole: 'record', point: 'record' },
    opencode: { whole: 'record', point: 'record' },
  });
});

test('a foreign session is named by its row prefix', () => {
  expect(sessionName({ harness: 'devin', key: '5f1c2b7a-0e44-4c19-9a3d-8b6512ef0011' }, sessionIdentity)).toBe('dv:12ef0011');
});

test('a row names the call its own event asks about', () => {
  expect(builtinHarness('claude-code').subjectOf({ tool_name: 'Bash', tool_input: { command: 'ls' } })).toEqual({
    id: null,
    tool: 'Bash',
    subject: 'ls',
  });
  expect(builtinHarness('devin').subjectOf({ tool_name: 'MultiEdit', tool_input: { file_path: '/repo/a.ts' } })?.tool).toBe('edit');
  expect(builtinHarness('claude-code').subjectOf({ tool_name: 'Nope', tool_input: {} })).toEqual({ id: null, tool: 'Nope', subject: '{}' });
});

test('hook schema admits the row vocabulary and strips the unknown', () => {
  const keys = [...BUILTIN_HARNESSES.flatMap((row) => row.eventKeys), 'agent_id', 'source', 'transcript_path', 'error'];
  const event = Object.fromEntries(keys.map((key) => [key, 'v']));
  const decoded = Schema.decodeUnknownSync(harnessHookSchema)({ ...event, bogus: 'x' });
  for (const key of Object.keys(event)) expect(decoded).toHaveProperty(key);
  expect(decoded).not.toHaveProperty('bogus');
});

test('declared start, prompt and ending occasions classify to the timer contract', () => {
  for (const row of BUILTIN_HARNESSES) {
    const events = row.hooks?.events;
    if (events === undefined) continue;
    if (events.sessionStart !== null) expect(row.occasionOf({ name: events.sessionStart })).toBe('session-start');
    if (events.prompt !== undefined) expect(row.occasionOf({ name: events.prompt })).toBe('turn-start');
    if (events.stop !== null) expect(row.occasionOf({ name: events.stop })).toBe('turn-end');
    if (events.sessionEnd !== undefined) expect(row.occasionOf({ name: events.sessionEnd })).toBe('turn-end');
  }
});

test('permission gates prove presence; question tools wait the clock', () => {
  for (const name of ['claude-code', 'codex', 'devin', 'cursor'] as const) {
    const row = builtinHarness(name);
    expect(row.occasionOf({ name: row.hooks!.events.permission! })).toBe('self-description');
  }
  for (const name of ['claude-code', 'codex', 'devin', 'cursor'] as const) {
    const row = builtinHarness(name);
    expect(row.occasionOf({ name: row.hooks!.events.preWrite!, tool: 'AskUserQuestion' })).toBe('wait');
  }
});

test('every launch shape carries the row permission stance', () => {
  const measured = {
    'claude-code': ['--dangerously-skip-permissions'],
    codex: ['--dangerously-bypass-approvals-and-sandbox'],
    devin: ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false'],
    cursor: ['--force'],
    gemini: ['--approval-mode', 'yolo'],
  } as const;
  for (const name of Object.keys(measured) as (keyof typeof measured)[]) {
    const row = builtinHarness(name);
    const launch = row.launch!;
    const permission = measured[name];
    expect(launch.permission.tagma).toEqual(permission);
    const launches = [
      launch.interactive('do it'),
      launch.resume('session-7', 'do it'),
      ...(launch.assign === undefined ? [] : [launch.assign('fresh-9', 'do it')]),
    ];
    for (const argv of launches) {
      expect(argv.slice(0, permission.length + 1)).toEqual([row.binary, ...permission]);
    }
  }

  const cursor = launchOf('cursor');
  expect(cursor.root(cursor.assign!('fresh-9'))).toBe('fresh-9');
  const devin = launchOf('devin');
  expect(devin.interactive('do it')).toEqual([
    'devin',
    '--permission-mode',
    'dangerous',
    '--respect-workspace-trust',
    'false',
    '--',
    'do it',
  ]);
});

test('a chosen pair is spelled by its own row, ahead of the word that names the root', () => {
  const claudeCode = launchOf('claude-code');
  expect(claudeCode.resume('root-1', 'go', { model: 'claude-opus-5', rung: 'high' })).toEqual([
    'claude',
    '--dangerously-skip-permissions',
    '--model',
    'claude-opus-5',
    '--effort',
    'high',
    '--resume',
    'root-1',
    '--',
    'go',
  ]);
  const codex = launchOf('codex');
  expect(codex.resume('root-2', undefined, { model: 'gpt-5.6-sol', rung: 'high' })).toEqual([
    'codex',
    '--dangerously-bypass-approvals-and-sandbox',
    '-c',
    'model_reasoning_effort=high',
    '-m',
    'gpt-5.6-sol',
    '-c',
    'tui.resume_cwd=current',
    'resume',
    'root-2',
  ]);
  const devin = launchOf('devin');
  expect(devin.interactive('go', { model: 'gpt-5-6-sol-high', rung: null })).toEqual([
    'devin',
    '--permission-mode',
    'dangerous',
    '--respect-workspace-trust',
    'false',
    '--model',
    'gpt-5-6-sol-high',
    '--',
    'go',
  ]);

  expect(claudeCode.root(claudeCode.resume('root-1', 'go', { model: 'claude-opus-5', rung: 'high' }))).toBe('root-1');
  expect(codex.root(codex.resume('root-2', undefined, { model: 'gpt-5.6-sol', rung: 'max' }))).toBe('root-2');
  expect(devin.root(devin.resume('root-3', 'go', { model: 'claude-opus-5-xhigh', rung: null }))).toBe('root-3');
});

it.effect('every launch shape is rebuilt from the pinned pair, the resume included', () =>
  Effect.gen(function* () {
    const chosen = { model: 'claude-opus-5', rung: 'high' } as const;
    expect(yield* harnessArgv(builtinHarness('claude-code'), 'root-7', 'execution-7', 'go', chosen)).toEqual([
      'claude',
      '--dangerously-skip-permissions',
      '--model',
      'claude-opus-5',
      '--effort',
      'high',
      '--resume',
      'root-7',
      '--',
      'go',
    ]);
    expect(yield* harnessArgv(builtinHarness('claude-code'), null, 'fresh-9', 'go', chosen)).toEqual([
      'claude',
      '--dangerously-skip-permissions',
      '--model',
      'claude-opus-5',
      '--effort',
      'high',
      '--session-id',
      'fresh-9',
      '--',
      'go',
    ]);
    expect(yield* harnessArgv(builtinHarness('codex'), 'root-8', 'execution-8', '', { model: 'gpt-5.6-sol', rung: null })).toEqual([
      'codex',
      '--dangerously-bypass-approvals-and-sandbox',
      '-m',
      'gpt-5.6-sol',
      '-c',
      'tui.resume_cwd=current',
      'resume',
      'root-8',
    ]);
    expect(yield* harnessArgv(builtinHarness('claude-code'), 'root-7', 'execution-7', 'go')).toEqual([
      'claude',
      '--dangerously-skip-permissions',
      '--resume',
      'root-7',
      '--',
      'go',
    ]);
  }),
);

it.effect('a chosen permission mode replaces the bypass in every launch shape, and one the CLI lacks is never launched', () =>
  Effect.gen(function* () {
    expect(yield* harnessArgv(builtinHarness('claude-code'), null, 'fresh-9', 'go', undefined, 'manual')).toEqual([
      'claude',
      '--permission-mode',
      'manual',
      '--session-id',
      'fresh-9',
      '--',
      'go',
    ]);
    expect(yield* harnessArgv(builtinHarness('claude-code'), 'root-7', 'execution-7', 'go', undefined, 'auto')).toEqual([
      'claude',
      '--permission-mode',
      'auto',
      '--resume',
      'root-7',
      '--',
      'go',
    ]);
    expect((yield* Effect.flip(harnessArgv(builtinHarness('claude-code'), null, 'fresh-9', 'go', undefined, 'yolo'))).code).toBe(
      'profile-permission',
    );
    expect((yield* Effect.flip(harnessArgv(builtinHarness('codex'), null, 'fresh-9', 'go', undefined, 'auto'))).code).toBe(
      'profile-permission',
    );
  }),
);

test('a row that cannot spell the pair refuses, and an undeclared row launches exactly as it did', () => {
  expect(() => launchOf('devin').interactive('go', { model: 'gpt-5-6-sol', rung: 'high' })).toThrow(/rung/);

  const frozen: Record<'cursor' | 'gemini', readonly string[]> = {
    cursor: ['cursor-agent', '--force', '--resume', 'root-4', 'go'],
    gemini: ['gemini', '--approval-mode', 'yolo', '--resume', 'root-4', 'go'],
  };
  for (const [name, argv] of Object.entries(frozen) as [keyof typeof frozen, readonly string[]][]) {
    const launch = launchOf(name);
    expect(launch.model).toBeNull();
    expect(launch.resume('root-4', 'go')).toEqual([...argv]);
    expect(() => launch.resume('root-4', 'go', { model: 'claude-opus-5', rung: 'high' })).toThrow(/no model surface/);
    expect(() => launch.interactive('go', { model: 'claude-opus-5', rung: null })).toThrow(/no model surface/);
  }
});
