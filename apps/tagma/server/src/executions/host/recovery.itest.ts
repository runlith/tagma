import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { endByRecovery, listByRecovery, operationCommand, readRecoveryVersion, shutdownCommand, type RecoveryInput } from './recovery.js';

const owned = fixtureRoot('host-recovery-measure', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'c-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const script = [
  '#!/bin/sh',
  'state="$2"',
  'n=$(cat "$state/.calls" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$state/.calls"',
  'printf \'%s\\n\' "$*" >> "$state/.args"',
  'code=$(cat "$state/.exit" 2>/dev/null || echo 0)',
  'if [ "$code" != "0" ]; then cat "$state/.stderr" >&2 2>/dev/null; exit "$code"; fi',
  'if [ -f "$state/.killed" ]; then kill -KILL $$; fi',
  'if [ -f "$state/.sleep$n" ]; then sleep "$(cat "$state/.sleep$n")"; elif [ -f "$state/.sleep" ]; then sleep "$(cat "$state/.sleep")"; fi',
  'cat "$state/.page$n" 2>/dev/null || true',
  'exit 0',
  '',
].join('\n');

const world = (name: string, files: Record<string, string>): RecoveryInput => {
  const root = join(home, name);
  const bundle = join(root, 'bundle');
  const state = join(root, 'state');
  mkdirSync(bundle, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bundle, 'bun'), script, { mode: 0o755 });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(state, name), content);
  return { bundle, state };
};

const row = (execution: string, phase: string): string => `${execution} 5 ${phase} pty cleanup pending record available`;

it.live('an inventory that prints nothing measures zero live', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(world('empty', {}));
    expect(measured).toMatchObject({ _tag: 'Measured', live: 0 });
  }),
);

it.live('only standing phases count as live; ended rows do not', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(
      world('mixed', {
        '.page1': [
          row('11111111-1111-4111-8111-111111111111', 'running'),
          row('22222222-2222-4222-8222-222222222222', 'queued'),
          row('33333333-3333-4333-8333-333333333333', 'ended'),
          row('44444444-4444-4444-8444-444444444444', 'ended'),
          '',
        ].join('\n'),
      }),
    );
    expect(measured).toMatchObject({ _tag: 'Measured', live: 2 });
  }),
);

it.live('pages are followed to the end, and the cursor is handed back', () =>
  Effect.gen(function* () {
    const input = world('paged', {
      '.page1': [row('11111111-1111-4111-8111-111111111111', 'running'), 'more after 22222222-2222-4222-8222-222222222222 5', ''].join(
        '\n',
      ),
      '.page2': [row('22222222-2222-4222-8222-222222222222', 'ended'), ''].join('\n'),
    });
    const measured = yield* listByRecovery(input);
    expect(measured).toMatchObject({ _tag: 'Measured', live: 1 });
    const calls = readFileSync(join(input.state, '.args'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('22222222-2222-4222-8222-222222222222 5');
  }),
);

it.live('a line in no known shape is a failed measurement, never zero', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(world('garbage', { '.page1': 'a line no recovery program prints\n' }));
    expect(measured._tag).toBe('Unmeasured');
    if (measured._tag !== 'Unmeasured') return;
    expect(measured.detail).not.toBe('');
  }),
);

it.live('a phase this side does not know is not a host to call idle', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(
      world('unknown-phase', { '.page1': `${row('11111111-1111-4111-8111-111111111111', 'migrating')}\n` }),
    );
    expect(measured._tag).toBe('Unmeasured');
  }),
);

it.live('a program that refuses answers its own first line', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(
      world('refused', { '.exit': '1', '.stderr': 'no owner could be reached at /nowhere: absent — gone\nsecond line\n' }),
    );
    expect(measured._tag).toBe('Unmeasured');
    if (measured._tag !== 'Unmeasured') return;
    expect(measured.detail).toContain('no owner could be reached');
    expect(measured.detail).not.toContain('second line');
  }),
);

it.live('a program slower than the five seconds a listing once had is waited for and its answer taken', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(
      world('slow', { '.sleep': '5.5', '.page1': `${row('11111111-1111-4111-8111-111111111111', 'running')}\n` }),
    );
    expect(measured).toMatchObject({ _tag: 'Measured', live: 1 });
  }),
);

test('the manual command names the bundle, the state and a key of its own', () => {
  expect(shutdownCommand({ bundle: '/b', state: '/s' }, 'host-recover-k1')).toBe(
    '/b/bun /b/recovery/recovery.js /s shutdown host-recover-k1',
  );
});

test('a minted key runs copy-paste: a real key, and a fresh one per call', () => {
  const first = shutdownCommand({ bundle: '/b', state: '/s' });
  expect(first).toMatch(/^\/b\/bun \/b\/recovery\/recovery\.js \/s shutdown host-recover-[0-9a-f-]{36}$/);
  expect(shutdownCommand({ bundle: '/b', state: '/s' })).not.toBe(first);
});

