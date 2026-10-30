import { shows } from '@tagma/inspection/builtins';
import { CONCERNS, type Figure } from '@tagma/inspection/rule';
import { keyOrder, page, type PageKey, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect, Option, Schema } from 'effect';
import type { ActEntry, BlockRecord } from '../../graph/contract/service/acts.js';
import type { Delivery, LawReach } from '../../graph/contract/wire/tags/law.js';
import { GraphJournal } from '../../graph/contract/service/journal.js';
import { Orientation } from '../../graph/contract/service/orientation.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { type Check, isLinter, isProgrammed, isUnrun, type Law } from '../contract/wire/document.js';
import { placeOf } from './measure.js';
import { inspectionBase, type Measurement } from '../contract/wire/enforcement.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { measurementsOf } from './measurements.js';
import {
  type Checker,
  ENGINES,
  type EngineRow,
  type HistoryPoint,
  type RefusalRow,
  type RuleChange,
  type RuleCounts,
} from '../contract/wire/engines.js';
import { refusalRecord } from '../refusals/record.js';
import { enforcedRules, enforcedStatutes, switchedOffStatutes } from './reach.js';
import { formOf } from './forms.js';
import { digest, documentRevision } from './revision.js';

export const HISTORY_ACTS = 40;

const HISTORY_POINTS = 12;

const JOURNALED = ['enforce', 'remeasure'] as const;

export type Ruled = {
  readonly name: string;
  readonly uuid: string;
  readonly title: string;
  readonly blockId: number | null;
  readonly document: Law | null;
  readonly unreadable: string | null;
  readonly places: readonly string[];
  readonly delivery: Delivery;
  readonly measured: Measurement | null;
};

export type Story = {
  readonly history: readonly HistoryPoint[];
  readonly was: { readonly count: number; readonly until: string } | null;
  readonly ends: string | null;
  readonly changed: RuleChange | null;
};

const EnforceAct = Schema.Struct({
  debtBefore: Schema.optional(Schema.Array(Schema.Unknown)),
  debtAfter: Schema.optional(Schema.Array(Schema.Unknown)),
  was: Schema.optionalKey(Schema.Unknown),
});

const RemeasureAct = Schema.Struct({ retired: Schema.optional(Schema.Array(Schema.Unknown)) });

const enforceAct = Schema.decodeUnknownOption(Schema.fromJsonString(EnforceAct));

const remeasureAct = Schema.decodeUnknownOption(Schema.fromJsonString(RemeasureAct));

const CONCERN_RANK: ReadonlyMap<string, number> = new Map(CONCERNS.map((one, at) => [one, at]));

export const checkerOf = (inspection: Check): Checker => {
  if (isUnrun(inspection)) return { kind: 'unread', reason: inspection.unrun };
  if (isProgrammed(inspection)) {
    const { program } = inspection;
    return isLinter(program)
      ? { kind: 'linter', tool: program.linter.tool, rule: 'rule' in program ? program.rule : null }
      : { kind: 'program', name: program.name, concern: program.concern };
  }
  return { kind: 'builtin', builtin: inspection.builtin, concern: shows(inspection).concern };
};

const functionOf = (inspection: Check): string | null => {
  if (isUnrun(inspection)) return null;
  if (!isProgrammed(inspection)) return formOf(inspection)?.name ?? inspection.builtin;
  const { program } = inspection;
  return isLinter(program) ? (formOf(program)?.name ?? program.linter.tool) : program.name;
};

export const figuresOf = (inspection: Check): readonly Figure[] =>
  isUnrun(inspection) || isProgrammed(inspection) ? [] : shows(inspection).figures;

