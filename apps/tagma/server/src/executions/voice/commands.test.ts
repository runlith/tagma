import { expect, test } from 'bun:test';
import { ExecutionId, HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';
import type { StopReceipt } from '@runlith/executions/protocol/stop';
import { stopText } from './commands.js';

const installation = InstallationId.make('host-a');
const receipt: StopReceipt = {
  execution: { installation, execution: ExecutionId.make('command-a'), incarnation: 3 },
  operation: { installation, operation: HostRequestKey.make('stop-a') },
  requested: 'signal',
  cause: 'explicit-stop',
  steps: ['interrupt'],
  nativeExit: { _tag: 'Signal', signal: 'SIGINT' },
  cost: { _tag: 'Unmeasured', reason: 'failed', detail: 'accounting unavailable' },
  coverage: ['leader', 'ancestry'],
  relation: 'partial',
  confirmed: [{ pid: 901, relation: 'leader', exit: { _tag: 'Signal', signal: 'SIGINT' }, step: 'interrupt' }],
  residual: [{ kind: 'process', pid: 902, relation: 'ancestry', detail: 'child remains' }],
  unverifiable: [{ kind: 'process', detail: 'escaped child', reason: 'identity changed' }],
  streams: [{ stream: 'stdout', ending: 'eof' }],
  cleanup: 'residual',
  retention: 'partial',
  abandonedOutput: false,
};

test('a stop answer carries process evidence and the limits of the ending measurement', () => {
  const text = stopText({ status: 'ok', receipt });
  for (const value of [
    '901',
    '902',
    'leader',
    'ancestry',
    'partial',
    'child remains',
    'escaped child',
    'identity changed',
    'stdout',
    'eof',
    'accounting unavailable',
  ]) {
    expect(text).toContain(value);
  }
});

test('an empty stop population is reported rather than omitted', () => {
  const text = stopText({
    status: 'ok',
    receipt: { ...receipt, confirmed: [], residual: [], unverifiable: [], streams: [], coverage: [], relation: 'unknown' },
  });
  for (const population of ['confirmed: 0', 'survived: 0', 'unverified: 0', 'coverage: none', 'streams: 0'])
    expect(text).toContain(population);
});
