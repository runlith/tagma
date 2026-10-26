import { describe, expect, test } from 'bun:test';
import { WireLost, WireFailed, WireUnreadable, WireUnavailable } from '@runlith/executions/Executions';
import type { Refusal } from '@runlith/executions/protocol/host';
import { TerminalRefused, hostRefusalReason, hostSentence } from '../contract/wire/refusals.js';
import { terminalRefusal } from './refusal.js';

describe('terminalRefusal wire arms', () => {
  test('unavailability names its kind and varies the way out', () => {
    const unreachable = terminalRefusal(new WireUnavailable({ kind: 'unreachable', reason: 'the owner did not answer', sent: false }));
    expect(unreachable.code).toBe('terminal-host-unavailable-unreachable');
    expect(unreachable.reason).toBe('the owner did not answer');
    expect(unreachable.unblock).toEqual(['ask again once the host answers; the registration stands and is never replaced over this']);

    const absent = terminalRefusal(new WireUnavailable({ kind: 'absent', reason: 'nothing is installed here', sent: false }));
    expect(absent.code).toBe('terminal-host-unavailable-absent');
    expect(absent.unblock).toEqual([
      'install the execution host rather than resending the call: nothing answers because nothing was installed here',
    ]);

    const credential = terminalRefusal(new WireUnavailable({ kind: 'credential', reason: 'no key for this role', sent: false }));
    expect(credential.code).toBe('terminal-host-unavailable-credential');
    expect(credential.unblock).toEqual([
      'fix the installation rather than the call: its registration cannot be acted on, or this caller holds no key for the role it chose',
    ]);
  });

  test('a closed connection resends only what never left', () => {
    const unsent = terminalRefusal(new WireLost({ reason: 'the connection ended', sent: false }));
    expect(unsent.code).toBe('terminal-host-closed');
    expect(unsent.unblock).toEqual(['send it again: the frame never left this process, so nothing was applied']);

    const uncertain = terminalRefusal(new WireLost({ reason: 'the connection ended', sent: true }));
    expect(uncertain.code).toBe('terminal-host-closed');
    expect(uncertain.unblock).toEqual(['read the operation by its key: a lost reply is recovered, never resent']);
  });

  test('a protocol violation carries its detail and is never retried', () => {
    const refused = terminalRefusal(new WireUnreadable({ detail: 'asked status, the host answered ended' }));
    expect(refused.code).toBe('terminal-host-protocol');
    expect(refused.reason).toBe('asked status, the host answered ended');
    expect(refused.unblock).toEqual(['report it against the host installation rather than retrying the call']);
  });

  test('a wire fault spells kind and detail and answers by family', () => {
    const credit = terminalRefusal(new WireFailed({ fault: { kind: 'credit-exceeded', detail: 'no credit left' } }));
    expect(credit.code).toBe('terminal-host-faulted-credit-exceeded');
    expect(credit.reason).toBe('credit-exceeded: no credit left');
    expect(credit.unblock).toEqual(['wait for ceiling to free and ask again; raising the ceiling is the installation’s act']);

    const auth = terminalRefusal(new WireFailed({ fault: { kind: 'unauthenticated', detail: 'no credentials' } }));
    expect(auth.code).toBe('terminal-host-faulted-unauthenticated');
    expect(auth.unblock).toEqual(['fix the installation’s credentials rather than the call']);

    const version = terminalRefusal(new WireFailed({ fault: { kind: 'unsupported-version', detail: 'host speaks 1, client speaks 2' } }));
    expect(version.code).toBe('terminal-host-faulted-unsupported-version');
    expect(version.unblock).toEqual(['fix the installation rather than the call: versions and framing do not change under a retry']);

    const unknown = terminalRefusal(new WireFailed({ fault: { kind: 'unknown-request', detail: 'no such request' } }));
    expect(unknown.unblock).toEqual(['read the inventory again: the name is not held by the host']);
  });
});

const answering = (refusal: Refusal) =>
  terminalRefusal(
    new TerminalRefused({
      reason: hostRefusalReason[refusal._tag],
      message: `The host refused this launch: ${refusal._tag} — ${hostSentence(refusal)}`,
    }),
  );

describe('a refusal the host decided', () => {
  test('a ceiling answers as a ceiling, and never with the act that answers an identity', () => {
    const refused = answering({
      _tag: 'CapacityExceeded',
      reason: 'a 320x100 terminal exceeds the reserved 160x60',
    });

    expect(refused.code).toBe('terminal-capacity');
    expect(refused.reason).toBe('The host refused this launch: CapacityExceeded — a 320x100 terminal exceeds the reserved 160x60');
    expect(refused.unblock).not.toEqual(
      terminalRefusal(new TerminalRefused({ reason: 'ineligible', message: 'measured elsewhere' })).unblock,
    );
  });

  test('a host that cannot take the act in the state it is in is neither a ceiling nor an identity', () => {
    const closed = answering({ _tag: 'AdmissionClosed', reason: 'the host admits no durable work: stopping' });
    const unavailable = answering({ _tag: 'HostUnavailable', reason: 'StoreLost' });

    expect(closed.code).toBe('terminal-host-state');
    expect(unavailable.code).toBe('terminal-host-state');
    expect(closed.unblock).not.toEqual(
      terminalRefusal(new TerminalRefused({ reason: 'ineligible', message: 'measured elsewhere' })).unblock,
    );
    expect(closed.unblock).not.toEqual(terminalRefusal(new TerminalRefused({ reason: 'capacity', message: 'measured elsewhere' })).unblock);
  });

  test('the quote takes the host’s first line and is capped', () => {
    const long = 'x'.repeat(4000);
    const quoted = hostSentence({ _tag: 'HostConflict', reason: `${long}\nand a remedy for a person at a terminal` });

    expect(quoted.length).toBeLessThan(long.length);
    expect(quoted).not.toContain('remedy');
    expect(quoted.startsWith('x')).toBe(true);
  });
});
