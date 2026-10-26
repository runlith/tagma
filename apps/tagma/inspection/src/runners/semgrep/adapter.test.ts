import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { ProgramInvocation } from '../../core/program.js';
import { SEMGREP_MIN_VERSION, planSemgrep, readSemgrep } from './adapter.js';

const input: ProgramInvocation = {
  request: 'request',
  checker: 'checker',
  tree: 'tree',
  base: 'base',
  root: '/project',
  keys: [{ key: 'k', id: 'domain-imports', params: {}, reach: { places: ['src'] } }],
  sides: [{ side: 'tree', paths: [], files: [] }],
};
const config = {
  absolute: '/prepared/rules.yml',
  text: 'rules:\n - id: domain-imports\n   languages: [python]\n   severity: ERROR\n   message: forbidden import\n   pattern: import billing.api\n',
};
const sides = [{ side: 'tree' as const, whole: false, files: [{ path: 'src/domain.py', text: 'import billing.api # nosemgrep\n' }] }];
const unwrap = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
};
const result = {
  ruleId: 'domain-imports',
  message: { text: 'forbidden import' },
  fingerprints: { 'matchBasedId/v1': 'requires login' },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: 'tree/src/domain.py', uriBaseId: '%SRCROOT%' },
        region: { startLine: 1, startColumn: 1 },
      },
    },
  ],
};
const record = {
  version: '2.1.0',
  runs: [
    {
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }],
      tool: { driver: { name: 'Semgrep OSS', semanticVersion: SEMGREP_MIN_VERSION } },
      results: [result, result, { ...result, suppressions: [{ kind: 'inSource' }] }],
    },
  ],
};
const coverage = JSON.stringify({ version: SEMGREP_MIN_VERSION, paths: { scanned: ['tree/src/domain.py'] }, errors: [] });

test('Semgrep files config refuses paths, taint, foreign languages and arbitrary code patterns', () => {
  for (const extra of ['paths: {exclude: ["**"]}', 'mode: taint', 'options: {interfile: true}'])
    expect(Result.isFailure(planSemgrep(input, sides, { ...config, text: config.text + `   ${extra}\n` }))).toBe(true);
  expect(
    Result.isFailure(
      planSemgrep(input, sides, {
        ...config,
        text: config.text.replace('pattern: import billing.api', 'patterns: [{pattern-where-python: "True"}]'),
      }),
    ),
  ).toBe(true);
  expect(Result.isFailure(planSemgrep(input, sides, { ...config, text: config.text.replace('[python]', '[python, javascript]') }))).toBe(
    true,
  );
  expect(Result.isFailure(planSemgrep(input, [{ ...sides[0]!, files: [{ path: 'file.js', text: '' }] }], config))).toBe(true);
});

test('recorded SARIF counts each unsuppressed result and leaves a nosemgrep-suppressed one out of the count budget', () => {
  const plan = unwrap(planSemgrep(input, sides, config));
  const answer = unwrap(readSemgrep(input, sides, plan, { exitCode: 0, stdout: JSON.stringify(record), coverage }));
  expect(answer.readings[0]!.findings).toEqual([
    { fingerprint: 'src/domain.py', path: 'src/domain.py', line: 1, message: 'forbidden import', value: 2 },
  ]);
  expect(answer.run.capabilities).toEqual({ unit: 'count' });
});

test("Semgrep literal percent filenames do not borrow another file's count", () => {
  const named = [
    {
      side: 'tree' as const,
      whole: false,
      files: [
        { path: 'src/a%20b.py', text: 'import billing.api' },
        { path: 'src/a b.py', text: 'x = 1' },
      ],
    },
  ];
  const plan = unwrap(planSemgrep(input, named, config));
  const stdout = JSON.stringify(record).replaceAll('tree/src/domain.py', 'tree/src/a%20b.py');
  const coverage = JSON.stringify({
    version: SEMGREP_MIN_VERSION,
    paths: { scanned: ['tree/src/a%20b.py', 'tree/src/a b.py'] },
    errors: [],
  });
  expect(unwrap(readSemgrep(input, named, plan, { exitCode: 0, stdout, coverage })).readings[0]!.findings[0]!.path).toBe('src/a%20b.py');
});

test('Semgrep refuses partial scans, native parse errors, malformed SARIF, conflicting versions and unknown exits', () => {
  const plan = unwrap(planSemgrep(input, sides, config));
  const ending = { exitCode: 0, stdout: JSON.stringify(record), coverage };
  for (const bad of [
    { ...ending, coverage: undefined },
    { ...ending, coverage: JSON.stringify({ version: SEMGREP_MIN_VERSION, paths: { scanned: [] }, errors: [] }) },
    {
      ...ending,
      coverage: JSON.stringify({
        version: SEMGREP_MIN_VERSION,
        paths: { scanned: ['tree/src/domain.py'] },
        errors: [{ type: 'ParseError' }],
      }),
    },
    { ...ending, exitCode: 3 },
    { ...ending, stdout: '{' },
    { ...ending, stdout: JSON.stringify(record).replace(SEMGREP_MIN_VERSION, '2.0.0') },
    { ...ending, stdout: JSON.stringify(record).replace('tree/src/domain.py', 'tree/unknown.py') },
  ])
    expect(Result.isFailure(readSemgrep(input, sides, plan, bad))).toBe(true);
});

test('Semgrep accepts its OSS SARIF minimum and later releases and keeps suppressed-only scans clean', () => {
  const plan = unwrap(planSemgrep(input, sides, config));
  for (const version of ['1.56.0', '1.140.0', '2.0.0']) {
    const stdout = JSON.stringify(record).replace(SEMGREP_MIN_VERSION, version);
    const answer = unwrap(
      readSemgrep(input, sides, plan, { exitCode: 0, stdout, coverage: coverage.replace(SEMGREP_MIN_VERSION, version) }),
    );
    expect(answer.run.version).toBe(version);
    expect(answer.readings[0]!.findings[0]!.value).toBe(2);
  }
  const old = readSemgrep(input, sides, plan, {
    exitCode: 0,
    stdout: JSON.stringify(record),
    coverage: coverage.replace(SEMGREP_MIN_VERSION, '1.55.2'),
  });
  if (Result.isSuccess(old)) throw new Error('an unsupported Semgrep version was accepted');
  expect(old.failure).toContain('1.56.0');
  expect(old.failure).toContain('1.55.2');
  const suppressed = { ...record, runs: [{ ...record.runs[0]!, results: [{ ...result, suppressions: [{ kind: 'inSource' }] }] }] };
  expect(
    unwrap(readSemgrep(input, sides, plan, { exitCode: 1, stdout: JSON.stringify(suppressed), coverage })).readings[0]!.findings,
  ).toEqual([]);
});
