import { Effect } from 'effect';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Git } from '@runlith/git/Git';
import { gitAnswer, OwnGitFailed } from '../../platform/git/ownGit.js';
import { AGENT_PERSON, trailed } from '../../platform/contract/wire/commits.js';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { type SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { session } from '../../platform/store/writers.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import type { ActEntry, BlockRow } from '../contract/service/acts.js';
import type { Tags } from '../contract/service/vocabulary.js';
import type { GraphEventOp } from '../contract/wire/journal.js';
import { blockName } from '../contract/wire/references.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { SPEC } from '../contract/wire/tags/spec.js';
import { WORK } from '../contract/wire/tags/work.js';
import { LAW } from '../contract/wire/tags/lawContracts.js';
import { block, event, meta } from '../store/tables.js';

const SUBJECT_LIMIT = 72;
const MIN_BATCH_TITLE = 20;
const CONVENTION_SAMPLE = 10;
const NO_HISTORY = /does not have any commits yet|not a git repository/u;
const CONVENTIONAL = /^[a-z]+(\([^()]+\))?!?: \S/u;
const PREFIX = 'docs(graph): ';
const POSITION_TRAILER = 'Tagma-Graph';
const UNTAGGED = 'note';
const PROJECT = 'project';
const IDS_PER_READ = 500;
const LANDED_SEARCH = 50;

const committing = writes('Tree.commitPosition', [meta]);

export type CommitShape = 'conventional' | 'plain';

export type TreeScope = 'team' | 'stealth' | 'whole';

const COMMITTED_KEY: Record<TreeScope, string> = {
  team: 'graph-committed',
  whole: 'graph-committed',
  stealth: 'graph-committed:stealth',
};

const KEYS = [...new Set(Object.values(COMMITTED_KEY))];

type ActLine = {
  readonly verb: string;
  readonly name: string | null;
  readonly title: string;
  readonly kind: string;
  readonly weight: number;
};

type NamedBlock = Pick<BlockRow, 'uuid' | 'title' | 'tags' | 'stealth'>;

const VERBS: Record<Exclude<GraphEventOp, 'create'>, string> = {
  project_add: 'add',
  project_set_root: 'move',
  project_set: 'set',
  project_set_storage: 'move storage of',
  project_remove: 'remove',
  project_return: 'return',
  update: 'edit',
  claim: 'claim',
  release: 'release',
  done: 'finish',
  close: 'close',
  link: 'link',
  unlink: 'unlink',
  anchor: 'anchor',
  unanchor: 'unanchor',
  relocate: 'move',
  supersede: 'supersede',
  unsupersede: 'unsupersede',
  settle: 'settle',
  delete: 'delete',
  restore: 'restore',
  enable: 'enable',
  disable: 'disable',
  enforce: 'enforce',
  remeasure: 'remeasure',
  answer: 'answer',
  unanswer: 'unanswer',
};

const weightOf = (op: GraphEventOp, node: NamedBlock, table: TagReading): number =>
  table.supports(node, SPEC) && (op === 'create' || op === 'close')
    ? 0
    : table.supports(node, WORK) && (op === 'create' || op === 'done')
      ? 1
      : table.supports(node, LAW) && op === 'create'
        ? 2
        : 3;

const named = (scope: TreeScope, node: NamedBlock): boolean => scope === 'whole' || (scope === 'stealth' ? node.stealth : !node.stealth);

const actLine = (
  entry: Pick<ActEntry, 'op' | 'blockId'>,
  blocks: ReadonlyMap<number, NamedBlock>,
  table: TagReading,
  scope: TreeScope,
): ActLine | null => {
  if (entry.blockId === null) {
    if (entry.op === 'create' || scope === 'stealth') return null;
    return { verb: VERBS[entry.op], name: null, title: '', kind: PROJECT, weight: 3 };
  }
  const node = blocks.get(entry.blockId);
  if (node === undefined || !named(scope, node)) return null;
  return {
    verb: entry.op === 'create' ? (table.supports(node, LIFECYCLE) ? 'open' : 'add') : VERBS[entry.op],
    name: blockName(node.uuid),
    title: node.title.replace(/\s+/gu, ' ').trim(),
    kind: node.tags[0] ?? UNTAGGED,
    weight: weightOf(entry.op, node, table),
  };
};

const plural = (word: string): string =>
  /(s|x|z|ch|sh)$/u.test(word) ? `${word}es` : /[^aeiou]y$/u.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

const counted = (lines: readonly ActLine[], room: number): string => {
  const groups = new Map<string, { verb: string; kind: string; weight: number; count: number; order: number }>();
  for (const line of lines) {
    const key = `${line.verb}\0${line.kind}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { verb: line.verb, kind: line.kind, weight: line.weight, count: 1, order: groups.size });
    else {
      group.count += 1;
      group.weight = Math.min(group.weight, line.weight);
    }
  }
  const ranked = [...groups.values()].sort((a, b) => a.weight - b.weight || b.count - a.count || a.order - b.order);
  const phrases = ranked.map((group) =>
    group.count === 1 ? `${group.verb} ${group.kind}` : `${group.verb} ${group.count} ${plural(group.kind)}`,
  );
  let shownActs = 0;
  let best = `${lines.length} graph changes`;
  for (let shown = 1; shown <= phrases.length; shown += 1) {
    shownActs += (ranked[shown - 1] as { count: number }).count;
    const rest = lines.length - shownActs;
    const text = `${phrases.slice(0, shown).join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
    if (text.length > room) break;
    best = text;
  }
  return best;
};

const titleWithin = (title: string, room: number): string | null => {
  if (room < 1) return null;
  if (title.length <= room) return title;
  const end = title.lastIndexOf(' ', room - 1);
  return end > 0 ? `${title.slice(0, end)}…` : null;
};

const phraseOf = (lines: readonly ActLine[], room: number): string => {
  if (lines.length === 0) return 'sync graph files';
  const top = Math.min(...lines.map((line) => line.weight));
  const leading = lines.filter((line) => line.weight === top);
  const act = leading[0] as ActLine;
  if (leading.length === 1 && act.title !== '') {
    const rest = lines.length - 1;
    const start = `${act.verb} ${act.kind} "`;
    const end = `"${rest > 0 ? ` and ${rest} more` : ''}`;
    const title = titleWithin(act.title, room - start.length - end.length);
    if (title !== null && (rest === 0 || title === act.title || title.length >= MIN_BATCH_TITLE)) return `${start}${title}${end}`;
    if (rest === 0 && act.name !== null) return `${act.verb} ${act.name}`;
  }
  return counted(lines, room);
};

const bodyLine = (line: ActLine): string => [line.verb, line.name ?? line.kind, line.title].filter((part) => part !== '').join(' ');

const worded = (lines: readonly ActLine[], shape: CommitShape, position: number): string => {
  const prefix = shape === 'conventional' ? PREFIX : '';
  const phrase = phraseOf(lines, SUBJECT_LIMIT - prefix.length);
  const subject = `${prefix}${shape === 'conventional' ? phrase : `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`}`;
  const body = lines.map(bodyLine);
  const text = body.length === 0 ? subject : `${subject}\n\n${body.join('\n')}`;
  return `${trailed(text, [[POSITION_TRAILER, String(position)]])}\n`;
};

const reachOf = (store: GraphStore['Service']): Effect.Effect<number, StoreFailure> =>
  Effect.map(
    store.db
      .select({ id: sql<number>`coalesce(max(${event.id}), 0)` })
      .from(event)
      .get(),
    (row) => row?.id ?? 0,
  );

export type CommitWords = {
  readonly reach: number;
  readonly lines: readonly ActLine[];
  readonly agents: readonly string[];
};

export const messageOf = (words: CommitWords, shape: CommitShape): string => worded(words.lines, shape, words.reach);

export type CommitJournal = {
  readonly words: Effect.Effect<CommitWords, StoreFailure>;
  readonly landing: (reach: number) => Effect.Effect<void, StoreFailure>;
  readonly committed: (reach: number) => Effect.Effect<void, StoreFailure>;
  readonly recover: (landed: (reach: number) => Effect.Effect<boolean, OwnGitFailed>) => Effect.Effect<void, StoreFailure | OwnGitFailed>;
};

export type CommitJournalOptions = {
  readonly store: GraphStore['Service'];
  readonly tags: Tags['Service'];
  readonly identity: SessionIdentity['Service'];
  readonly projectId: number;
  readonly scope: TreeScope;
};

export const commitJournal = ({ store, tags, identity, projectId, scope }: CommitJournalOptions): CommitJournal => {
  const { db } = store;
  const key = COMMITTED_KEY[scope];
  const inPages = <T>(ids: readonly number[], read: (page: number[]) => Effect.Effect<readonly T[], StoreFailure>) =>
    Effect.map(
      Effect.forEach(
        Array.from({ length: Math.ceil(ids.length / IDS_PER_READ) }, (_, at) => ids.slice(at * IDS_PER_READ, (at + 1) * IDS_PER_READ)),
        read,
      ),
      (pages) => pages.flat(),
    );
  const landingKey = `${key}:landing`;
  const stored = (at: string) => Effect.map(db.select({ value: meta.value }).from(meta).where(eq(meta.key, at)).get(), (row) => row?.value);
  const committed = (reach: number) =>
    store.transaction(committing, () =>
      Effect.andThen(
        db
          .insert(meta)
          .values({ key, value: String(reach) })
          .onConflictDoUpdate({ target: meta.key, set: { value: String(reach) } }),
        db.delete(meta).where(eq(meta.key, landingKey)),
      ),
    );
  return {
    words: Effect.gen(function* () {
      const reach = yield* reachOf(store);
      const position = yield* stored(key);
      const from = position === undefined ? reach : Math.min(Number(position), reach);
      const entries =
        from >= reach
          ? []
          : yield* db
              .select({ op: event.op, blockId: event.blockId, sessionId: event.sessionId })
              .from(event)
              .where(and(gt(event.id, from), lte(event.id, reach)))
              .orderBy(event.id);
      const ids = [...new Set(entries.flatMap((entry) => (entry.blockId === null ? [] : [entry.blockId])))];
      const rows = yield* inPages(ids, (page) =>
        db
          .select({ id: block.id, uuid: block.uuid, title: block.title, tags: block.tags, stealth: block.stealth })
          .from(block)
          .where(inArray(block.id, page)),
      );
      const blocks = new Map(rows.map((row) => [row.id, row]));
      const table = yield* tags.of(projectId);
      const lines = new Map<string, ActLine>();
      const signers = new Set<number>();
      for (const entry of entries) {
        const line = actLine(entry, blocks, table, scope);
        if (line === null) continue;
        const lineKey = `${line.verb}\0${line.name ?? line.kind}`;
        if (!lines.has(lineKey)) lines.set(lineKey, line);
        if (entry.sessionId !== null) signers.add(entry.sessionId);
      }
      const sessions = yield* inPages([...signers], (page) =>
        db.select({ id: session.id, harness: session.harness, key: session.key }).from(session).where(inArray(session.id, page)),
      );
      const spoken = new Map(sessions.map((row) => [row.id, sessionName(row, identity)]));
      const agents = [...new Set([...signers].flatMap((id) => spoken.get(id) ?? []))];
      return { reach, lines: [...lines.values()], agents };
    }),
    landing: (reach) =>
      store.transaction(committing, () =>
        db
          .insert(meta)
          .values({ key: landingKey, value: String(reach) })
          .onConflictDoUpdate({ target: meta.key, set: { value: String(reach) } }),
      ),
    committed,
    recover: Effect.fnUntraced(function* (landed) {
      const pending = yield* stored(landingKey);
      if (pending === undefined) return;
      const reach = Number(pending);
      if (yield* landed(reach)) return yield* committed(reach);
      yield* store.transaction(committing, () => db.delete(meta).where(eq(meta.key, landingKey)));
    }),
  };
};

export const landedAt =
  (git: Git['Service'], root: string) =>
  (reach: number): Effect.Effect<boolean, OwnGitFailed> =>
    Effect.flatMap(
      gitAnswer(git, 'graph-landed', [
        '-C',
        root,
        'log',
        `--max-count=${LANDED_SEARCH}`,
        `--author=${AGENT_PERSON.email}`,
        `--format=%(trailers:key=${POSITION_TRAILER},valueonly,separator=%x2C)`,
      ]),
      (answer) =>
        answer.status === 0
          ? Effect.succeed(answer.stdout.split('\n').some((line) => line.split(',').includes(String(reach))))
          : NO_HISTORY.test(answer.stderr)
            ? Effect.succeed(false)
            : Effect.fail(new OwnGitFailed({ op: 'graph-landed', message: answer.stderr.trim() || answer.stdout.trim(), ran: true })),
    );

export const coverCommitJournals = (store: GraphStore['Service']): Effect.Effect<void, StoreFailure> =>
  Effect.flatMap(reachOf(store), (reach) =>
    store.transaction(committing, () =>
      Effect.andThen(
        store.db
          .insert(meta)
          .values(KEYS.map((key) => ({ key, value: String(reach) })))
          .onConflictDoUpdate({ target: meta.key, set: { value: String(reach) } }),
        store.db.delete(meta).where(
          inArray(
            meta.key,
            KEYS.map((key) => `${key}:landing`),
          ),
        ),
      ),
    ),
  );

export const startCommitJournals = (store: GraphStore['Service']): Effect.Effect<void, StoreFailure> =>
  Effect.flatMap(reachOf(store), (reach) =>
    store.transaction(committing, () =>
      store.db
        .insert(meta)
        .values(KEYS.map((key) => ({ key, value: String(reach) })))
        .onConflictDoNothing(),
    ),
  );

export const shapeOf = (git: Git['Service'], checkout: string): Effect.Effect<CommitShape, OwnGitFailed> =>
  Effect.flatMap(
    gitAnswer(git, 'graph-shape', [
      '-C',
      checkout,
      'log',
      `--max-count=${CONVENTION_SAMPLE}`,
      '--no-merges',
      '--format=%s',
      '--',
      ':(top)',
      `:(top,exclude)${CHECKOUT_DIRECTORY}`,
    ]),
    (answer) => {
      if (answer.status !== 0) {
        return NO_HISTORY.test(answer.stderr)
          ? Effect.succeed<CommitShape>('plain')
          : Effect.fail(new OwnGitFailed({ op: 'graph-shape', message: answer.stderr.trim() || answer.stdout.trim(), ran: true }));
      }
      const subjects = answer.stdout.split('\n').filter((subject) => subject !== '');
      return Effect.succeed<CommitShape>(
        subjects.filter((subject) => CONVENTIONAL.test(subject)).length * 2 > subjects.length ? 'conventional' : 'plain',
      );
    },
  );
