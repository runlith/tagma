import type { CommandEntry } from '@runlith/executions/protocol/inventory';
import type { CommandReading } from '@tagma/server/executions/contract/wire/commands';
import { expect, test } from 'vitest';
import { commandLine } from './lines.js';
import { elapsedMs, type ProcessOwner } from '../processes/lines.js';

const NOW = 1_700_000_000_000;
const ROOT = '/repo';
const ref = { installation: 'inst', execution: 'exec-1', incarnation: 0 } as CommandReading['command']['execution'];
const owner: ProcessOwner = { thread: 'thread-1', label: 'check-adoption', internal: false, archived: false };

const entry = (over: Partial<CommandEntry> = {}): CommandEntry =>
  ({
    admission: {
      origin: { scope: 'p', owner: 'thread:thread-1', cohort: 'c' },
      limits: { executionMs: 360_000, executionCeilingMs: 14_400_000, origin: 'rule' },
      policyIdentity: 'policy',
    },
    state: {
      ref,
      transport: 'pipes',
      lifetime: 'command',
      purpose: 'command',
      phase: 'running',
      streams: { stdout: 'open', stderr: 'open', pty: 'eof' },
      cleanup: 'pending',
      record: 'available',
    },
    deadline: {
      execution: ref,
      revision: 2,
      executionMs: 600_000,
      ceilingMs: 14_400_000,
      origin: 'caller',
      armed: 'native-acquired',
      expiresAt: NOW + 439_000,
    },
    admittedAtMs: NOW - 200_000,
    ...over,
  }) as CommandEntry;

const reading = (live: CommandReading['live'], wait: CommandReading['wait'] = undefined): CommandReading =>
  ({
    command: {
      projectId: 1,
      execution: ref,
      owner: { _tag: 'Thread', thread: 'thread-1' },
      origin: { _tag: 'Thread', thread: 'thread-1' },
      policyIdentity: 'policy',
      admittedAt: NOW - 200_000,
    },
    live,
    wait,
  }) as CommandReading;

test('a held command starts its clock where the armed deadline says, and carries the revision its next act names', () => {
  const line = commandLine(
    reading({ _tag: 'Held', readAt: NOW, entry: entry() }, { execution: ref, mode: 'background', revision: 1 }),
    owner,
    ROOT,
  );
  expect(line.phase).toBe('running');
  expect(line.wait).toBe('background');
  expect(line.startedAt).toBe(NOW - 161_000);
  expect(line.limit).toMatchObject({
    executionMs: 600_000,
    ceilingMs: 14_400_000,
    revision: 2,
    expiresAt: NOW + 439_000,
    origin: 'caller',
  });
});

test('running work with no allowance ticks from the elapsed time the host measured at the instant it was read', () => {
  const unbounded = (phase: 'running' | 'queued' | 'ended', armed: boolean) =>
    commandLine(
      reading({
        _tag: 'Held',
        readAt: NOW,
        entry: entry({
          state: { ...entry().state, phase },
          deadline: {
            execution: ref,
            revision: 0,
            origin: 'caller',
            armed: armed ? 'native-acquired' : undefined,
            elapsedMs: armed ? 127_187 : undefined,
          },
        }),
      }),
      owner,
      ROOT,
    );
  const running = unbounded('running', true);
  expect(running.startedAt).toBe(NOW - 127_187);
  expect(elapsedMs(running, NOW + 1_000)).toBe(128_187);
  expect(running.limit).toMatchObject({ executionMs: null, expiresAt: null });

  expect(unbounded('queued', false).startedAt).toBeNull();
  expect(unbounded('running', false).startedAt).toBeNull();
  expect(unbounded('ended', true).startedAt).toBeNull();
});