test('the printed command runs as printed, through a real shell', async () => {
  const input = world('runs-as-printed', { '.page1': 'ShutdownComplete\n' });
  const child = Bun.spawn(['sh', '-c', shutdownCommand(input)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  expect(stdout.trim()).toBe('ShutdownComplete');
  expect(readFileSync(join(input.state, '.args'), 'utf8')).toMatch(/shutdown host-recover-[0-9a-f-]{36}/);
});

test('the readback command names the bundle, the state and the run key', () => {
  expect(operationCommand({ bundle: '/b', state: '/s' }, 'host-recover-k1')).toBe(
    '/b/bun /b/recovery/recovery.js /s operation host-recover-k1',
  );
});

it.live('a complete shutdown ends the host', () =>
  Effect.gen(function* () {
    expect((yield* endByRecovery(world('down-complete', { '.page1': 'ShutdownComplete\n' })))._tag).toBe('Ended');
  }),
);

it.live('an incomplete shutdown carries its reason and what survived', () =>
  Effect.gen(function* () {
    const ending = yield* endByRecovery(
      world('down-incomplete', {
        '.page1': [
          'ShutdownIncomplete',
          'exec-1 covered residual 0',
          'incomplete: resources survive or could not be measured',
          'residual process: pid 1',
          'unverifiable record: never sealed',
          '',
        ].join('\n'),
      }),
    );
    expect(ending._tag).toBe('Refused');
    if (ending._tag !== 'Refused') return;
    expect(ending.detail).toContain('ShutdownIncomplete');
    expect(ending.detail).toContain('residual 1 unverifiable 1');
  }),
);

it.live('a refusal whose verdict line carries no reason still reaches the caller with what the program said', () =>
  Effect.gen(function* () {
    const ending = yield* endByRecovery(
      world('down-unreasoned', {
        '.exit': '1',
        '.stderr': [
          '[03:38:30.326] ERROR (#2): RecoveryRefused: ',
          '    at <anonymous> (/bundle/recovery/recovery.js:273:60)',
          'no owner could be reached at /s: unreachable — nothing listens',
          '',
        ].join('\n'),
      }),
    );
    expect(ending._tag).toBe('Refused');
    if (ending._tag !== 'Refused') return;
    expect(ending.detail).toContain('RecoveryRefused');
    expect(ending.detail).toContain('no owner could be reached');
  }),
);

it.live('what the program said is capped, so no refusal is longer than a person will read', () =>
  Effect.gen(function* () {
    const ending = yield* endByRecovery(
      world('down-verbose', { '.exit': '1', '.stderr': `RecoveryRefused\n${'a stack frame nobody reads '.repeat(400)}\n` }),
    );
    expect(ending._tag).toBe('Refused');
    if (ending._tag !== 'Refused') return;
    expect(ending.detail.length).toBeLessThan(2_000);
  }),
);

it.live('a shutdown program ended by a signal before it answered names its signal and the key to read back', () =>
  Effect.gen(function* () {
    const input = world('down-killed', { '.killed': '' });
    const ending = yield* endByRecovery(input);
    expect(ending._tag).toBe('Refused');
    if (ending._tag !== 'Refused') return;
    const sent = /shutdown (host-recover-\S+)/.exec(readFileSync(join(input.state, '.args'), 'utf8'))?.[1] ?? '';
    expect(sent).not.toBe('');
    expect(ending.detail).toContain('SIGKILL');
    expect(ending.detail).toContain(`operation ${sent}`);
  }),
);

it.live('a listing that fails names what it counted before failing', () =>
  Effect.gen(function* () {
    const measured = yield* listByRecovery(
      world('partial', {
        '.page1': [
          row('11111111-1111-4111-8111-111111111111', 'running'),
          row('22222222-2222-4222-8222-222222222222', 'running'),
          'more after 33333333-3333-4333-8333-333333333333 5',
          '',
        ].join('\n'),
        '.page2': 'a line no recovery program prints\n',
      }),
    );
    expect(measured._tag).toBe('Unmeasured');
    if (measured._tag !== 'Unmeasured') return;
    expect(measured.detail).toContain('2 live counted');
  }),
);

it.live('a bundle reports its own wire beside its manifest', () =>
  Effect.gen(function* () {
    const version = yield* readRecoveryVersion(world('version', { '.page1': 'wire 9 bundle sha256:abc build cut-1\n' }));
    expect(version).toEqual({ _tag: 'Known', wire: 9, digest: 'sha256:abc', build: 'cut-1' });
  }),
);

it.live('a bundle with no manifest still names its wire', () =>
  Effect.gen(function* () {
    const version = yield* readRecoveryVersion(world('version-bare', { '.page1': 'wire 9 bundle unknown\n' }));
    expect(version).toEqual({ _tag: 'Known', wire: 9, digest: undefined, build: undefined });
  }),
);

it.live('a program that predates the verb leaves the version unread', () =>
  Effect.gen(function* () {
    const version = yield* readRecoveryVersion(world('version-old', { '.exit': '1', '.stderr': 'version is not a recovery verb\n' }));
    expect(version._tag).toBe('Unknown');
    if (version._tag !== 'Unknown') return;
    expect(version.detail).toContain('version is not a recovery verb');
  }),
);
