import { Clock, Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { LineHunk } from '@runlith/files/hunk';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import { fromJson } from '../../platform/store/rows.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { workspaceChange, workspaceChangeContent, workspaceChangeText, type RowState } from '../store/tables.js';

export type RowHolder = { readonly projectId: number; readonly holder: string };

export type Version = { readonly digest: string; readonly text: string };

export type RowFact = {
  readonly place: PlacedPath;
  readonly projectId: number;
  readonly origin: 'edit' | 'write' | 'delete';
  readonly provenance?: NonNullable<typeof workspaceChange.$inferSelect.provenance>;
  readonly mode: string | null;
  readonly hunk: LineHunk | null;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly at: Date;
  readonly movedFrom?: string | null;
  readonly reverts?: readonly string[] | null;
  readonly key?: string | null;
};

const OPERATOR_KEY = holderKey(OPERATOR);

const CONTENT_COLUMNS = [
  workspaceChangeContent.digest,
  workspaceChangeContent.text,
  workspaceChangeContent.bytes,
  workspaceChangeContent.at,
];

export const VERSION_COLUMNS = CONTENT_COLUMNS.length;

export const keepVersions = Effect.fnUntraced(function* (db: MachineStore['Service']['db'], versions: readonly Version[]) {
  if (versions.length === 0) return;
  const at = new Date(yield* Clock.currentTimeMillis);
  const rows = versions.map((version) => [version.digest, version.text, Buffer.byteLength(version.text, 'utf8'), at]);
  yield* db.run(sql`insert into ${workspaceChangeContent} ${fromJson(CONTENT_COLUMNS, rows)} on conflict do nothing`);
});

const ROW_COLUMNS = [
  workspaceChange.id,
  workspaceChange.projectId,
  workspaceChange.holderProjectId,
  workspaceChange.holder,
  workspaceChange.runId,
  workspaceChange.checkout,
  workspaceChange.path,
  workspaceChange.movedFrom,
  workspaceChange.head,
  workspaceChange.state,
  workspaceChange.origin,
  workspaceChange.provenance,
  workspaceChange.mode,
  workspaceChange.firstLine,
  workspaceChange.lines,
  workspaceChange.oldLines,
  workspaceChange.windowBefore,
  workspaceChange.reverts,
  workspaceChange.beforeHash,
  workspaceChange.afterHash,
  workspaceChange.recordKey,
  workspaceChange.at,
];

const TEXT_COLUMNS = [workspaceChangeText.row, workspaceChangeText.oldText, workspaceChangeText.newText];

const valuesOf = (work: RowHolder, runId: string | null, head: string | null, state: RowState, row: RowFact, key: string) => [
  uuidv7(),
  row.projectId,
  work.holder === OPERATOR_KEY ? null : work.projectId,
  work.holder,
  runId,
  row.place.checkout,
  row.place.path,
  row.movedFrom ?? null,
  head,
  state,
  row.origin,
  row.provenance ?? 'typed',
  row.mode,
  row.hunk?.firstLine ?? null,
  row.hunk?.newLines ?? null,
  row.hunk?.oldLines ?? null,
  row.hunk?.windowBefore ?? null,
  row.reverts ?? null,
  row.beforeHash,
  row.origin === 'delete' ? null : row.afterHash,
  key,
  row.at,
];

export const insertRows = Effect.fnUntraced(function* (
  db: MachineStore['Service']['db'],
  work: RowHolder,
  runId: string | null,
  state: RowState,
  rows: readonly { readonly head: string | null; readonly row: RowFact }[],
): Effect.fn.Return<readonly (string | null)[], StoreFailure> {
  const keyed = rows.map(({ head, row }) => ({ head, row, key: row.key ?? crypto.randomUUID() }));
  const ids = new Map<string, string>();
  for (const page of pagesOf(keyed, ROW_COLUMNS.length)) {
    const inserted = yield* db.all<{ readonly id: string; readonly record_key: string | null }>(
      sql`insert into ${workspaceChange} ${fromJson(
        ROW_COLUMNS,
        page.map(({ head, row, key }) => valuesOf(work, runId, head, state, row, key)),
      )} on conflict (${sql.identifier(workspaceChange.holder.name)}, ${sql.identifier(workspaceChange.recordKey.name)}) do nothing returning ${sql.identifier(workspaceChange.id.name)}, ${sql.identifier(workspaceChange.recordKey.name)}`,
    );
    for (const one of inserted) if (one.record_key !== null) ids.set(one.record_key, one.id);
  }
  const texts = keyed.flatMap(({ row, key }) => {
    const id = ids.get(key);
    const oldText = row.hunk?.oldText ?? null;
    const newText = row.origin === 'delete' ? null : (row.hunk?.newText ?? null);
    return id === undefined || (oldText === null && newText === null) ? [] : [[id, oldText, newText] as const];
  });
  for (const page of pagesOf(texts, TEXT_COLUMNS.length, ([, oldText, newText]) => (oldText?.length ?? 0) + (newText?.length ?? 0)))
    yield* db.run(sql`insert into ${workspaceChangeText} ${fromJson(TEXT_COLUMNS, page)}`);
  return keyed.map(({ key }) => ids.get(key) ?? null);
});

export const insertRow = Effect.fnUntraced(function* (
  db: MachineStore['Service']['db'],
  work: RowHolder,
  runId: string | null,
  head: string | null,
  state: RowState,
  row: RowFact,
): Effect.fn.Return<string | null, StoreFailure> {
  const [id] = yield* insertRows(db, work, runId, state, [{ head, row }]);
  return id ?? null;
});