test('queued work has no clock, and a host that holds nothing or does not answer is neither an ending nor idle', () => {
  const queued = commandLine(
    reading({
      _tag: 'Held',
      readAt: NOW,
      entry: entry({ deadline: { execution: ref, revision: 0, executionMs: 600_000, ceilingMs: 14_400_000, origin: 'rule' } }),
    }),
    owner,
    ROOT,
  );
  expect(queued.startedAt).toBeNull();
  expect(queued.limit?.expiresAt).toBeNull();

  const unheld = commandLine(reading({ _tag: 'Unheld' }), owner, ROOT);
  expect(unheld.phase).toBeNull();
  expect(unheld.live).toBe('unheld');
  const unavailable = commandLine(reading({ _tag: 'Unavailable', detail: 'socket closed' }), owner, ROOT);
  expect(unavailable.phase).toBeNull();
  expect(unavailable.live).toBe('unavailable');
});

test('the line is the label and the command line; the interpreter is drawn only where a row has nothing else', () => {
  const retained = reading({ _tag: 'Held', readAt: NOW, entry: entry() });
  const held = commandLine(
    {
      ...retained,
      command: { ...retained.command, label: 'Typecheck the tree', commandLine: 'bun run typecheck', program: '/bin/sh' },
    },
    owner,
    ROOT,
  );
  expect(held.label).toBe('Typecheck the tree');
  expect(held.command).toBe('bun run typecheck');

  const old = commandLine({ ...retained, command: { ...retained.command, program: '/bin/sh' } }, owner, ROOT);
  expect(old.label).toBeNull();
  expect(old.command).toBe('/bin/sh');

  const unretained = commandLine(retained, owner, ROOT);
  expect(unretained.command).toBeNull();
  expect(unretained.note).toBeNull();
});

test('the cwd is a note only where it differs from the project root, and an unknown root hides nothing', () => {
  const retained = reading({ _tag: 'Held', readAt: NOW, entry: entry() });
  const at = (cwd: string, root: string | null) => commandLine({ ...retained, command: { ...retained.command, cwd } }, owner, root).note;
  expect(at(ROOT, ROOT)).toBeNull();
  expect(at(`${ROOT}/apps/tagma`, ROOT)).toBe(`${ROOT}/apps/tagma`);
  expect(at(ROOT, null)).toBe(ROOT);
});

test('an ending that never acquired a child reaches the line in the host own words; one that ran carries none', () => {
  const ending = (over: Partial<NonNullable<CommandEntry['ending']>> = {}) =>
    ({
      execution: ref,
      cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'no child was reaped' },
      coverage: [],
      relation: 'covered',
      confirmed: [],
      residual: [],
      unverifiable: [],
      streams: [],
      cleanup: 'complete',
      retention: 'retained',
      abandonedOutput: false,
      ...over,
    }) as NonNullable<CommandEntry['ending']>;
  const ended = (over: NonNullable<CommandEntry['ending']>): CommandEntry =>
    entry({ state: { ...entry().state, phase: 'ended', cleanup: 'complete', record: 'unavailable' }, ending: over });

  const never = commandLine(
    reading({ _tag: 'Held', readAt: NOW, entry: ended(ending({ unacquired: 'the attempt found no program to run' })) }),
    owner,
    ROOT,
  );
  expect(never.unstarted).toBe('the attempt found no program to run');

  const ran = commandLine(
    reading({ _tag: 'Held', readAt: NOW, entry: ended(ending({ nativeExit: { _tag: 'Code', code: 0 } })) }),
    owner,
    ROOT,
  );
  expect(ran.unstarted).toBeNull();
});

test('a line says it has printed only on the host word, and a host that holds nothing leaves it unknown rather than silent', () => {
  const printed = (live: CommandReading['live']) => commandLine(reading(live), owner, ROOT).printed;
  expect(printed({ _tag: 'Held', readAt: NOW, entry: entry({ printed: false }) })).toBe(false);
  expect(printed({ _tag: 'Held', readAt: NOW, entry: entry({ printed: true }) })).toBe(true);
  expect(printed({ _tag: 'Held', readAt: NOW, entry: entry() })).toBeNull();
  expect(printed({ _tag: 'Unheld' })).toBeNull();
});

test('a product-internal command is drawn under Tagma internal whoever admitted it', () => {
  const internal = entry();
  const line = commandLine(
    reading({ _tag: 'Held', readAt: NOW, entry: { ...internal, state: { ...internal.state, purpose: 'internal' } } }),
    owner,
    ROOT,
  );
  expect(line.owner.internal).toBe(true);
});
