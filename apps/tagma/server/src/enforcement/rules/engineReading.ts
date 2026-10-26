import type { Figure } from '@tagma/inspection/rule';
import {
  type CursorRefusal,
  keyOrder,
  mintCursor,
  page,
  type PageFamily,
  type PageKey,
  type PageQuestion,
  pageRows,
  pastKey,
  readCursor,
  recallSelection,
  walkQuestion,
} from '@runlith/paging';
import { Effect, Result, Schema } from 'effect';
import { BlockNames, type BlockRow } from '../../graph/contract/service/acts.js';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import type { Escape } from '../../graph/contract/wire/enforcement.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { generalFix, inspectionBase } from '../contract/wire/enforcement.js';
import { isUnrun } from '../contract/wire/document.js';
import {
  type AnsweredFigure,
  DEBT,
  type DebtRow,
  type Engine,
  type EngineList,
  ESCAPES,
  type Neighbourhood,
  type OwnerRow,
  REFUSALS,
  type RefusalPlaces,
  UNITS,
  type UnitRow,
} from '../contract/wire/engines.js';
import { positionOf } from '../refusals/record.js';
import { ownerStanding } from './predicate.js';
import { digest, documentRevision } from './revision.js';
import { figuresOf, refusalsHere, type Ruled, ruledIn, rowOf, storyAt } from './engines.js';

type ModulesFigure = Extract<Figure, { readonly kind: 'modules' }>;

type Rows<T> = { readonly rows: readonly T[]; readonly total: number; readonly next: string | null };

const OPERATION = 'read_enforcement';

const ASCENDING = ['asc', 'asc'] as const;

const notEnforced = (name: string) =>
  new GateRefusal('not-enforced', `${name} carries no enforcement, so no engine runs it`, [
    'read_enforcement without `rule` lists the enforced rules of this project',
  ]);

const standingOf = (ruled: Ruled, list: EngineList): string | null => {
  const { document } = ruled;
  if (document === null || list === 'refusals') return null;
  if (list === 'debt') return digest([documentRevision(document), document.debt.map((entry) => [entry.fingerprint, entry.owner])]);
  if (list === 'escaped') return digest([documentRevision(document), document.escaped.map((entry) => entry.fingerprint)]);
  return digest([documentRevision(document), document.check]);
};

type PagedList = Exclude<EngineList, 'rules'>;

const listFamily: Readonly<Record<PagedList, PageFamily>> = {
  debt: DEBT,
  refusals: REFUSALS,
  escaped: ESCAPES,
  units: UNITS,
};

const walkOf = (list: PagedList) => ({
  operation: OPERATION,
  order: listFamily[list].order,
  selection: Schema.Struct({
    projectId: Schema.Number,
    list: Schema.Literal(list),
    rule: Schema.String,
    revision: Schema.optional(Schema.String),
  }),
  key: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
});

const LIST_WALKS: Readonly<Record<PagedList, ReturnType<typeof walkOf>>> = {
  debt: walkOf('debt'),
  refusals: walkOf('refusals'),
  escaped: walkOf('escaped'),
  units: walkOf('units'),
};

const carriedList = (cursor: string): { readonly list: PagedList } | { readonly refused: CursorRefusal } => {
  const readings = Object.values(LIST_WALKS).map((walk) => recallSelection(walk, cursor));
  for (const reading of readings) if ('selection' in reading) return { list: reading.selection.list };
  return {
    refused: readings.some((reading) => 'refused' in reading && reading.refused === 'cursor-stale') ? 'cursor-stale' : 'bad-cursor',
  };
};

const listQuestion = (projectId: number, ruled: Ruled, list: PagedList): PageQuestion =>
  walkQuestion(LIST_WALKS[list], { projectId, list, rule: ruled.name, revision: standingOf(ruled, list) ?? undefined });

const cutOf = <T>(
  rows: readonly T[],
  keyOf: (row: T) => PageKey,
  question: PageQuestion,
  family: PageFamily,
  asked: number | undefined,
  at: PageKey | undefined,
): Rows<T> => {
  const sorted = rows.toSorted((left, right) => keyOrder(ASCENDING)(keyOf(left), keyOf(right)));
  const cut = page({
    rows: at === undefined ? sorted : pastKey(sorted, keyOf, ASCENDING, at),
    asked: pageRows(asked, family, ceilingOf(family)),
    keyOf,
    question,
    total: sorted.length,
  });
  return { rows: cut.rows, total: sorted.length, next: cut.next };
};

