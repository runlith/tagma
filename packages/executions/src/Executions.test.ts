import { expect, test } from 'bun:test';
import { HostRefused, WireFailed, WireLost, WireUnavailable } from './Executions';

test('a host failure says why in its message', () => {
  expect(
    new WireUnavailable({ kind: 'unreachable', reason: 'the socket could not be opened (Unknown): ECONNREFUSED', sent: false }).message,
  ).toContain('ECONNREFUSED');
  expect(new WireLost({ reason: 'the socket closed: 1006', sent: true }).message).toContain('the socket closed: 1006');
  expect(new WireFailed({ fault: { kind: 'malformed', detail: 'frame 7' } }).message).toContain('frame 7');
  expect(new HostRefused({ refusal: { _tag: 'AdmissionClosed', reason: 'the host is yielding' } }).message).toContain(
    'the host is yielding',
  );
});
