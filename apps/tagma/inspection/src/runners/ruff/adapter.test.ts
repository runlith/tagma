import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { planRuff, readRuff } from './adapter.js';

const input: ProgramInvocation = {
  request: 'request',
  checker: 'checker',
  tree: 'tree',
  base: 'base',
  root: '/project',
  keys: [{ key: 'k', id: 'F401', params: {}, reach: { places: ['src'] } }],
  sides: [{ side: 'tree', paths: [], files: [] }],
};
const config = { absolute: '/prepared/ruff.toml', text: '[lint]\nselect = ["F401"]\n' };
const sides = [
  { side: 'tree' as const, whole: false, files: [{ path: 'src/domain.py', text: 'import os # noqa\nimport sys\n' }] },
  { side: 'base' as const, whole: false, files: [{ path: 'src/domain.py', text: 'import os\n' }] },
];
const unwrap = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
};
const record = {
  code: 'F401',
  filename: '/scratch/tree/src/domain.py',
  location: { row: 1, column: 8 },
  message: '`os` imported but unused',
  end_location: { row: 1, column: 10 },
  noqa_row: 1,
  fix: null,
  url: 'https://docs.astral.sh/ruff/rules/unused-import',
};

test('Ruff config fails closed on ignores, discovery, unknown options and tree-dependent rules', () => {
  for (const text of [
    'extend = "base.toml"\n' + config.text,
    config.text + 'ignore = ["F401"]\n',
    config.text + '[lint.per-file-ignores]\n"*.py" = ["F401"]\n',
    '[lint]\nselect = ["INP001"]',
    config.text + 'exclude = ["*.py"]',
  ])
    expect(Result.isFailure(planRuff(input, sides, { ...config, text }))).toBe(true);
  expect(Result.isFailure(planRuff(input, [{ ...sides[0]!, files: [{ path: 'file.ipynb', text: '{}' }] }], config))).toBe(true);
  expect(Result.isFailure(planRuff({ ...input, keys: [{ ...input.keys[0]!, params: { ignore: 'F401' } }] }, sides, config))).toBe(true);
});

test('recorded Ruff JSON routes both sides and keys duplicate diagnostics by file count', () => {
  const plan = unwrap(planRuff(input, sides, config));
  const stdout = JSON.stringify([
    record,
    { ...record, location: { row: 2, column: 8 }, message: '`sys` imported but unused', fix: { message: 'Remove unused import: `sys`' } },
    { ...record, filename: '/scratch/base/src/domain.py' },
  ]);
  const answer = unwrap(readRuff(input, sides, plan, { stdout, exitCode: 1 }, '/scratch'));
  const fix = `rule page: ${record.url}`;
  expect(answer.readings.map((reading) => reading.findings)).toEqual([
    [{ fingerprint: 'src/domain.py', path: 'src/domain.py', line: 1, message: record.message, fix, value: 2 }],
    [{ fingerprint: 'src/domain.py', path: 'src/domain.py', line: 1, message: record.message, fix, value: 1 }],
  ]);
  expect(answer.run.capabilities).toEqual({ unit: 'count' });
});

test('Ruff does not turn a parse failure, unknown exit, truncated JSON or unrequested target into clean', () => {
  const plan = unwrap(planRuff(input, sides, config));
  for (const ending of [
    { stdout: JSON.stringify([record]), exitCode: 0 },
    { stdout: JSON.stringify([record]), exitCode: 2 },
    { stdout: '[', exitCode: 1 },
    { stdout: JSON.stringify([{ ...record, code: null }]), exitCode: 1 },
    { stdout: JSON.stringify([{ ...record, filename: '/elsewhere/file.py' }]), exitCode: 1 },
  ])
    expect(Result.isFailure(readRuff(input, sides, plan, ending, '/scratch'))).toBe(true);
});
