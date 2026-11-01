import { Effect, Result } from 'effect';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { GraphStore, type StoreDb, type StoreFailure } from '../../platform/contract/service/store.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import { block, spokenTail } from '../store/tables.js';
import { blockIdentity, blockName } from '../contract/wire/references.js';
import { OtherGraphs } from '../serving/policy.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import { RoutedGraphs } from '../contract/service/serving.js';
import type { RefElsewhere } from '../contract/wire/far.js';

const AMBIGUOUS_LENGTH = 12;

export type NameAnswer =
  | { readonly kind: 'block'; readonly name: string; readonly identity: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

export const answeredNames = Effect.fn('answeredNames')(function* (
  db: StoreDb<'graph'>,
  projectId: number,
  names: readonly string[],
): Effect.fn.Return<Map<string, NameAnswer>, StoreFailure> {
  const wanted = [...new Set(names)];
  const answered = new Map<string, NameAnswer>();
  if (wanted.length === 0) return answered;
  const rows = yield* db
    .select({ uuid: block.uuid })
    .from(block)
    .where(
      and(
        eq(block.projectId, projectId),
        isNull(block.deletedAt),
        inArray(
          spokenTail,
          wanted.map((name) => name.slice(-SPOKEN_LENGTH)),
        ),
      ),
    );
  for (const name of wanted) {
    const hits = rows.filter((row) => row.uuid.replaceAll('-', '').endsWith(name));
    const only = hits[0];
    if (hits.length === 1 && only !== undefined)
      answered.set(name, { kind: 'block', name: blockName(only.uuid), identity: blockIdentity(only.uuid) });
    else if (hits.length === 0) answered.set(name, { kind: 'absent' });
    else {
      answered.set(name, {
        kind: 'ambiguous',
        candidates: hits.map((row) => row.uuid.replaceAll('-', '').slice(-AMBIGUOUS_LENGTH)),
      });
    }
  }
  return answered;
});

export function crossable(answers: ReadonlyMap<string, NameAnswer>): string[] {
  return [...answers].flatMap(([name, answer]) => (answer.kind === 'absent' ? [name] : []));
}

export type ElsewhereRef = { readonly ref: RefElsewhere; readonly global: boolean };

export type ElsewhereAnswer = {
  readonly found: ReadonlyMap<string, ElsewhereRef>;
  readonly settled: ReadonlySet<string>;
};

const unique = (held: ReadonlyMap<string, RefElsewhere> | undefined): RefElsewhere | undefined =>
  held?.size === 1 ? [...held.values()][0] : undefined;

const machineGlobal = Effect.fnUntraced(function* (db: StoreDb<'graph'>, globalId: number, names: readonly string[]) {
  const found = new Map<string, ElsewhereRef>();
  for (const [name, answer] of yield* answeredNames(db, globalId, names)) {
    if (answer.kind === 'block')
      found.set(name, {
        ref: { name: answer.name, identity: answer.identity, project: '', projectId: globalId, branch: null },
        global: true,
      });
  }
  return { found, settled: new Set<string>() };
});

export const elsewhereNames = Effect.fn('elsewhereNames')(function* (
  db: StoreDb<'graph'>,
  projects: Projects['Service'],
  projectId: number,
  names: readonly string[],
): Effect.fn.Return<ElsewhereAnswer, StoreFailure> {
  if (names.length === 0) return { found: new Map(), settled: new Set() };
  const global = yield* projects.global();
  const pool = yield* RoutedGraphs;
  if (pool === null)
    return global === undefined || global.id === projectId
      ? { found: new Map(), settled: new Set() }
      : yield* machineGlobal(db, global.id, names);
  const listedProjects = yield* projects.list();
  const others = [
    ...listedProjects.filter((row) => row.id !== projectId),
    ...(global === undefined || global.id === projectId || listedProjects.some((row) => row.id === global.id) ? [] : [global]),
  ];
  if (others.length === 0) return { found: new Map(), settled: new Set(names) };
  const listed = yield* pool
    .titles({ projectIds: others.map((row) => row.id), names: [...names], settle: false })
    .pipe(Effect.catchTag('GateRefusal', () => Effect.succeed(null)));
  if (listed === null) return { found: new Map(), settled: new Set() };
  const titled = new Map(others.map((row) => [row.id, row.name] as const));
  const blind = new Set([...listed.unreadable.flatMap((copy) => copy.names), ...(listed.unindexed.length > 0 ? names : [])]);
  const inGlobal = new Map<string, Map<string, RefElsewhere>>();
  const inOthers = new Map<string, Map<string, RefElsewhere>>();
  for (const row of listed.titles) {
    if (row.trashed) continue;
    const into = row.projectId === global?.id ? inGlobal : inOthers;
    const held = into.get(row.name) ?? new Map<string, RefElsewhere>();
    const key = `${row.projectId}:${row.uuid}`;
    if (held.get(key)?.branch === null) continue;
    held.set(key, {
      name: blockName(row.uuid),
      identity: blockIdentity(row.uuid),
      project: titled.get(row.projectId) ?? '',
      projectId: row.projectId,
      branch: row.canonical ? null : row.branch,
    });
    into.set(row.name, held);
  }
  const found = new Map<string, ElsewhereRef>();
  for (const name of names) {
    const there = unique(inGlobal.get(name));
    const elsewhere = unique(inOthers.get(name));
    if (there !== undefined) found.set(name, { ref: there, global: true });
    else if (elsewhere !== undefined) found.set(name, { ref: elsewhere, global: false });
  }
  return { found, settled: new Set(names.filter((name) => !blind.has(name) && !inGlobal.has(name) && !inOthers.has(name))) };
});
