import { expect, test } from 'bun:test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { principalOf } from '../terminals/principals.js';
import { terminalView, type TerminalRecord } from '../contract/wire/terminals.js';
import { terminalLine, terminalsText } from './terminals.js';

const record: TerminalRecord = {
  projectId: 1,
  execution: { installation: InstallationId.make('i'), execution: ExecutionId.make('exec-1'), incarnation: 3 },
  transport: 'pty',
  lifetime: 'held',
  targetKey: 'k' as never,
  holder: principalOf({ _tag: 'Operator' }),
  origin: principalOf({ _tag: 'Operator' }),
  revision: 1 as never,
  holdings: {},
  acceptedAt: 0,
  label: 'dev server',
  commandLine: 'bun run dev',
  cwd: '/repo',
};

test('a terminal line carries the address read_terminal answers, exactly as it spells it', () => {
  const line = terminalLine({ record: terminalView(record) });
  expect(line).toContain('exec-1:3');
  expect(line).toContain('dev server');
});

test('the continuing call works as printed', () => {
  const text = terminalsText({ status: 'ok', terminals: [{ record: terminalView(record) }], total: 2, next: 'cursor-word' });
  expect(text).toContain('read_terminals(cursor="cursor-word")');
});