const debtKey = (row: DebtRow): PageKey => [row.owner, row.fingerprint];

const escapeKey = (row: Escape): PageKey => [row.path, row.fingerprint];

const unitKey = (row: UnitRow): PageKey => [row.id];

const debtRows = (ruled: Ruled): readonly DebtRow[] =>
  (ruled.document?.debt ?? []).map((entry) => ({
    fingerprint: entry.fingerprint,
    file: ruled.measured?.sources?.[entry.fingerprint] ?? null,
    owner: entry.owner,
    value: entry.value ?? null,
    count: entry.count ?? null,
  }));

const generalOf = (ruled: Ruled): string | null =>
  ruled.document === null || isUnrun(ruled.document.check) ? null : generalFix(ruled.document.check);

const escapedRows = (ruled: Ruled): readonly Escape[] => ruled.document?.escaped ?? [];

const modulesOf = (figures: readonly Figure[]): ModulesFigure | undefined =>
  figures.find((figure): figure is ModulesFigure => figure.kind === 'modules');

const unitRows = (figure: ModulesFigure): readonly UnitRow[] =>
  figure.modules.map((one) => ({
    id: one.id,
    territory: one.territory.length,
    entries: one.entries === null ? null : one.entries.length,
    imports: figure.relations.filter((relation) => relation.from === one.id).length,
    importedBy: figure.relations.filter((relation) => relation.to === one.id).length,
  }));

const neighbourhoodOf = (figure: ModulesFigure, focus: string): Neighbourhood | null => {
  const found = figure.modules.find((one) => one.id === focus);
  if (found === undefined) return null;
  return {
    module: found.id,
    territory: found.territory,
    entries: found.entries,
    imports: figure.relations.filter((one) => one.from === found.id).map(({ to, role }) => ({ to, role })),
    importedBy: figure.relations.filter((one) => one.to === found.id).map(({ from, role }) => ({ from, role })),
  };
};

const moduleAt = (figure: ModulesFigure, base: string, file: string): string | null => {
  const local = base === '' ? file : file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
  let best: { readonly id: string; readonly length: number } | null = null;
  for (const one of figure.modules) {
    for (const owned of one.territory) {
      const covers = owned.endsWith('/') ? local.startsWith(owned) : local === owned;
      if (covers && (best === null || owned.length > best.length)) best = { id: one.id, length: owned.length };
    }
  }
  return best?.id ?? null;
};

const answered = (figures: readonly Figure[], focus: string | null): readonly AnsweredFigure[] =>
  figures.map((figure) =>
    figure.kind === 'modules'
      ? {
          kind: 'modules',
          modules: figure.modules.length,
          relations: figure.relations.length,
          focus: focus === null ? null : neighbourhoodOf(figure, focus),
        }
      : figure,
  );

const ownersOf = Effect.fn('enforcement.ownersOf')(function* (projectId: number, ruled: Ruled, shown: readonly DebtRow[]) {
  const names = [...new Set(shown.map((row) => row.owner))];
  if (names.length === 0) return [] as OwnerRow[];
  const table = yield* (yield* Tags).of(projectId);
  const ids = yield* (yield* BlockNames).idsOfNames(names);
  const blocks = yield* Blocks;
  const entries = (name: string) => (ruled.document?.debt ?? []).filter((entry) => entry.owner === name).length;
  const owners: OwnerRow[] = [];
  for (const name of names) {
    const id = ids.get(name);
    const read = id === undefined ? undefined : yield* Effect.result(blocks.blockById(id));
    if (read === undefined || Result.isFailure(read)) {
      if (read !== undefined && !(read.failure instanceof GateRefusal)) return yield* Effect.fail(read.failure);
      owners.push({ name, title: '', status: null, standing: 'missing', entries: entries(name) });
      continue;
    }
    const row: BlockRow = read.success;
    owners.push({
      name,
      title: row.title,
      status: table.statusOf(row),
      standing: yield* ownerStanding(table, row),
      entries: entries(name),
    });
  }
  return owners;
});

