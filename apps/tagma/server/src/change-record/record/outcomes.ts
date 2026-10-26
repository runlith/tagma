import { and, eq, sql, type SQL } from 'drizzle-orm';
import { Effect } from 'effect';
import { commitsAt } from '@runlith/git/history';
import type { Git } from '@runlith/git/Git';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { actingGit, runGit } from '../../platform/git/ownGit.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { OutcomeUnread, type KnownCommit, type KnownOutcomes, type UnknownOutcome } from '../contract/service/record.js';
import { troubleOf } from '@runlith/git/repository';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { retirementProof } from '../store/retirement.js';
import { workspaceChange } from '../store/tables.js';
import { unreached } from '../retire/history.js';
import { readHolder } from '../store/homes.js';
import type { StoreShape } from './places.js';

export const outcomeRefusal = (failure: OutcomeUnread) =>
  new GateRefusal('record-unread', `the known outcomes of this session's lines could not be verified: ${failure.message}`, [
    'read again once the checkout and its history can be read',
  ]);

export type RowOutcome = {
  readonly known: KnownOutcomes;
  readonly from: SQL;
  readonly on: SQL | undefined;
  readonly state: SQL<'writing' | 'held' | 'committed' | 'withdrawn'>;
  readonly commit: SQL<string | null>;
  readonly at: SQL<number | null>;
};

export const columnsOf = (known: KnownOutcomes): RowOutcome => ({
  known,
  from: sql`(with known as materialized (
    select json_extract(value, '$.checkout') as checkout, json_extract(value, '$.commit') as commit_sha,
      json_extract(value, '$.at') as at from json_each(${JSON.stringify(known.commits)})
  ) select proof.row, proof.after, proof."commit" as commit_sha, known.at
    from known inner join ${retirementProof} as proof
      on proof.checkout = known.checkout and proof."commit" = known.commit_sha
    where proof.reason = 'committed'
  ) as known_outcomes`,
  on: and(
    eq(workspaceChange.id, sql`known_outcomes.row`),
    eq(workspaceChange.state, 'held'),
    sql`${workspaceChange.afterHash} is known_outcomes.after`,
  ),
  state: sql`case when known_outcomes.row is not null then 'committed' else ${workspaceChange.state} end`,
  commit: sql`coalesce(${workspaceChange.commit}, known_outcomes.commit_sha)`,
  at: sql`coalesce(${workspaceChange.committedAt}, known_outcomes.at)`,
});

export const DURABLE_OUTCOME = columnsOf({ commits: [], unread: [] });

export const outcomesOf = Effect.fn('ChangeRecord.outcomes')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  git: Git['Service'],
  paths: CheckoutPaths['Service'],
  projectId: number,
  threadId: string,
  checkout?: string,
) {
  const pending = yield* readHolder(units, store, threadId, (unit) =>
    unit.run(
      store.db
        .selectDistinct({ checkout: retirementProof.checkout, commit: retirementProof.commit })
        .from(workspaceChange)
        .innerJoin(
          retirementProof,
          and(eq(retirementProof.row, workspaceChange.id), sql`${retirementProof.after} is ${workspaceChange.afterHash}`),
        )
        .where(
          and(
            eq(workspaceChange.holderProjectId, projectId),
            eq(workspaceChange.holder, threadId),
            eq(workspaceChange.state, 'held'),
            eq(retirementProof.reason, 'committed'),
            checkout === undefined ? undefined : eq(workspaceChange.checkout, checkout),
          ),
        ),
    ),
  );
  if (pending.length === 0) return DURABLE_OUTCOME;
  const groups = new Map<string, typeof pending>();
  for (const row of pending) {
    const group = groups.get(row.checkout);
    if (group === undefined) groups.set(row.checkout, [row]);
    else group.push(row);
  }
  const proven: KnownCommit[] = [];
  const unread: UnknownOutcome[] = [];
  for (const [checkout, rows] of groups) {
    const read = Effect.gen(function* () {
      const place = yield* paths
        .rootAcross(RootId.make(checkout), projectId)
        .pipe(Effect.mapError((failure) => new OutcomeUnread({ message: failure.reason })));
      if (place === null) return yield* new OutcomeUnread({ message: `the checkout ${checkout} of a pending commit is not registered` });
      const found: KnownCommit[] = [];
      const head = yield* runGit(git, 'outcome-head', ['-C', place.path, 'rev-parse', '--verify', 'HEAD^{commit}']);
      const commits = [...new Set(rows.map((row) => row.commit))];
      const absent = yield* unreached(git, place.path, head, commits);
      const carried = commits.filter((commit) => !absent.has(commit));
      const described = yield* commitsAt(actingGit(git, 'outcome-commits'), place.path, carried);
      for (const row of rows) {
        if (absent.has(row.commit)) continue;
        const commit = described.get(row.commit);
        if (commit === undefined)
          return yield* new OutcomeUnread({ message: `the carrying commit ${row.commit} in ${checkout} could not be described` });
        found.push({ checkout, commit: row.commit, at: Date.parse(commit.date) });
      }
      return found;
    });
    yield* Effect.match(read, {
      onSuccess: (rows) => {
        proven.push(...rows);
      },
      onFailure: (failure) => {
        unread.push({
          checkout,
          reason:
            failure._tag === 'GitUnreadable' || failure._tag === 'GitRefused' || failure._tag === 'GitAnswerInvalid'
              ? troubleOf(failure)
              : failure.message,
        });
      },
    });
  }
  return columnsOf({ commits: proven, unread });
});
