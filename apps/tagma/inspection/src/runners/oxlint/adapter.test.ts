import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { planOxlint, readOxlint } from './adapter.js';

const sides = [{ side: 'tree' as const, whole: false, files: [{ path: 'src/a.js', text: 'console.log(1);' }] }];
const input: ProgramInvocation = {
  request: 'request',
  checker: 'checker',
  root: '/repo',
  tree: 'tree',
  base: null,
  keys: [{ key: 'console', id: 'eslint/no-console', params: {}, reach: { places: [''] } }],
  sides: [{ side: 'tree', paths: ['src/a.js'], files: sides[0]!.files }],
};
const plan = planOxlint(input, sides, null, 1);
if (Result.isFailure(plan)) throw new Error(plan.failure);
const run = {
  tool: { driver: { name: 'oxlint', version: '1.63.0' } },
  results: [
    {
      ruleId: 'eslint(no-console)',
      level: 'error',
      message: { text: 'Unexpected console statement.' },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'tree/src/a.js' }, region: { startLine: 1 } } }],
    },
  ],
};
const read = (value: object, exitCode = 1) =>
  readOxlint(input, sides, plan.success, { exitCode, stdout: JSON.stringify({ version: '2.1.0', runs: [value] }) });

test('oxlint accepts its SARIF minimum and later releases, preserving counted findings and the version that ran', () => {
  for (const version of ['1.63.0', '1.86.0', '2.0.0']) {
    const answer = read({ ...run, tool: { driver: { name: 'oxlint', version } } });
    if (Result.isFailure(answer)) throw new Error(answer.failure);
    expect(answer.success.run.version).toBe(version);
    expect(answer.success.readings[0]!.findings).toEqual([
      { fingerprint: 'src/a.js', path: 'src/a.js', line: 1, message: '1 × Unexpected console statement.', value: 1 },
    ]);
  }
  const old = read({ ...run, tool: { driver: { name: 'oxlint', version: '1.62.0' } } });
  if (Result.isSuccess(old)) throw new Error('an unsupported oxlint version was accepted');
  expect(old.failure).toContain('1.63.0');
  expect(old.failure).toContain('1.62.0');
});

test('oxlint refuses incomplete SARIF invocations even when no error result was emitted', () => {
  for (const invocation of [{ executionSuccessful: false }, { executionSuccessful: true, toolConfigurationNotifications: [{}] }]) {
    const answer = read({ ...run, results: [], invocations: [invocation] }, 0);
    expect(Result.isFailure(answer)).toBe(true);
  }
});
