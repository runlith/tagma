import type { Database, Statement } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { Schema } from 'effect';
import { openQueryOnly } from '../../platform/store/queryOnly.js';
import { TitleNames } from '../contract/wire/references.js';
import { type Phase, type PhaseWords, phaseWordsSchema } from '../contract/wire/far.js';
import { phaseWordsKey, vocabularyRevisionKey } from '../contract/wire/storage.js';
import type {
  CopyIndexReading,
  CopyRead,
  CopyRoot,
  IndexAnswer,
  IndexAsk,
  IndexedCopyAsk,
  IndexedName,
  IndexQuestion,
  OutgoingRow,
  PointerRow,
  TargetRow,
  WorkRow,
} from './copyIndex.js';
import { openWork } from '../contract/wire/openWork.js';

declare const self: Worker;

const KEPT = 128;

const NAMED = `select uuid, title, deleted_at is not null as trashed from block
  where substr(replace(uuid, '-', ''), -8) in (select value from json_each(?1)) and project_id = ?2`;

const ROOT = `select uuid, title from block b where project_id = ?1 and parent_id is null and deleted_at is null
  and not exists (select 1 from block_tag t where t.block_id = b.id) limit 1`;

const SUPERSEDED = `exists (select 1 from edge s where s.kind = 'supersedes' and s.to_id = b.id)`;

const TARGETS = `select b.id, b.uuid, b.title, b.deleted_at is not null as trashed, ${SUPERSEDED} as superseded from block b
  where b.uuid in (select value from json_each(?1)) and b.project_id = ?2`;

const POINTING = `select b.id, b.uuid as source, b.title, f.kind, f.uuid as target, f.created_at as at, ${SUPERSEDED} as superseded
  from far_edge f join block b on b.id = f.from_id
  where f.graph = ?1 and b.project_id = ?2 and b.deleted_at is null
    and (?3 is null or f.uuid in (select value from json_each(?3)))`;

const OUT_LOCAL = `select b.uuid as source, t.uuid as target from edge e join block b on b.id = e.from_id join block t on t.id = e.to_id
  where e.kind = ?1 and b.project_id = ?3 and b.uuid in (select value from json_each(?2))`;

const OUT_FAR = `select b.uuid as source, f.graph, f.uuid as target from far_edge f join block b on b.id = f.from_id
  where f.kind = ?1 and b.project_id = ?3 and b.uuid in (select value from json_each(?2))`;

const FIELDS = `select block_id, tag, name, value from block_field where block_id in (select value from json_each(?1))`;

const META = `select value from meta where key = ?1`;

type Named = { uuid: string; title: string; trashed: number };
type Rooted = { uuid: string; title: string };
type Targeted = { id: number; uuid: string; title: string; trashed: number; superseded: number };
type Pointed = { id: number; source: string; title: string; kind: string; target: string; at: number; superseded: number };
type Linked = { source: string; graph?: string; target: string };
type Worked = { uuid: string; open: number };
type Field = { block_id: number; tag: string; name: string; value: string };

type Held = {
  readonly db: Database;
  readonly ino: number;
  readonly statements: Map<string, Statement>;
  words?: { readonly raw: string; readonly value: PhaseWords | null };
};

const held = new Map<string, Held>();

const decodePhaseWords = Schema.decodeUnknownOption(Schema.fromJsonString(phaseWordsSchema));

const forget = (mirror: string): void => {
  held.get(mirror)?.db.close();
  held.delete(mirror);
};

