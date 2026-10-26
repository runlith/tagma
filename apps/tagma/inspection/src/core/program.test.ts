import { expect, test } from 'bun:test';
import { Result } from 'effect';
import { type ProgramInvocation, readProgramAnswer } from './program.js';

test('a program answer rejects an explicitly empty set of finding sites instead of erasing the violation', () => {
  const input: ProgramInvocation = {
    request: 'ask',
    checker: 'law',
    root: '/repo',
    tree: 'tree',
    base: null,
    keys: [{ key: 'key', id: 'rule', params: {}, reach: { places: [''] } }],
    sides: [{ side: 'tree', paths: ['a.ts'], files: [{ path: 'a.ts', text: 'forbidden();' }] }],
  };
  const answer = readProgramAnswer(input, {
    request: input.request,
    checker: input.checker,
    tree: input.tree,
    base: input.base,
    run: { tool: 'fixture', version: '1', capabilities: {} },
    readings: [
      {
        key: 'key',
        side: 'tree',
        covered: ['a.ts'],
        unjudged: [],
        findings: [{ fingerprint: 'f', path: 'a.ts', line: 1, message: 'forbidden', sites: [] }],
      },
    ],
  });
  expect(Result.isFailure(answer)).toBe(true);
});
