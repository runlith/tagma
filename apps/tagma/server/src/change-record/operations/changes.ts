import { resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { page, pageRows, pastKey, readCursor, walkQuestion, type PageKey } from '@runlith/paging';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { threadIdOf } from '../../platform/contract/wire/actor.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal, cursorRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { ChangeRecord, type TurnAfter, type Turns } from '../contract/service/record.js';
import { CommandChanges, type CommandUnattributed } from '../contract/service/commands.js';
import { Holdings, type HoldingsFailure } from '../contract/service/holdings.js';
import { rootReadRefusal } from '../../workspace/roots/refusal.js';
import type { RootRefusal } from '../../workspace/contract/wire/refusals.js';
import { ThreadChanges } from '../contract/service/threadChanges.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { CHANGE_COMMITS, type ThreadCheckout, type ThreadEntry } from '../contract/wire/threadChanges.js';
import { debtsAt } from '../record/debts.js';
import { ChangeScope } from '../contract/service/scope.js';
import type { PathHolding, UnattributedPath } from '../contract/wire/changes.js';
import { standingTurn } from '../changes/turns.js';
import { outcomeRefusal } from '../record/outcomes.js';
import { CHANGE_READS as OPS } from '../contract/wire/operations.js';
import { CHANGES } from '../contract/wire/pages.js';
import { addressOf } from '../../thread-record/identity.js';

type ChangesInput = (typeof OPS)['read_changes']['input']['Type'];

const CHANGES_WALK = {
  operation: 'read_changes',
  order: CHANGES.order,
  selection: Schema.Struct({
    path: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    projectId: Schema.Number,
    subject: Schema.NullOr(Schema.String),
  }),
  key: Schema.Union([
    Schema.Tuple([Schema.Literal('checkouts'), Schema.String, Schema.String]),
    Schema.Tuple([Schema.Literal('turns'), Schema.Number, Schema.String]),
    Schema.Tuple([Schema.Literal('holdings'), Schema.String, Schema.String]),
    Schema.Tuple([Schema.Literal('unattributed'), Schema.String, Schema.String, Schema.String]),
  ]),
};

const placeOf = Effect.fn('read_changes.place')(function* (projectId: number, spelling: string) {
  const workspace = yield* CallerWorkspace;
  const base = workspace === null ? (yield* (yield* Projects).byId(projectId)).rootPath : workspace.root;
  return yield* Effect.mapError(
    (yield* CheckoutPaths).placeAcross(resolve(base, spelling)),
    (failure) =>
      new GateRefusal('record-unread', `Which checkout holds ${spelling} could not be read: ${failure.reason}`, [
        'Retry once the checkout can be read.',
      ]),
  );
});

type ChangeRow =
  | { readonly kind: 'checkout'; readonly checkout: ThreadCheckout; readonly entry: ThreadEntry | null }
  | { readonly kind: 'turn'; readonly turn: Turns['rows'][number] }
  | { readonly kind: 'holding'; readonly holding: PathHolding }
  | { readonly kind: 'unattributed'; readonly observation: UnattributedPath };

const rowKey = (row: ChangeRow): PageKey => {
  switch (row.kind) {
    case 'checkout':
      return ['checkouts', row.checkout.checkout, row.entry?.path ?? ''];
    case 'turn':
      return ['turns', row.turn.at, row.turn.key];
    case 'holding':
      return ['holdings', row.holding.checkout, row.holding.holding.path];
    case 'unattributed':
      return observationKey(row.observation);
  }
};

const turnPosition = (at: PageKey): TurnAfter | undefined => {
  const [kind, moment, key] = at;
  return at.length === 3 && kind === 'turns' && typeof moment === 'number' && typeof key === 'string' ? { at: moment, key } : undefined;
};

const observationKey = (row: UnattributedPath): PageKey => ['unattributed', row.checkout, row.path, row.thread];
const observationPosition = (at: PageKey): boolean =>
  at.length === 4 && at[0] === 'unattributed' && at.every((part) => typeof part === 'string');

const observationsAfter = (rows: readonly CommandUnattributed[], at: PageKey | undefined, limit: number): readonly ChangeRow[] | null => {
  const position =
    at === undefined || at[0] !== 'unattributed'
      ? -1
      : rows.findIndex((row) => row.checkout === at[1] && row.path === at[2] && row.threadId === at[3]);
  if (at?.[0] === 'unattributed' && position === -1) return null;
  return rows.slice(position + 1, position + 1 + limit).map((row) => ({ kind: 'unattributed', observation: shownUnattributed(row) }));
};

const rooted = <A>(work: Effect.Effect<A, HoldingsFailure>): Effect.Effect<A, StoreFailure | GateRefusal<RootRefusal>> =>
  Effect.mapError(work, (failure) => {
    switch (failure._tag) {
      case 'RootMissing':
      case 'RootUnavailable':
      case 'RootInvalid':
      case 'RootRefused':
      case 'RootConflict':
        return rootReadRefusal(failure);
      default:
        return failure;
    }
  });

const shownUnattributed = ({ checkout, path, reason, threadId, team }: CommandUnattributed): UnattributedPath => ({
  checkout,
  path,
  reason,
  thread: threadId,
  team,
});

const under = (place: string, path: string): boolean => place === '' || path === place || path.startsWith(`${place}/`);

const askingThread = (caller: Caller): Effect.Effect<string, GateRefusal<'no-record'>> =>
  caller.actor.kind === 'thread'
    ? Effect.succeed(caller.actor.threadId)
    : Effect.fail(
        new GateRefusal('no-record', 'The change record is read for a session, and this caller is not one.', [
          'Name an `agent` to read that session’s work, or a `path` to read who holds it.',
        ]),
      );

export const readChangeRows = Effect.fn('read_changes.rows')(function* (asked: ChangesInput, caller: Caller) {
  const projectId = yield* (yield* ChangeScope).projectId;
  const narrowed = asked.path !== undefined || asked.agent !== undefined;
  const carried = narrowed || asked.cursor === undefined ? undefined : yield* walks.recall(CHANGES_WALK, asked.cursor);
  const input = { path: carried?.path, agent: carried?.agent, ...asked };
  if (input.path !== undefined && input.agent !== undefined) {
    return yield* new GateRefusal('selection-shape', '`read_changes` reads one agent or one path, never both.', [
      'Omit `path` to read the agent, or omit `agent` to read the path holders.',
    ]);
  }
  const machine = yield* MachineStore;
  const units = yield* MachineUnits;
  const record = yield* ChangeRecord;
  const holdings = yield* Holdings;
  const rows = pageRows(input.limit, CHANGES, ceilingOf(CHANGES));
  const narrowing = {
    path: input.path,
    agent: input.agent,
  };
  const resume = Effect.fnUntraced(function* (subject: string | null) {
    const question = walkQuestion(CHANGES_WALK, { ...narrowing, projectId, subject });
    const continued = input.cursor === undefined ? undefined : readCursor(input.cursor, question);
    if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
    return { question, at: continued?.at };
  });
  const empty = { held: null, checkouts: [], commits: [], moreCommits: false, ends: [], turns: [], holdings: [] };
  if (input.path !== undefined) {
    const asking = threadIdOf(caller.actor);
    const walk = yield* resume(null);
    if (
      walk.at !== undefined &&
      !observationPosition(walk.at) &&
      !(walk.at.length === 3 && walk.at[0] === 'holdings' && typeof walk.at[1] === 'string' && typeof walk.at[2] === 'string')
    )
      return yield* cursorRefusal('bad-cursor');
    const place = yield* placeOf(projectId, input.path);
    const found: PathHolding[] = [];
    const commands = yield* CommandChanges;
    if (place !== null) {
      const checkout = RootId.make(place.checkout);
      yield* commands.settled({ checkout });
      const view = yield* rooted(holdings.read(checkout, 'settled'));
      for (const holding of view.paths) if (under(place.path, holding.path)) found.push({ checkout: place.checkout, holding, debts: [] });
    }
    found.sort((left, right) => (left.holding.path < right.holding.path ? -1 : left.holding.path > right.holding.path ? 1 : 0));
    const unattributed = place === null ? [] : commands.unattributedUnder(place.checkout, place.path);
    const primary: ChangeRow[] = found.map((holding) => ({ kind: 'holding', holding }));
    const after = walk.at;
    const rest = after === undefined ? primary : after[0] === 'unattributed' ? [] : pastKey(primary, rowKey, [], after);
    const observations = observationsAfter(unattributed, after, Math.max(0, rows + 1 - rest.length));
    if (observations === null) return yield* cursorRefusal('cursor-stale');
    const total = found.length + unattributed.length;
    const cut = page({
      rows: [...rest, ...observations],
      asked: rows,
      keyOf: rowKey,
      question: walk.question,
      total,
    });
    const shown = cut.rows.flatMap((row) => (row.kind === 'holding' ? [row.holding] : []));
    const debts =
      place === null
        ? undefined
        : yield* debtsAt(
            units,
            machine,
            place.checkout,
            shown.map((row) => row.holding.path),
          );
    return {
      ...empty,
      holdings: shown.map((row) => ({ ...row, debts: (debts?.get(row.holding.path) ?? []).map((debt) => debt.commit) })),
      subject: asking,
      self: asking,
      unattributed: cut.rows.flatMap((row) => (row.kind === 'unattributed' ? [row.observation] : [])),
      totals: { checkouts: 0, turns: 0, holdings: found.length, unattributed: unattributed.length },
      total,
      next: cut.next,
      narrowing,
    };
  }
  const self = threadIdOf(caller.actor);
  const home = caller.actor.kind === 'thread' ? caller.actor.projectId : projectId;
  const named = input.agent === undefined ? null : yield* addressOf(machine.db, input.agent, { threadId: self, projectId: home });
  if (input.agent !== undefined && named === null) {
    return yield* new GateRefusal('unknown-address', `No agent answers to \`${input.agent}\`.`, [
      'Name a team name inside your own root/team, or the thread id itself.',
      'list_agents — the agents of your team.',
    ]);
  }
  const subject = named?.threadId ?? (yield* askingThread(caller));
  const subjectHome = named?.projectId ?? home;
  const walk = yield* resume(subject);
  const after = walk.at === undefined ? undefined : turnPosition(walk.at);
  const inCheckouts = walk.at?.[0] === 'checkouts';
  if (walk.at !== undefined && after === undefined && !inCheckouts && !observationPosition(walk.at))
    return yield* cursorRefusal('bad-cursor');
  yield* (yield* CommandChanges).settled({ projectId: subjectHome, threadId: subject });
  const slice = yield* (yield* ThreadChanges).read(subjectHome, subject, null, CHANGE_COMMITS);
  const checkoutRows = slice.checkouts.flatMap<ChangeRow>((checkout) =>
    checkout.entries.length === 0
      ? [{ kind: 'checkout' as const, checkout, entry: null }]
      : checkout.entries.map((entry) => ({ kind: 'checkout' as const, checkout, entry })),
  );
  let remaining: readonly ChangeRow[] = [];
  if (walk.at === undefined) remaining = checkoutRows;
  else if (inCheckouts) {
    const position = checkoutRows.findIndex((row) => {
      const key = rowKey(row);
      return key[1] === walk.at?.[1] && key[2] === walk.at?.[2];
    });
    if (position === -1) return yield* cursorRefusal('cursor-stale');
    remaining = checkoutRows.slice(position + 1);
  }
  const turnLimit = walk.at?.[0] === 'unattributed' ? 0 : Math.max(0, rows + 1 - remaining.length);
  const turns = yield* record.turns({
    projectId: subjectHome,
    threadId: subject,
    limit: Math.max(1, turnLimit),
    after,
    outcomes: slice.outcomes,
  });
  const unattributed = record.unattributed({ projectId: subjectHome, threadId: subject });
  const primary: ChangeRow[] = [
    ...remaining.slice(0, rows + 1),
    ...(turnLimit === 0 ? [] : turns.rows.map((turn) => ({ kind: 'turn' as const, turn }))),
  ];
  const observations = observationsAfter(unattributed, walk.at, Math.max(0, rows + 1 - primary.length));
  if (observations === null) return yield* cursorRefusal('cursor-stale');
  const total = checkoutRows.length + turns.total + unattributed.length;
  const cut = page({
    rows: [...primary, ...observations],
    asked: rows,
    keyOf: rowKey,
    question: walk.question,
    total,
  });
  const checkouts = new Map<string, ThreadCheckout>();
  for (const row of cut.rows) {
    if (row.kind !== 'checkout') continue;
    const previous = checkouts.get(row.checkout.checkout);
    checkouts.set(row.checkout.checkout, {
      ...row.checkout,
      entries: [...(previous?.entries ?? []), ...(row.entry === null ? [] : [row.entry])],
    });
  }
  const judged = new Map<string, ReadonlySet<string>>(
    slice.checkouts.flatMap((side) =>
      side.state.kind !== 'current' ? [] : [[side.checkout, new Set(side.entries.map((entry) => entry.path))] as const],
    ),
  );
  return {
    held: slice.held,
    checkouts: [...checkouts.values()],
    commits: slice.commits,
    moreCommits: slice.moreCommits,
    ends: slice.ends,
    turns: cut.rows.flatMap((row) => {
      if (row.kind !== 'turn') return [];
      const { key: _key, ...turn } = row.turn;
      return [standingTurn(turn, judged)];
    }),
    holdings: [],
    subject,
    self,
    unattributed: cut.rows.flatMap((row) => (row.kind === 'unattributed' ? [row.observation] : [])),
    totals: { checkouts: checkoutRows.length, turns: turns.total, holdings: 0, unattributed: unattributed.length },
    total,
    next: cut.next,
    narrowing,
  };
});

export const readChanges = pair(
  OPS.read_changes,
  body(OPS.read_changes, {
    execute: (input, _prepared, caller) =>
      Effect.map(
        readChangeRows(input, caller).pipe(Effect.catchTag('OutcomeUnread', (failure) => Effect.fail(outcomeRefusal(failure)))),
        (read) => ({
          status: 'ok' as const,
          held: read.held,
          checkouts: read.checkouts,
          commits: read.commits,
          moreCommits: read.moreCommits,
          ends: read.ends,
          turns: read.turns,
          holdings: read.holdings,
          path: read.narrowing.path ?? null,
          agent: read.narrowing.agent ?? null,
          subject: read.subject,
          self: read.self,
          unattributed: read.unattributed,
          totals: read.totals,
          total: read.total,
          next: read.next,
        }),
      ),
  }),
);