const absent = (cause: unknown): boolean => {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const unbuilt = (cause: unknown): boolean => cause instanceof Error && /no such (table|column)/u.test(cause.message);

const opened = (mirror: string, ino: number): Held => {
  const known = held.get(mirror);
  if (known !== undefined && known.ino === ino) return known;
  forget(mirror);
  const fresh = { db: openQueryOnly(mirror), ino, statements: new Map<string, Statement>() };
  held.set(mirror, fresh);
  return fresh;
};

const query = <Row>(copy: Held, text: string): Statement<Row, never[]> => {
  const known = copy.statements.get(text);
  if (known !== undefined) return known as unknown as Statement<Row, never[]>;
  const prepared = copy.db.query(text);
  copy.statements.set(text, prepared as unknown as Statement);
  return prepared as unknown as Statement<Row, never[]>;
};

const all = <Row>(copy: Held, text: string, ...bound: (string | number | null)[]): Row[] =>
  (query<Row>(copy, text) as unknown as Statement<Row, (string | number | null)[]>).all(...bound);

const one = <Row>(copy: Held, text: string, ...bound: (string | number | null)[]): Row | null =>
  (query<Row>(copy, text) as unknown as Statement<Row, (string | number | null)[]>).get(...bound);

const decodedOf = (copy: Held, raw: string): PhaseWords | null => {
  if (copy.words?.raw === raw) return copy.words.value;
  const decoded = decodePhaseWords(raw);
  const value = decoded._tag === 'None' ? null : decoded.value;
  copy.words = { raw, value };
  return value;
};

const phaseWordsOf = (copy: Held, projectId: number): PhaseWords | null => {
  const published = one<{ value: string }>(copy, META, phaseWordsKey(projectId));
  if (published === null) return null;
  const words = decodedOf(copy, published.value);
  if (words === null) return null;
  const revision = one<{ value: string }>(copy, META, vocabularyRevisionKey(projectId))?.value ?? '0';
  return words.revision === revision ? words : null;
};

const PHASE_ORDER: readonly Phase[] = ['terminal', 'active', 'initial'];

const phasesOf = (copy: Held, words: PhaseWords | null, contract: string, ids: readonly number[]): Map<number, Phase> => {
  const phases = new Map<number, Phase>();
  const sets = words?.contracts[contract];
  if (sets === undefined || ids.length === 0) return phases;
  const fields = all<Field>(copy, FIELDS, JSON.stringify(ids));
  for (const phase of PHASE_ORDER) {
    for (const field of fields) {
      if (phases.has(field.block_id)) continue;
      if (sets[phase].some((set) => set.tag === field.tag && set.name === field.name && set.words.includes(field.value))) {
        phases.set(field.block_id, phase);
      }
    }
  }
  return phases;
};

const titlesOf = (copy: Held, ask: IndexedCopyAsk, names: TitleNames, tails: string): CopyIndexReading => {
  const rows: IndexedName[] = [];
  for (const row of all<Named>(copy, NAMED, tails, ask.projectId)) {
    for (const name of names.matches(row.uuid, ask.projectId))
      rows.push({ name, uuid: row.uuid, title: row.title, trashed: row.trashed === 1 });
  }
  return { kind: 'titles', rows };
};

type FarQuestion = Exclude<IndexQuestion, { readonly ask: 'titles' }>;

const farOf = (copy: Held, ask: IndexedCopyAsk, question: FarQuestion): CopyRead<TargetRow | PointerRow | OutgoingRow | WorkRow> => {
  const root: CopyRoot | null = one<Rooted>(copy, ROOT, ask.projectId);
  let words: PhaseWords | null | undefined;
  const wordsNow = () => (words === undefined ? (words = phaseWordsOf(copy, ask.projectId)) : words);
  const read = (rows: readonly (TargetRow | PointerRow | OutgoingRow | WorkRow)[]) => ({
    kind: 'read' as const,
    root,
    phased: question.ask === 'outgoing' || rows.length === 0 || wordsNow() !== null,
    rows,
  });
  switch (question.ask) {
    case 'targets': {
      const uuids = root === null ? [] : question.targets.flatMap((target) => (target.graph === root.uuid ? [target.uuid] : []));
      if (uuids.length === 0) return read([]);
      const found = all<Targeted>(copy, TARGETS, JSON.stringify(uuids), ask.projectId);
      const phases = phasesOf(
        copy,
        found.length === 0 ? null : wordsNow(),
        question.contract,
        found.map((row) => row.id),
      );
      return read(
        found.map((row) => ({
          uuid: row.uuid,
          title: row.title,
          trashed: row.trashed === 1,
          superseded: row.superseded === 1,
          phase: phases.get(row.id) ?? null,
        })),
      );
    }
    case 'pointing': {
      if (root === null || root.uuid === question.graph) return read([]);
      const found = all<Pointed>(
        copy,
        POINTING,
        question.graph,
        ask.projectId,
        question.uuids === null ? null : JSON.stringify(question.uuids),
      );
      const phases = phasesOf(
        copy,
        found.length === 0 ? null : wordsNow(),
        question.contract,
        found.map((row) => row.id),
      );
      return read(
        found.map((row) => ({
          from: row.source,
          title: row.title,
          kind: row.kind,
          to: row.target,
          at: row.at,
          superseded: row.superseded === 1,
          phase: phases.get(row.id) ?? null,
        })),
      );
    }
    case 'work': {
      if (root?.uuid !== question.graph || question.uuids.length === 0) return read([]);
      const sets = wordsNow()?.contracts[question.contract];
      if (sets === undefined) return { kind: 'read', root, phased: false, rows: [] };
      const work = openWork({ open: [...sets.initial, ...sets.active], kinds: question.kinds });
      const named = `select id from block where uuid in (select value from json_each(?1)) and project_id = ?2`;
      const found = all<Worked>(
        copy,
        `with recursive ${work.below(named)} select b.uuid as uuid, ${work.hasOpenWork('b.id')} as open from block b where b.id in (${named})`,
        JSON.stringify(question.uuids),
        ask.projectId,
      );
      return read(found.map((row) => ({ uuid: row.uuid, open: row.open === 1 })));
    }
    case 'outgoing': {
      if (root?.uuid !== question.graph) return read([]);
      const uuids = JSON.stringify(question.uuids);
      const local = all<Linked>(copy, OUT_LOCAL, question.kind, uuids, ask.projectId);
      const far = all<Linked>(copy, OUT_FAR, question.kind, uuids, ask.projectId);
      return read([
        ...local.map((row) => ({ from: row.source, graph: question.graph, to: row.target })),
        ...far.map((row) => ({ from: row.source, graph: row.graph ?? question.graph, to: row.target })),
      ]);
    }
  }
};

const readCopy = <Reading>(ask: IndexedCopyAsk, read: (copy: Held) => Reading): Reading | CopyIndexReading => {
  let ino: number;
  try {
    ino = statSync(ask.mirror).ino;
  } catch (cause) {
    if (!absent(cause)) return { kind: 'unreadable', reason: String(cause) };
    forget(ask.mirror);
    return { kind: 'unindexed' };
  }
  try {
    return read(opened(ask.mirror, ino));
  } catch (cause) {
    forget(ask.mirror);
    if (unbuilt(cause)) return { kind: 'unindexed' };
    return { kind: 'unreadable', reason: cause instanceof Error ? cause.message : String(cause) };
  }
};

self.addEventListener('message', (event: MessageEvent<IndexAsk>) => {
  const { id, copies, question } = event.data;
  let readings: readonly unknown[];
  if (question.ask === 'titles') {
    const names = new TitleNames(question.names);
    const tails = JSON.stringify(names.tails);
    readings = copies.map((ask) => readCopy(ask, (copy) => titlesOf(copy, ask, names, tails)));
  } else {
    readings = copies.map((ask) => readCopy(ask, (copy) => farOf(copy, ask, question)));
  }
  const kept = new Set(copies.slice(0, KEPT).map((copy) => copy.mirror));
  for (const mirror of [...held.keys()]) if (held.size > KEPT && !kept.has(mirror)) forget(mirror);
  self.postMessage({ id, readings } satisfies IndexAnswer);
});
