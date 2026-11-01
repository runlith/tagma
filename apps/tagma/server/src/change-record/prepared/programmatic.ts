import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { runGit } from '../../platform/git/ownGit.js';
import type { PreparedPlace, PreparedRow } from '../contract/service/prepared.js';
import type { Judged } from '../contract/service/holdings.js';
import type { Planned } from './tree.js';
import { observedPrograms } from '../record/programOrigins.js';
import { workspaceChange } from '../store/tables.js';
import { PLACES_PER_STATEMENT } from '../record/places.js';
import { chunk } from '@runlith/utils/collection';

const generatedAttributes = Effect.fn('prepared.generatedAttributes')(function* (place: PreparedPlace, paths: readonly string[]) {
  const generated = new Set<string>();
  const unspecified = new Set(paths);
  if (paths.length === 0) return { generated, unspecified };
  const attributes = yield* runGit(place.git, 'submit-generated', ['-C', place.root, 'check-attr', '-z', '--stdin', 'linguist-generated'], {
    stdin: paths.map((path) => `${path}\0`).join(''),
    cleans: true,
  });
  const fields = attributes.split('\0');
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const path = fields[at]!;
    const value = fields[at + 2];
    if (value === 'set' || value === 'true') generated.add(path);
    if (value === 'set' || value === 'true' || value === 'unset' || value === 'false') unspecified.delete(path);
  }
  return { generated, unspecified };
});

export const programmaticPaths = Effect.fn('prepared.programmaticPaths')(function* (place: PreparedPlace, paths: readonly string[]) {
  const { generated, unspecified } = yield* generatedAttributes(place, paths);
  for (const group of chunk([...unspecified], PLACES_PER_STATEMENT)) {
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

export const derivedPaths = Effect.fn('prepared.derivedPaths')(function* <Row extends PreparedRow>(
  place: PreparedPlace,
  plan: readonly Planned<Row>[],
  judged: ReadonlyMap<string, Judged>,
) {
  const { generated } = yield* generatedAttributes(
    place,
    plan.map((one) => one.path),
  );
  const ids = plan.flatMap((one) => one.ids);
  for (const group of chunk(ids, PLACES_PER_STATEMENT)) {
    const rows = yield* place.units.read((unit) =>
      unit.run(
        place.store.db
          .select({ id: workspaceChange.id, path: workspaceChange.path, after: workspaceChange.afterHash })
          .from(workspaceChange)
          .where(and(inArray(workspaceChange.id, group), sql`${workspaceChange.provenance} in ('command', 'command-whole')`)),
      ),
    );
    for (const row of rows) {
      const current = judged.get(row.path);
      if (
        (current?.verdict.verdict === 'proven' && current.verdict.standing.has(row.id)) ||
        (row.after !== null && row.after === current?.digests?.working)
      )
        generated.add(row.path);
    }
  }
  const observed = yield* observedPrograms(
    place,
    plan.map((one) => one.path),
  );
  for (const one of plan) {
    const origins = observed.get(one.path);
    if (origins === undefined || origins.length === 0) continue;
    const current = judged.get(one.path);
    if (one.land === 'whole' && origins.some((origin) => origin.digest !== null && origin.digest === current?.digests?.working)) {
      generated.add(one.path);
      continue;
    }
    const verdict = current?.verdict;
    const selected = one.land === 'whole' ? null : new Set<number>();
    if (one.land === 'own' && selected !== null) {
      let position = 0;
      for (const line of one.lines) {
        while (position < one.positions.length && one.positions[position]!.selected + one.positions[position]!.count <= line) position += 1;
        const span = one.positions[position];
        if (span !== undefined && span.selected <= line) selected.add(span.working + line - span.selected);
      }
    }
    const carriesExternal =
      verdict?.verdict === 'proven' &&
      verdict.lines !== 'unweighed' &&
      verdict.regions.some((region) =>
        region.lines.some((line) => line.mark === 'external' && (selected === null || (line.kind === 'added' && selected.has(line.at)))),
      );
    if (!carriesExternal) continue;
    const digests = new Set(origins.flatMap((origin) => (origin.digest === null ? [] : [origin.digest])));
    const rows = yield* place.units.read((unit) =>
      unit.run(
        place.store.db
          .select({ before: workspaceChange.beforeHash, after: workspaceChange.afterHash })
          .from(workspaceChange)
          .where(
            and(
              eq(workspaceChange.checkout, place.checkout),
              eq(workspaceChange.path, one.path),
              sql`${workspaceChange.state} in ('writing', 'held')`,
            ),
          )
          .orderBy(workspaceChange.at, workspaceChange.id),
      ),
    );
    for (const row of rows) if (row.before !== null && digests.has(row.before) && row.after !== null) digests.add(row.after);
    if (current?.digests?.working !== undefined && current.digests.working !== null && digests.has(current.digests.working))
      generated.add(one.path);
  }
  return [...generated];
});
