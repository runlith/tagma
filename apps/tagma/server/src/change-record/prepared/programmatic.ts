import { posix } from 'node:path';
import { and, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { runGit } from '../../platform/git/ownGit.js';
import type { PreparedPlace } from '../contract/service/prepared.js';
import { workspaceChange } from '../store/tables.js';
import { PLACES_PER_STATEMENT } from '../record/places.js';
import { chunk } from '@runlith/utils/collection';

const LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'pdm.lock',
  'Gemfile.lock',
  'composer.lock',
  'mix.lock',
  'pubspec.lock',
  'Package.resolved',
  'Podfile.lock',
  'packages.lock.json',
  'gradle.lockfile',
  'flake.lock',
]);

export const programmaticPaths = Effect.fn('prepared.programmaticPaths')(function* (place: PreparedPlace, paths: readonly string[]) {
  if (paths.length === 0) return new Set<string>();
  const attributes = yield* runGit(place.git, 'submit-generated', ['-C', place.root, 'check-attr', '-z', '--stdin', 'linguist-generated'], {
    stdin: paths.map((path) => `${path}\0`).join(''),
    cleans: true,
  });
  const generated = new Set<string>();
  const unspecified = new Set(paths);
  const fields = attributes.split('\0');
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const path = fields[at]!;
    const value = fields[at + 2];
    if (value === 'set' || value === 'true') generated.add(path);
    if (value === 'set' || value === 'true' || value === 'unset' || value === 'false') unspecified.delete(path);
  }
  for (const path of unspecified) if (LOCKFILES.has(posix.basename(path))) generated.add(path);
  const candidates = [...unspecified].filter((path) => !generated.has(path));
  for (const group of chunk(candidates, PLACES_PER_STATEMENT)) {
    const selected = sql`(values ${sql.join(
      group.map((path) => sql`(${path})`),
      sql`, `,
    )}) as selected`;
    const atPath = sql`${workspaceChange.checkout} = ${place.checkout} and ${workspaceChange.path} = selected.column1`;
    const rows = yield* place.units.read((unit) =>
      unit.run(
        place.store.db
          .select({ path: sql<string>`selected.column1` })
          .from(selected)
          .where(
            and(
              sql`not exists(select 1 from ${workspaceChange} where ${atPath} and (${workspaceChange.provenance} is null or ${workspaceChange.provenance} = 'typed'))`,
              sql`exists(select 1 from ${workspaceChange} where ${atPath} and ${workspaceChange.provenance} = 'command-whole')`,
            ),
          ),
      ),
    );
    for (const row of rows) generated.add(row.path);
  }
  return generated;
});