const refusalPage = Effect.fn('enforcement.refusalPage')(function* (
  projectId: number,
  ruled: Ruled,
  asked: number | undefined,
  at: PageKey | undefined,
) {
  const record = yield* refusalsHere;
  const limit = pageRows(asked, REFUSALS, ceilingOf(REFUSALS));
  const after = at === undefined ? null : { at: Number(at[0]), id: Number(at[1]) };
  const rows = yield* record.places(projectId, ruled.name, after, limit + 1);
  const shown = rows.slice(0, limit);
  const last = shown.at(-1);
  const position = last === undefined ? null : positionOf(last);
  const counted = yield* record.counted(projectId, ruled.name);
  return {
    rows: shown,
    total: counted.places,
    times: counted.times,
    next:
      rows.length > limit && position !== null ? mintCursor(listQuestion(projectId, ruled, 'refusals'), [position.at, position.id]) : null,
  } satisfies RefusalPlaces;
});

export const engineReading = Effect.fn('enforcement.engineReading')(function* (input: {
  readonly projectId: number;
  readonly row: BlockRow;
  readonly focus: string | undefined;
  readonly asked: number | undefined;
  readonly cursor: string | undefined;
}) {
  const { projectId, row } = input;
  const name = blockName(row.uuid);
  const ruled = (yield* ruledIn(projectId)).find((one) => one.uuid === row.uuid);
  if (ruled === undefined) return yield* notEnforced(name);
  const figures = ruled.document === null ? [] : figuresOf(ruled.document.check);
  const modules = modulesOf(figures);
  const base = ruled.document === null ? '' : inspectionBase(ruled.document.check);
  if (input.cursor !== undefined) {
    const carried = carriedList(input.cursor);
    if ('refused' in carried) return yield* cursorRefusal(carried.refused);
    const { list } = carried;
    const continued = readCursor(input.cursor, listQuestion(projectId, ruled, list));
    if ('refused' in continued) return yield* cursorRefusal(continued.refused);
    const norm = { rule: name, title: ruled.title, strictness: ruled.document?.strictness, generalFix: generalOf(ruled) };
    if (list === 'refusals') return { rule: name, norm, refusals: yield* refusalPage(projectId, ruled, input.asked, continued.at) };
    if (list === 'debt') {
      const debt = cutOf(debtRows(ruled), debtKey, listQuestion(projectId, ruled, 'debt'), DEBT, input.asked, continued.at);
      return { rule: name, debt, owners: yield* ownersOf(projectId, ruled, debt.rows) };
    }
    if (list === 'escaped')
      return {
        rule: name,
        norm,
        escaped: cutOf(escapedRows(ruled), escapeKey, listQuestion(projectId, ruled, 'escaped'), ESCAPES, input.asked, continued.at),
      };
    return {
      rule: name,
      units: cutOf(
        modules === undefined ? [] : unitRows(modules),
        unitKey,
        listQuestion(projectId, ruled, 'units'),
        UNITS,
        input.asked,
        continued.at,
      ),
    };
  }
  const record = yield* refusalsHere;
  const newest = (yield* record.newest(projectId, [ruled.name])).get(ruled.name);
  const story = yield* storyAt(ruled);
  const debt = cutOf(debtRows(ruled), debtKey, listQuestion(projectId, ruled, 'debt'), DEBT, input.asked, undefined);
  const focus = input.focus ?? (modules === undefined || newest === undefined ? null : moduleAt(modules, base, newest.file));
  const engine: Engine = {
    row: rowOf(ruled, newest, story),
    generalFix: generalOf(ruled),
    base,
    figures: answered(figures, focus),
    owners: yield* ownersOf(projectId, ruled, debt.rows),
    history: story.history,
    historyEnds: story.ends,
    revision: ruled.document === null ? null : documentRevision(ruled.document),
    changed: story.changed,
  };
  return {
    rule: name,
    engine,
    debt,
    refusals: yield* refusalPage(projectId, ruled, input.asked, undefined),
    escaped: cutOf(escapedRows(ruled), escapeKey, listQuestion(projectId, ruled, 'escaped'), ESCAPES, input.asked, undefined),
    units:
      modules === undefined
        ? undefined
        : cutOf(unitRows(modules), unitKey, listQuestion(projectId, ruled, 'units'), UNITS, input.asked, undefined),
  };
});