export const storyOf = (entries: readonly ActEntry[], current: number): Story => {
  let count = current;
  let was: Story['was'] = null;
  let ends: string | null = null;
  const history: HistoryPoint[] = [];
  for (const entry of entries) {
    const at = entry.ts.toISOString();
    if (entry.op === 'remeasure') {
      const act = remeasureAct(entry.payload);
      if (Option.isNone(act)) {
        ends = `journal act ${entry.id} (${entry.op}) does not decode`;
        break;
      }
      const retired = act.value.retired?.length ?? 0;
      if (retired === 0) continue;
      history.push({ at, count });
      if (was === null && count + retired !== current) was = { count: count + retired, until: at };
      count += retired;
      continue;
    }
    const act = enforceAct(entry.payload);
    if (Option.isNone(act)) {
      ends = `journal act ${entry.id} (${entry.op}) does not decode`;
      break;
    }
    const { debtBefore, debtAfter } = act.value;
    if (act.value.was === null && debtAfter !== undefined) {
      history.push({ at, count: debtAfter.length });
      return { history: history.slice(0, HISTORY_POINTS), was, ends, changed: changedOf(entries) };
    }
    if (debtBefore === undefined || debtAfter === undefined || debtBefore.length === debtAfter.length) continue;
    history.push({ at, count: debtAfter.length });
    if (was === null && debtBefore.length !== current) was = { count: debtBefore.length, until: at };
    count = debtBefore.length;
  }
  const oldest = entries.at(-1);
  if (history.length > 0 && oldest !== undefined && ends === null) history.push({ at: oldest.ts.toISOString(), count });
  return { history: history.slice(0, HISTORY_POINTS), was, ends, changed: changedOf(entries) };
};

const changedOf = (entries: readonly ActEntry[]): RuleChange | null => {
  const newest = entries[0];
  return newest === undefined ? null : { at: newest.ts.toISOString(), session: newest.sessionId, act: newest.op };
};

export const storyAt = Effect.fn('enforcement.storyAt')(function* (ruled: Ruled) {
  const count = ruled.document?.debt.length ?? 0;
  if (ruled.blockId === null) return storyOf([], count);
  const entries = yield* (yield* GraphJournal).events({ blockId: ruled.blockId, ops: JOURNALED, limit: HISTORY_ACTS });
  return storyOf(entries, count);
});

export const ruledIn = Effect.fn('enforcement.ruledIn')(function* (projectId: number) {
  const ruled: Ruled[] = [];
  const statutes = yield* enforcedStatutes(projectId);
  if (statutes.length === 0) return ruled;
  const root = yield* measuredRoot(yield* (yield* Projects).byId(projectId));
  const { head, commonDir, shelf } = yield* placeOf(root);
  const entries = yield* enforcedRules(
    projectId,
    { projectId, actor: { _tag: 'Operator' }, root, tree: head, commonDir },
    undefined,
    statutes,
  );
  const reaches = yield* (yield* Orientation).ruleReach(projectId);
  const measured = yield* measurementsOf(
    root,
    entries.map((entry) => entry.rule.uuid),
    shelf,
  );
  for (const entry of entries) {
    ruled.push({
      name: blockName(entry.rule.uuid),
      uuid: entry.rule.uuid,
      title: entry.rule.title,
      blockId: entry.rule.id,
      document: entry.document,
      unreadable: entry.document === null ? entry.unreadable.reason : null,
      places: entry.document === null ? yield* entry.reach('') : yield* entry.reach(inspectionBase(entry.document.check)),
      delivery: reaches.get(entry.rule.id)?.delivery ?? 'prompt',
      measured: measured.get(entry.rule.uuid) ?? null,
    });
  }
  return ruled;
});

type Followed = {
  readonly rule: BlockRecord;
  readonly enabled: boolean;
  readonly inspection: string | null;
};

const textRow = ({ rule, enabled, inspection }: Followed, reaches: LawReach): EngineRow => {
  const reach = reaches.get(rule.id);
  return {
    rule: blockName(rule.uuid),
    title: rule.title,
    places: reach?.places ?? [],
    delivery: reach?.delivery ?? 'prompt',
    enabled,
    inspection,
    function: null,
    unreadable: false,
    strictness: null,
    on: [],
    checker: null,
    debt: { count: 0, owners: 0, was: null },
    escaped: 0,
    refused: null,
    measured: null,
  };
};

const followedIn = Effect.fn('enforcement.followedIn')(function* (projectId: number, enforced: ReadonlySet<string>) {
  const orientation = yield* Orientation;
  const off = new Map(
    (yield* switchedOffStatutes(projectId)).map((one) => [one.rule.uuid, one.document === null ? null : one.document.inspection]),
  );
  return [
    ...(yield* orientation.rules(projectId))
      .filter((rule) => !enforced.has(rule.uuid))
      .map((rule): Followed => ({ rule, enabled: true, inspection: null })),
    ...(yield* orientation.rulesOff(projectId)).map((rule): Followed => ({ rule, enabled: false, inspection: off.get(rule.uuid) ?? null })),
  ];
});

