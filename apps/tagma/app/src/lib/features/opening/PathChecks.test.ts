import { expect, test } from 'vitest';
import { PathChecks } from './PathChecks.js';

test('one path is read once however often it is asked, and the oldest of 1024 answers goes first', async () => {
  const reads: string[] = [];
  const checks = new PathChecks(async (path) => {
    reads.push(path);
    return true;
  });
  await Promise.all([checks.read('/work/0.ts'), checks.read('/work/0.ts')]);
  for (let index = 1; index < 1024; index++) await checks.read(`/work/${index}.ts`);
  expect(checks.known('/work/0.ts')).toBe(true);

  await checks.read('/work/new.ts');

  expect(checks.known('/work/0.ts')).toBe(true);
  expect(checks.known('/work/1.ts')).toBeUndefined();
  expect(reads.filter((path) => path === '/work/0.ts')).toHaveLength(1);
});
