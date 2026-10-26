import { Effect, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { ancestorAt } from '@runlith/git/history';
import { commitOf, headAt } from '@runlith/git/repository';
import { gitRefusal } from '../../platform/git/readings.js';
import { type SQL, inArray, sql } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { isFinishedWork, measuredCondition } from '../acts/measurement.js';
import { block, edge } from '../store/tables.js';
import { keysetOf, orderingOf, subtreeIds } from '../search/selection.js';
import { carriesContract } from '../vocabulary/projection.js';
import { REFLECTION } from '../contract/wire/tags/reflection.js';
import type { BlockQuery } from '../contract/wire/query.js';
import type { BlockPosition } from '../contract/service/reads.js';
import { type Answer, type BlockRecord, type BlockRow } from '../contract/service/acts.js';
import { Act, BlockAnswers, BlockNames } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { Reflections, type AnswerInput, type UnanswerInput } from '../contract/service/work.js';
import { measuredRoot } from '../contract/service/serving.js';
import { type FloorRefusal, GateRefusal, type GitRefusal } from '../../platform/contract/wire/refusal.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import { OBSERVATION } from '../contract/wire/tags/observation.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { blockName } from '../contract/wire/references.js';
import { writes } from '../../platform/contract/service/writes.js';

const answering = writes('Reflection.answer', []);
const unanswering = writes('Reflection.unanswer', []);

type AnswerRefusal =
  | FloorRefusal
  | GitRefusal
  | 'not-found'
  | 'deleted'
  | 'not-a-reflection'
  | 'not-finished'
  | 'already-answered'
  | 'self-answer'
  | 'cross-project'
  | 'commit-unknown'
  | 'commit-unlanded';

type UnanswerRefusal = FloorRefusal | 'not-found' | 'deleted' | 'not-a-reflection' | 'not-an-answer';

const payloadOf = (answer: Answer): { by: number } | { commit: string } | { checked: string; head: string | null } =>
  answer.kind === 'block'
    ? { by: answer.id }
    : answer.kind === 'commit'
      ? { commit: answer.sha }
      : { checked: answer.finding, head: answer.head };

const sameAnswer = (a: Answer, b: Answer): boolean =>
  a.kind === 'block'
    ? b.kind === 'block' && a.id === b.id
    : a.kind === 'commit'
      ? b.kind === 'commit' && a.sha === b.sha
      : b.kind === 'checked' && a.finding === b.finding;

export const spokenAnswer = Effect.fn('Reflection.spoken')(function* (
  answer: Answer,
): Effect.fn.Return<{ name: string; read: string }, StoreFailure, BlockNames> {
  if (answer.kind === 'commit') {
    return { name: `commit ${answer.sha}`, read: `read_commit ${answer.sha} in the checkout of this graph — what the fix changed` };
  }
  if (answer.kind === 'checked') {
    return {
      name: `a check at ${answer.head ?? 'an unborn HEAD'}: ${answer.finding}`,
      read: 'the finding names the conditions checked; met again since? file it as its own entry',
    };
  }
  const name = yield* (yield* BlockNames).nameOf(answer.id);
  return { name, read: `read_block ${name} — what was done about it` };
});

export const reflectionsLayer: Layer.Layer<
  Reflections,
  never,
  Act | Git | Projects | Tags | BlockRows | BlockNames | BlockAnswers | GraphStore
> = Layer.effect(
  Reflections,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const act = yield* Act;
    const blockRows = yield* BlockRows;
    const blockNames = yield* BlockNames;
    const blockAnswers = yield* BlockAnswers;
    const git = yield* Git;
    const projects = yield* Projects;
    const vocabulary = yield* Tags;
    const spoken = (answer: Answer) => spokenAnswer(answer).pipe(Effect.provideService(BlockNames, blockNames));

    const observed = Effect.fn('Reflection.observed')(function* (
      id: number,
    ): Effect.fn.Return<BlockRow, StoreFailure | GateRefusal<'not-found' | 'deleted' | 'not-a-reflection'>> {
      const entry = yield* blockRows.blockById(id);
      const table = yield* vocabulary.of(entry.projectId);
      if (table.supports(entry, OBSERVATION)) return entry;
      return yield* new GateRefusal(
        'not-a-reflection',
        `${blockName(entry.uuid)} is ${tagLabel(table.tagOf(entry))}; only a reflection is answered this way`,
        [`${tagLabel(table.tagOf(entry))} that carries work ends by its own operation: finish_block or close_block`],
      );
    });

    const recordedCommit = Effect.fn('Reflection.recordedCommit')(function* (
      entry: BlockRow,
      revision: string,
    ): Effect.fn.Return<Answer | null, StoreFailure | GateRefusal<'not-an-answer'>> {
      const prefix = revision.trim().toLowerCase();
      const matched = (yield* blockAnswers.answeredCommits(entry.id)).filter((sha) => sha.startsWith(prefix));
      if (matched.length > 1) {
        return yield* new GateRefusal(
          'not-an-answer',
          `${revision} names ${matched.length} commits answer acts recorded for ${blockName(entry.uuid)}: ${matched.join(', ')}`,
          ['name the one to withdraw by its whole sha'],
        );
      }
      const [sha] = matched;
      return sha === undefined ? null : { kind: 'commit', sha };
    });

    const finished = Effect.fn('Reflection.finished')(function* (
      entry: BlockRow,
      byId: number,
    ): Effect.fn.Return<number, StoreFailure | GateRefusal<'not-found' | 'deleted' | 'self-answer' | 'cross-project' | 'not-finished'>> {
      if (byId === entry.id) {
        return yield* new GateRefusal('self-answer', `${blockName(entry.uuid)} cannot be what answered itself`, [
          'name the block that carries the change: the doc that states it now, or the task that made it',
          'a direct fix answers by its commit: `commit` in place of `by`',
        ]);
      }
      const by = yield* blockRows.blockById(byId);
      if (by.projectId !== entry.projectId) {
        return yield* new GateRefusal('cross-project', 'the block that answered this entry lives in another graph', [
          `name a block of project ${entry.projectId} — the graph that documents Tagma itself`,
        ]);
      }
      const table = yield* vocabulary.of(entry.projectId);
      if (!isFinishedWork(table, by)) {
        const status = table.statusOf(by);
        return yield* new GateRefusal(
          'not-finished',
          `${blockName(by.uuid)} is ${status === null ? tagLabel(table.tagOf(by)) : `${tagLabel(table.tagOf(by))} at ${status}`}, and an answer is finished work: a node at done or closed, or one that states what is or binds every thread`,
          [
            `finish_block ${blockName(by.uuid)}, or close_block it, and name it then`,
            `link_blocks ${blockName(by.uuid)} discovered-from ${blockName(entry.uuid)} — work that grew out of the friction answers it the moment it ends, with nothing more to call`,
            'a direct fix answers by its commit: `commit` in place of `by`',
          ],
        );
      }
      return by.id;
    });

    const landed = Effect.fn('Reflection.landed')(function* (
      entry: BlockRow,
      revision: string,
    ): Effect.fn.Return<string, StoreFailure | GateRefusal<GitRefusal | 'not-found' | 'commit-unknown' | 'commit-unlanded'>> {
      const home = yield* projects.byId(entry.projectId);
      const root = yield* measuredRoot(home);
      const sha = yield* Effect.mapError(commitOf(git, root, revision), gitRefusal);
      if (sha === null) {
        return yield* new GateRefusal(
          'commit-unknown',
          `${revision} names no commit in ${root}, the checkout of project \`${home.name}\` that holds ${blockName(entry.uuid)}`,
          [
            `name the fix as read_checkout_history on project \`${home.name}\` spells its commit`,
            'a commit of another repository proves nothing here: a fix to Tagma lands in the repository of the graph that documents it',
          ],
        );
      }
      const head = yield* Effect.mapError(headAt(git, root), gitRefusal);
      const reached = head.commit === null ? false : yield* Effect.mapError(ancestorAt(git, root, sha, head.commit), gitRefusal);
      if (!reached) {
        return yield* new GateRefusal(
          'commit-unlanded',
          `${sha} is not on ${head.ref ?? 'the detached HEAD'} of ${root}: a fix the checkout's branch does not hold has not landed`,
          [
            'land it on that branch first — submit_work, or merge_worktree for a worktree — then answer with it',
            `read_checkout_history on project \`${home.name}\` — the commits its branch holds`,
          ],
        );
      }
      return sha;
    });

    const checkedAt = Effect.fn('Reflection.checkedAt')(function* (
      entry: BlockRow,
    ): Effect.fn.Return<string | null, StoreFailure | GateRefusal<GitRefusal | 'not-found'>> {
      const root = yield* measuredRoot(yield* projects.byId(entry.projectId));
      return (yield* Effect.mapError(headAt(git, root), gitRefusal)).commit;
    });

    const conditions = Effect.fnUntraced(function* (home: BlockRow) {
      const table = yield* vocabulary.of(home.projectId);
      const standing = sql`${block.projectId} = ${home.projectId} and ${block.deletedAt} is null
        and ${carriesContract(table, REFLECTION, block.id)} and not (${measuredCondition(table).answered})
        and not exists (select 1 from ${edge} e where e.kind = 'supersedes' and e.to_id = ${block.id})`;
      const stands = (id: SQL) => sql`exists (select 1 from ${block} where ${block.id} = ${id} and ${standing})`;
      const keeper = sql`${standing} and not (${block.id} <> ${home.id} and exists (
        select 1 from ${block} p where p.id = ${block.parentId} and ${stands(sql`p.id`)}))`;
      return { stands, keeper };
    });

    const entriesFor = Effect.fnUntraced(function* (found: readonly BlockRow[], stands: (id: SQL) => SQL) {
      if (found.length === 0) return [];
      const sightings = yield* db.all<{ id: number; seen: number }>(sql`
        with recursive sightings(keeper_id, id) as (
          select ${block.id}, ${block.id} from ${block} where ${inArray(
            block.id,
            found.map((row) => row.id),
          )}
          union all
          select p.keeper_id, c.id from sightings p join ${block} c on c.parent_id = p.id where ${stands(sql`c.id`)}
        )
        select keeper_id as id, count(*) as seen from sightings group by keeper_id`);
      const seen = new Map(sightings.map((row) => [row.id, row.seen] as const));
      return (yield* blockRows.details(found)).map((entry) => ({ ...entry, sightings: seen.get(entry.id) ?? 1 }));
    });

    return Reflections.of({
      groups: Effect.fn('Reflection.groups')(function* (home, ids) {
        if (ids.length === 0) return [];
        const { stands, keeper } = yield* conditions(home);
        const belongs = sql`exists (
          with recursive lineage(id, parent_id) as (
            select b.id, b.parent_id from ${block} b where b.id = ${block.id}
            union all
            select p.id, p.parent_id from lineage a join ${block} p on p.id = a.parent_id
            where a.id <> ${home.id} and p.deleted_at is null
          ) select 1 from lineage where id = ${home.id}
        )`;
        const found = yield* db
          .select()
          .from(block)
          .where(sql`${inArray(block.id, ids)} and ${keeper} and ${belongs}`);
        return yield* entriesFor(found, stands);
      }),

      answer: Effect.fn('Reflection.answer')(function* (
        input: AnswerInput,
      ): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<AnswerRefusal>> {
        const entry = yield* observed(input.id);
        const named: Answer =
          'commit' in input
            ? { kind: 'commit', sha: yield* landed(entry, input.commit) }
            : 'checked' in input
              ? { kind: 'checked', finding: input.checked, head: yield* checkedAt(entry) }
              : { kind: 'block', id: yield* finished(entry, input.byId) };
        return yield* act.unit(
          answering,
          Effect.gen(function* () {
            const standing = yield* blockAnswers.answerOf(entry.id);
            if (standing !== null && sameAnswer(standing, named)) {
              return yield* blockRows.recordOf(yield* blockRows.rawBlockById(entry.id));
            }
            if (standing !== null) {
              const said = yield* spoken(standing);
              return yield* new GateRefusal('already-answered', `${blockName(entry.uuid)} was answered by ${said.name}`, [
                said.read,
                'met again after the fix? that is its own entry, naming no earlier one',
                `named in error? unanswer_reflection ${blockName(entry.uuid)} with what answers it now, then answer it again`,
              ]);
            }
            yield* act.record('answer', entry.id, payloadOf(named));
            return yield* blockRows.recordOf(yield* blockRows.rawBlockById(entry.id));
          }),
        );
      }),

      unanswer: Effect.fn('Reflection.unanswer')(function* (
        input: UnanswerInput,
      ): Effect.fn.Return<BlockRecord, StoreFailure | GateRefusal<UnanswerRefusal>> {
        const entry = yield* observed(input.id);
        return yield* act.unit(
          unanswering,
          Effect.gen(function* () {
            const named: Answer | null =
              'commit' in input
                ? yield* recordedCommit(entry, input.commit)
                : 'checked' in input
                  ? { kind: 'checked', finding: '', head: null }
                  : { kind: 'block', id: input.byId };
            const state = named === null ? 'never' : yield* blockAnswers.answerStateOf(entry.id, named);
            if (named === null || state === 'never') {
              const standing = yield* blockAnswers.answerOf(entry.id);
              const said = standing === null ? null : yield* spoken(standing);
              return yield* new GateRefusal(
                'not-an-answer',
                `${'commit' in input ? `commit ${input.commit}` : 'checked' in input ? 'no check' : yield* blockNames.nameOf(input.byId)} never answered ${blockName(entry.uuid)}, so there is nothing of it to withdraw`,
                said === null
                  ? [`${blockName(entry.uuid)} stands unanswered: there is no answer of it to withdraw`]
                  : [
                      `${blockName(entry.uuid)} stands answered by ${said.name}: name that`,
                      'a block filed discovered-from the entry, or one or a commit an answer act named, or `checked` for a recorded check, is what can be withdrawn',
                    ],
              );
            }
            if (state === 'live') {
              yield* act.record('unanswer', entry.id, named.kind === 'checked' ? { checked: true } : payloadOf(named));
            }
            return yield* blockRows.recordOf(yield* blockRows.rawBlockById(entry.id));
          }),
        );
      }),

      standing: Effect.fn('Reflection.standing')(function* (home: BlockRow, after: BlockPosition | undefined, rows: number) {
        const { stands, keeper } = yield* conditions(home);
        const filed = sql`${block.id} in ${subtreeIds(home.id)} and ${keeper}`;
        const found = yield* db
          .select()
          .from(block)
          .where(after === undefined ? filed : sql`${filed} and (${keysetOf(STANDING_SORT, after)})`)
          .orderBy(orderingOf(STANDING_SORT))
          .limit(rows);
        const counted = yield* db
          .select({ total: sql<number>`count(*)` })
          .from(block)
          .where(filed)
          .get();
        if (counted === undefined) return yield* Effect.die('reflection count returned no row');
        const entries = yield* entriesFor(found, stands);
        return { rows: entries, total: counted.total };
      }),
    });
  }),
);

const STANDING_SORT: BlockQuery['sort'] = { by: 'created', order: 'desc' };
