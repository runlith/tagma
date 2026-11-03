import { expect, test } from 'bun:test';
import { HostRefused, WireFailed } from '@runlith/executions/Executions';
import { WireFault } from '@runlith/executions/protocol/wire';
import { hostRefusalOf, hostRefusalReason, REFUSAL_CODES, TerminalRefused, type TerminalRefusalReason } from '../contract/wire/refusals.js';
import { terminalRefusal } from './refusal.js';

const REASONS = Object.keys(REFUSAL_CODES) as TerminalRefusalReason[];
const FAULT_KINDS = WireFault.fields.kind.literals;

const refusalFor = (reason: TerminalRefusalReason, message = 'the producer’s own sentence') =>
  terminalRefusal(new TerminalRefused({ reason, message }));

const wayOutFor = (kind: string): string =>
  terminalRefusal({ _tag: 'WireFailed', fault: { kind, detail: 'measured here' } } as unknown as WireFailed).unblock[0] as string;

const KEY_READABLE = ['operation-conflict', 'operation-expired'] as const;

test('every reason answers its own code, and no two share one', () => {
  const codes = REASONS.map((reason) => refusalFor(reason).code);
  expect(new Set(codes).size).toBe(REASONS.length);
  for (const code of codes) expect(code.startsWith('terminal-')).toBe(true);
});

test('the fallback is a claim: only the reasons with a key answer the key sentence', () => {
  const keySentence = refusalFor('operation-conflict').unblock[0];
  const answered = REASONS.filter((reason) => refusalFor(reason).unblock[0] === keySentence);
  expect([...answered].sort()).toEqual([...KEY_READABLE].sort());
});

test('every declared wire fault kind is classified rather than left to the fallthrough', () => {
  const fallthrough = wayOutFor('a-kind-this-union-never-declared');
  const unclassified = FAULT_KINDS.filter((kind) => wayOutFor(kind) === fallthrough);
  expect(unclassified).toEqual([]);
});

test('the host’s two “no room” answers reach a caller as different codes and different acts', () => {
  const reserve = refusalFor(hostRefusalReason.MemoryExhausted);
  const seat = refusalFor(hostRefusalReason.CapacityExceeded);

  expect(reserve.code).not.toBe(seat.code);
  expect(reserve.unblock).not.toEqual(seat.unblock);
});

test('a host refusal that crosses the neutral port and comes back keeps its reason', () => {
  for (const tag of Object.keys(hostRefusalReason) as ReadonlyArray<keyof typeof hostRefusalReason>) {
    const reason = hostRefusalReason[tag];
    expect(hostRefusalReason[hostRefusalOf[reason]]).toBe(reason);
  }
  expect(hostRefusalOf['host-state']).toBe('HostUnavailable');
  expect(hostRefusalOf.ineligible).toBe('Unauthorized');
});

test('a host decision that moved custody sends the caller to read what stands; an unavailable host says to ask again', () => {
  const moved = terminalRefusal(
    new HostRefused({
      refusal: { _tag: 'CustodyConflict', reason: 'page-7 no longer types into exec-1. Nothing was applied.' },
    }),
  );
  const shut = terminalRefusal(new HostRefused({ refusal: { _tag: 'AdmissionClosed', reason: 'this host admits no more work' } }));

  const unread = terminalRefusal(
    new HostRefused({ refusal: { _tag: 'HostUnavailable', reason: 'the stdout record could not be read: 0 of 8 bytes from 0' } }),
  );

  expect(moved.code).toBe('terminal-host-refused-CustodyConflict');
  expect(moved.unblock).not.toEqual(shut.unblock);
  expect(unread.unblock.join(' ')).not.toContain('nothing was started');
  expect(unread.unblock).not.toEqual(shut.unblock);
  expect(moved.reason).toBe('page-7 no longer types into exec-1. Nothing was applied.');
});

test('the producer’s own sentence reaches the caller for every reason', () => {
  for (const reason of REASONS) {
    expect(refusalFor(reason, `what ${reason} actually measured`).reason).toBe(`what ${reason} actually measured`);
  }
});
