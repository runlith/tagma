import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { AST_GREP_MIN_VERSION, planAstGrep, readAstGrep } from './adapter.js';

const input: ProgramInvocation = {
  request: 'request',
  checker: 'checker',
  tree: 'tree',
  base: 'base',
  root: '/project',
  keys: [{ key: 'k', id: 'imports', params: {}, reach: { places: ['src'] } }],
  sides: [{ side: 'tree', paths: [], files: [] }],
};
const config = { absolute: '/prepared/sgconfig.yml', text: 'ruleDirs: [rules]' };
const rules = [{ path: 'rules/.imports.yml', text: 'id: imports\nlanguage: Python\nseverity: error\nrule: {pattern: import billing.api}' }];
const unwrap = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
};
const sides = [{ side: 'tree' as const, whole: false, files: [{ path: 'src/domain.py', text: 'text = 1\nx = 2\nimport billing.api\n' }] }];
const record = {
  version: AST_GREP_MIN_VERSION,
  runs: [
    {
      tool: { driver: { name: 'ast-grep' } },
      results: [
        {
          ruleId: 'imports',
          level: 'error',
          message: { text: '' },
          locations: [{ physicalLocation: { artifactLocation: { uri: 'tree/src/domain.py' }, region: { startLine: 3, startColumn: 1 } } }],
        },
      ],
    },
  ],
};

test('native rule configuration cannot silently narrow or disable a governed check', () => {
  for (const extra of ['files: ["src/**"]', 'ignores: ["**/*.py"]', 'fix: remove', 'severity: off']) {
    const bad = [{ ...rules[0]!, text: rules[0]!.text.replace('severity: error', '') + `\n${extra}` }];
    expect(Result.isFailure(planAstGrep(input, sides, config, bad))).toBe(true);
  }
  expect(Result.isFailure(planAstGrep(input, [{ ...sides[0]!, files: [{ path: 'file.ts', text: '' }] }], config, rules))).toBe(true);
  expect(Result.isFailure(planAstGrep(input, sides, { ...config, text: 'ruleDirs: [rules]\ncustomLanguages: []' }, rules))).toBe(true);
});

test("literal percent names keep a new site separate from another file's base allowance", () => {
  const named = [
    {
      side: 'tree' as const,
      whole: false,
      files: [
        { path: 'src/a%20b.py', text: 'import billing.api' },
        { path: 'src/a b.py', text: 'x = 1' },
      ],
    },
    {
      side: 'base' as const,
      whole: false,
      files: [
        { path: 'src/a%20b.py', text: 'x = 1' },
        { path: 'src/a b.py', text: 'import billing.api' },
      ],
    },
  ];
  const plan = unwrap(planAstGrep(input, named, config, rules));
  const output = JSON.stringify(record).replace('tree/src/domain.py', 'tree/src/a%20b.py');
  const answer = unwrap(readAstGrep(input, named, plan, { exitCode: 1, stdout: output }));
  expect(answer.readings[0]!.findings[0]!.path).toBe('src/a%20b.py');
});

test('recorded native SARIF counts duplicate sites per file and refuses unsupported versions, unexpected targets or exits', () => {
  const plan = unwrap(planAstGrep(input, sides, config, rules));
  const repeated = { ...record, runs: [{ ...record.runs[0]!, results: [...record.runs[0]!.results, ...record.runs[0]!.results] }] };
  expect(unwrap(readAstGrep(input, sides, plan, { exitCode: 1, stdout: JSON.stringify(repeated) })).readings[0]!.findings[0]).toMatchObject(
    { fingerprint: 'src/domain.py', value: 2, line: 3 },
  );
  for (const ending of [
    { exitCode: 0, stdout: JSON.stringify(record) },
    { exitCode: 2, stdout: JSON.stringify(record) },
    { exitCode: 1, stdout: JSON.stringify({ ...record, version: '0.41.0' }) },
    { exitCode: 1, stdout: JSON.stringify(record).replace('tree/src/domain.py', 'tree/other.py') },
    { exitCode: 1, stdout: '{' },
  ])
    expect(Result.isFailure(readAstGrep(input, sides, plan, ending))).toBe(true);
});

test('ast-grep accepts the inline-rule severity API minimum and later versions in its native SARIF dialect', () => {
  const plan = unwrap(planAstGrep(input, sides, config, rules));
  for (const version of ['0.41.1', '0.45.3', '0.51.0']) {
    const answer = unwrap(readAstGrep(input, sides, plan, { exitCode: 1, stdout: JSON.stringify({ ...record, version }) }));
    expect(answer.run.version).toBe(version);
    expect(answer.readings[0]!.findings[0]!.path).toBe('src/domain.py');
  }
  const old = readAstGrep(input, sides, plan, { exitCode: 1, stdout: JSON.stringify({ ...record, version: '0.41.0' }) });
  if (Result.isSuccess(old)) throw new Error('an unsupported ast-grep version was accepted');
  expect(old.failure).toContain('0.41.1');
  expect(old.failure).toContain('0.41.0');
});
