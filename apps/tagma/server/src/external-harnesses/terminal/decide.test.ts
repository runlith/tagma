import { expect, test } from 'bun:test';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { decideWatch, promptStep, READ_DEADLINE_MS, type WatchEvidence } from './decide.js';

const T0 = Date.parse('2026-10-08T10:00:00.000Z');
const facet = (over: Partial<ExternalSession>): ExternalSession => ({ name: 'claude-code', ...over }) as ExternalSession;
const unread = (run: string, items: string[], at = T0) => ({ run, items, at: new Date(at).toISOString() });
const evidence = (over: Partial<WatchEvidence> = {}): WatchEvidence => ({
  now: T0 + 1_000,
  seen: new Set(),
  seenInTurn: new Set(),
  ending: null,
  message: null,
  endedRun: null,
  settling: false,
  asking: false,
  absent: false,
  idle: null,
  ...over,
});
const turn = (run: string, offset: number | null = null) => ({ run, turn: 't', openedAt: new Date(T0).toISOString(), offset });

test('a marker found in the transcript reads the words even though the hook event was lost', () => {
  const verdict = decideWatch(facet({ turn: turn('r1'), unread: [unread('r1', ['a', 'b'])] }), evidence({ seen: new Set(['a']) }));
  expect(verdict.read).toEqual([{ run: 'r1', items: ['a'] }]);
  expect(verdict.unread).toEqual([unread('r1', ['b'])]);
  expect(verdict.lapsed).toEqual([]);
});

test('unread words lapse at the deadline whether or not their run is still open', () => {
  const late = evidence({ now: T0 + READ_DEADLINE_MS });
  const open = decideWatch(facet({ turn: turn('r1'), unread: [unread('r1', ['a'])] }), late);
  expect(open.lapsed).toEqual([{ run: 'r1', items: ['a'] }]);
  expect(open.unread).toEqual([]);

  const early = decideWatch(facet({ unread: [unread('r1', ['a'])] }), evidence({ now: T0 + READ_DEADLINE_MS - 1 }));
  expect(early.lapsed).toEqual([]);
});

test('unread words outlast the deadline while the CLI stands on a question of its own', () => {
  const verdict = decideWatch(
    facet({ turn: turn('r1'), unread: [unread('r1', ['a'])] }),
    evidence({ now: T0 + READ_DEADLINE_MS, asking: true }),
  );
  expect(verdict.lapsed).toEqual([]);
  expect(verdict.unread).toEqual([unread('r1', ['a'])]);
});

test('words held back from the CLI never lapse, since their read window opens when they are typed', () => {
  const held = { ...unread('r1', ['a']), send: 'intended' as const };
  const verdict = decideWatch(facet({ turn: turn('r1'), unread: [held] }), evidence({ now: T0 + READ_DEADLINE_MS }));
  expect(verdict.lapsed).toEqual([]);
  expect(verdict.unread).toEqual([held]);
});

test('positive end evidence closes the open run when none of its words wait for a reading', () => {
  const verdict = decideWatch(
    facet({ turn: { ...turn('r1'), spoke: 2 } }),
    evidence({ ending: { kind: 'completed' }, message: 'done', endedRun: 'r1' }),
  );
  expect(verdict.end).toEqual({ run: 'r1', spoke: 2, ending: { kind: 'completed' }, message: 'done' });
});

test('end evidence does not close a run whose written words are still unconfirmed', () => {
  const verdict = decideWatch(
    facet({ turn: turn('r1'), unread: [unread('r1', ['a'])] }),
    evidence({ ending: { kind: 'completed' }, message: 'done', endedRun: 'r1' }),
  );
  expect(verdict.end).toBeNull();
  expect(verdict.unread).toEqual([unread('r1', ['a'])]);
});

test('end evidence read for another run closes nothing', () => {
  const verdict = decideWatch(facet({ turn: turn('r2') }), evidence({ ending: { kind: 'completed' }, endedRun: 'r1' }));
  expect(verdict.end).toBeNull();
});

test('a marker read later goes to the run that read it, never to the delivery run by default', () => {
  const standing = facet({ turn: turn('r2', 500), unread: [unread('r1', ['a', 'b'])] });
  const verdict = decideWatch(standing, evidence({ seen: new Set(['a', 'b']), seenInTurn: new Set(['a']) }));
  expect(verdict.read).toEqual([
    { run: 'r2', items: ['a'] },
    { run: 'r1', items: ['b'] },
  ]);
  const unplaced = decideWatch(facet({ turn: turn('r2'), unread: [unread('r1', ['a'])] }), evidence({ seen: new Set(['a']) }));
  expect(unplaced.read).toEqual([]);
  expect(unplaced.unread).toEqual([unread('r1', ['a'])]);
  const gone = decideWatch(facet({ unread: [unread('r1', ['a'])] }), evidence({ seen: new Set(['a']) }));
  expect(gone.read).toEqual([]);
  expect(decideWatch(facet({ unread: [unread('r1', ['a'])] }), evidence({ seen: new Set(['a']), settling: true })).read).toEqual([
    { run: 'r1', items: ['a'] },
  ]);
});

test('a run whose CLI reported its start but never took the words ends aborted with them lapsed, unless its turn began meanwhile', () => {
  const reported = facet({
    session: { id: 's1' } as ExternalSession['session'],
    observation: { binding: { sessionId: 's1' }, through: new Date(T0).toISOString() } as ExternalSession['observation'],
    turn: { ...turn('r1'), turn: null },
    unread: [unread('r1', ['a'])],
  });
  const quiet = evidence({ now: T0 + 60_000, endedRun: 'r1', absent: true });
  const untaken = decideWatch(reported, quiet);
  expect(untaken.end).toEqual({ run: 'r1', spoke: 0, ending: { kind: 'aborted', stoppedBy: 'reader' }, message: null });
  expect(untaken.lapsed).toEqual([{ run: 'r1', items: ['a'] }]);
  const begun = decideWatch({ ...reported, turn: { ...turn('r1'), turn: 'p1' } }, quiet);
  expect(begun.end).toBeNull();
  expect(begun.unread).toEqual([unread('r1', ['a'])]);
});

test('a prompt proven idle with no end in the transcript ends the run aborted by its reader, unless the turn moved after the proof', () => {
  const standing = facet({ turn: { ...turn('r1'), movedAt: 'm1' } });
  const idle = decideWatch(standing, evidence({ endedRun: 'r1', idle: { movedAt: 'm1' } }));
  expect(idle.end).toEqual({ run: 'r1', spoke: 0, ending: { kind: 'aborted', stoppedBy: 'reader' }, message: null });
  expect(decideWatch(standing, evidence({ endedRun: 'r1', idle: { movedAt: 'm0' } })).end).toBeNull();
});

test('the prompt is confirmed only by three recognised reads with the run silent between them', () => {
  const shown = { shown: true, movedAt: 'm1' };
  expect(promptStep([], shown)).toBe('again');
  expect(promptStep([shown], shown)).toBe('again');
  expect(promptStep([shown, shown], shown)).toBe('confirmed');
  expect(promptStep([shown], { shown: false, movedAt: 'm1' })).toBe('broken');
  expect(promptStep([shown], { shown: true, movedAt: 'm2' })).toBe('broken');
  expect(promptStep([], { shown: false, movedAt: undefined })).toBe('broken');
});