export const rowOf = (ruled: Ruled, newest: RefusalRow | undefined, story: Story): EngineRow => {
  const { document } = ruled;
  return {
    rule: ruled.name,
    title: ruled.title,
    places: ruled.places,
    delivery: ruled.delivery,
    enabled: true,
    inspection: document?.inspection ?? null,
    function: document === null ? null : functionOf(document.check),
    unreadable: document === null,
    strictness: document?.strictness ?? null,
    on: document?.on ?? [],
    checker:
      document === null
        ? { kind: 'unread', reason: ruled.unreadable ?? 'its enforcement document does not decode' }
        : checkerOf(document.check),
    debt: { count: document?.debt.length ?? 0, owners: new Set(document?.debt.map((entry) => entry.owner) ?? []).size, was: story.was },
    escaped: document?.escaped.length ?? 0,
    refused: newest === undefined ? null : { at: newest.at, file: newest.file, line: newest.line, op: newest.op },
    measured: ruled.measured,
  };
};

const rankOf = (checker: Checker | null): number => {
  if (checker === null) return CONCERNS.length + 2;
  if (checker.kind === 'unread') return CONCERNS.length + 1;
  return checker.kind === 'linter' ? CONCERNS.length : (CONCERN_RANK.get(checker.concern) ?? CONCERNS.length);
};

const rowKey = (row: EngineRow): PageKey => [rankOf(row.checker), row.title, row.rule];

const ROW_ORDER = ['asc', 'asc', 'asc'] as const;

export const refusalsHere = Effect.gen(function* () {
  const store = yield* MachineStore;
  return refusalRecord(store.db, yield* MachineUnits);
});

const rulesDigest = (ruled: readonly Ruled[], followed: readonly Followed[]): string =>
  digest([
    ...ruled.map((one) => [
      one.name,
      one.title,
      one.document === null ? one.unreadable : documentRevision(one.document),
      one.measured?.commit ?? null,
    ]),
    ...followed.map((one) => [one.rule.uuid, one.rule.title, one.enabled, one.inspection]),
  ]);

const countsOf = (rules: number, ruled: readonly Ruled[]): RuleCounts => {
  const at = (strictness: string) => ruled.filter((one) => one.document?.strictness === strictness).length;
  return {
    rules,
    enforced: ruled.length,
    gate: at('gate'),
    watch: at('watch'),
    note: at('note'),
    debt: ruled.reduce((sum, one) => sum + (one.document?.debt.length ?? 0), 0),
    escaped: ruled.reduce((sum, one) => sum + (one.document?.escaped.length ?? 0), 0),
  };
};

export const rulesReading = Effect.fn('enforcement.rulesReading')(function* (
  projectId: number,
  asked: number | undefined,
  cursor: string | undefined,
) {
  const ruled = yield* ruledIn(projectId);
  const followed = yield* followedIn(projectId, new Set(ruled.map((one) => one.uuid)));
  const question: PageQuestion = {
    operation: 'read_enforcement',
    selection: { projectId, list: 'rules', set: rulesDigest(ruled, followed) },
    order: ENGINES.order,
  };
  const continued = cursor === undefined ? undefined : readCursor(cursor, question);
  if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
  const record = yield* refusalsHere;
  const newest = yield* record.newest(
    projectId,
    ruled.map((one) => one.name),
  );
  const reaches = yield* (yield* Orientation).ruleReach(projectId);
  const rows: EngineRow[] = followed.map((one) => textRow(one, reaches));
  for (const one of ruled) rows.push(rowOf(one, newest.get(one.name), yield* storyAt(one)));
  const sorted = rows.toSorted((left, right) => keyOrder(ROW_ORDER)(rowKey(left), rowKey(right)));
  const cut = page({
    rows: continued === undefined ? sorted : pastKey(sorted, rowKey, ROW_ORDER, continued.at),
    asked: pageRows(asked, ENGINES, ceilingOf(ENGINES)),
    keyOf: rowKey,
    question,
    total: sorted.length,
  });
  return {
    counts: countsOf((yield* (yield* Orientation).rules(projectId)).length, ruled),
    rules: { rows: cut.rows, total: sorted.length, next: cut.next },
  };
});
