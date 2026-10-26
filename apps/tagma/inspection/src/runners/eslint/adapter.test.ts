import { expect, test } from 'bun:test';
import { Result } from 'effect';
import type { FileSide, ProgramInvocation } from '../../core/program.js';
import { planEslint, readEslint } from './adapter.js';

const sides: FileSide[] = [
  {
    side: 'tree',
    whole: false,
    files: [
      { path: 'src/a.js', text: 'console.log(1);\n' },
      { path: 'src/b.js', text: '' },
    ],
  },
];
const input: ProgramInvocation = {
  request: 'r1',
  checker: 'c1',
  root: '/repo',
  tree: 't1',
  base: null,
  keys: [{ key: '0', id: 'no-console', params: {}, reach: { places: [''] } }],
  sides: [{ side: 'tree', paths: ['src/a.js', 'src/b.js'], files: sides[0]!.files }],
};
const plan = planEslint(input, sides, { env: '/env', config: '/env/law.config.js' });
if (Result.isFailure(plan)) throw new Error(plan.failure);

const file = (path: string, messages: readonly object[] = []) => ({ side: 'tree', path, messages });
const console1 = { id: 'no-console', line: 1, message: 'Unexpected console statement.', fatal: false };
const read = (exitCode: number, value: unknown) =>
  readEslint(input, sides, plan.success, { exitCode, stdout: typeof value === 'string' ? value : JSON.stringify(value) });

test('the driver answer counts only when it is exit 0, decodes and answers each requested file once with rule messages', () => {
  const good = read(0, { version: '10.11.0', files: [file('src/a.js', [console1, { ...console1, line: 3 }]), file('src/b.js')] });
  if (Result.isFailure(good)) throw new Error(good.failure);
  expect(good.success.readings[0]!.findings).toEqual([
    { fingerprint: 'src/a.js', path: 'src/a.js', line: 1, message: console1.message, value: 2 },
  ]);
  const refused = [
    read(1, { version: '10.11.0', files: [file('src/a.js'), file('src/b.js')] }),
    read(0, 'Oops'),
    read(0, { failure: 'src/a.js matches no object of the config' }),
    read(0, { version: '10.11.0', files: [file('src/a.js')] }),
    read(0, { version: '10.11.0', files: [file('src/a.js'), file('src/b.js'), file('src/a.js')] }),
    read(0, { version: '10.11.0', files: [file('src/a.js'), file('src/b.js'), file('src/c.js')] }),
    read(0, { version: '10.11.0', files: [file('src/a.js', [{ ...console1, id: null }]), file('src/b.js')] }),
    read(0, { version: '10.11.0', files: [file('src/a.js', [{ ...console1, id: null, fatal: true }]), file('src/b.js')] }),
  ];
  expect(refused.map((one) => Result.isFailure(one))).toEqual(refused.map(() => true));
});

test('ESLint accepts its flat-config API minimum and later releases, preserving the version that ran', () => {
  for (const version of ['9.0.0', '9.39.5', '10.11.0', '11.0.0-beta.1']) {
    const answer = read(0, { version, files: [file('src/a.js', [console1]), file('src/b.js')] });
    if (Result.isFailure(answer)) throw new Error(answer.failure);
    expect(answer.success.run.version).toBe(version);
    expect(answer.success.readings[0]!.findings[0]!.path).toBe('src/a.js');
  }
  for (const version of ['8.57.0', '9.0.0-rc.1', 'invalid']) {
    const old = read(0, { version, files: [file('src/a.js'), file('src/b.js')] });
    if (Result.isSuccess(old)) throw new Error('an unsupported ESLint version was accepted');
    expect(old.failure).toContain('9.0.0');
    expect(old.failure).toContain(version);
  }
});
