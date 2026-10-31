import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { MODULES as DECLARED } from './developer/modules.js';
import type { Manifest } from '../platform/contract/service/manifest.js';

const MODULES: readonly Manifest[] = DECLARED;

const SRC = join(import.meta.dir, '..');

const declaredInSource = (): readonly string[] =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts') && !/\.(test|itest|stest|bench)\.ts$/.test(path))
    .flatMap((path) =>
      [...readFileSync(join(SRC, path), 'utf8').matchAll(/\bsqliteTable\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1] as string),
    )
    .sort();

const claimed = async (): Promise<readonly string[]> =>
  (
    await Promise.all(
      MODULES.map(async (module) => {
        const tables = await module.tables?.();
        return tables === undefined ? [] : [...tables.entities, ...tables.history].map((table) => getTableName(table));
      }),
    )
  )
    .flat()
    .sort();

test('every table declared in source is claimed by exactly one manifest', async () => {
  const owners = await claimed();
  expect(owners.filter((name, at) => owners.indexOf(name) !== at)).toEqual([]);
  const unclaimed = declaredInSource().filter((name) => !owners.includes(name));
  expect(unclaimed).toEqual([]);
});
