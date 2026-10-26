import { Clock, Effect } from 'effect';
import { uuidv7 } from 'uuidv7';
import type { CommandFacts, CommandLife, CommandMoves, CommandVerdict } from '@runlith/agent-tools/WorkspaceChanges';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { CommandChanges, type CommandSession, type CommandUnattributed, TEAM_REASON } from '../contract/service/commands.js';
import type { CommandEntry, Commanding, CommandOpening, QueuedMove } from './commandRows.js';
import type { Basis, Claim, Command, Life, Lives } from './lives.js';
import { explains, type Learned, learns, roleOf, signatureIn } from './roles.js';
import type { Lesson, Lessons } from './lessons.js';
import type { CommandQueue } from './queue.js';
import type { CommandJournal } from './journal.js';
import { GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';

const KEPT_BYTES = 64 * 1024 * 1024;

const sessionOf = (projectId: number, threadId: string): string => `${projectId}\0${threadId}`;

const under = (place: string, path: string): boolean => place === '' || path === place || path.startsWith(`${place}/`);

const NOTHING_RETAINED: ReadonlyMap<string, CommandUnattributed> = new Map();

export const OVERLAP_REASON = 'overlap';

export const UNPROVEN_REASON = 'unproven';

const VERDICTS = { mine: 'attributed', unclaimed: 'unclaimed', overlap: 'overlap', team: 'team' } as const;

const DECISIONS: Readonly<Record<Basis, string>> = {
  nobody: 'CommandDecision.nobody',
  marks: 'CommandDecision.marks',
  sets: 'CommandDecision.sets',
  unproven: 'CommandDecision.unproven',
  overlap: 'CommandDecision.overlap',
  team: 'CommandDecision.team',
  untouched: 'CommandDecision.untouched',
};

const recorded = (bases: readonly Basis[]): Effect.Effect<void> =>
  Effect.forEach(bases, (basis) => Effect.withSpan(Effect.void, DECISIONS[basis]), { discard: true });

const commandOf = (
  id: string,
  facts: CommandFacts,
  tree: string,
  learned: (signature: string) => Learned | null,
  team: string | null,
): Command => ({
  id,
  role: roleOf(facts, tree, learned),
  signatures: facts.parts.filter((part) => !part.readsOnly).map((part) => (learns(part) ? signatureIn(tree, part.signature) : null)),
  team,
});

const UNTAUGHT = (): null => null;

type Judged = { readonly name: string; readonly claim: Claim; readonly at: number };

const lessonOf = ({ role, signatures }: Command, judged: readonly Judged[]): Lesson | null => {
  if (signatures.length === 0) return null;
  let explained = true;
  for (const { name, claim, at } of judged) {
    if (claim.basis === 'nobody' || claim.basis === 'marks' || explains(role, name)) continue;
    if (claim.sole) {
      const [only] = signatures;
      return signatures.length === 1 && only !== null && only !== undefined ? { kind: 'hit', signature: only, path: name, at } : null;
    }
    explained = false;
  }
  const clean = signatures.filter((one): one is string => one !== null);
  return explained && clean.length > 0 ? { kind: 'clean', signatures: clean } : null;
};

export type CommandWrites = Effect.Success<ReturnType<typeof makeCommandWrites>>;

export const makeCommandWrites = Effect.fnUntraced(function* ({
  lives,
  queue,
  journal,
  lessons = null,
  records = null,
  keptBytes = KEPT_BYTES,
}: {
  readonly lives: Lives;
  readonly queue: CommandQueue<CommandEntry, StoreFailure>;
  readonly journal: CommandJournal | null;
  readonly lessons?: Lessons | null;
  readonly records?: ThreadRecords['Service'] | null;
  readonly keptBytes?: number;
}) {
  const graphDirectory = yield* GraphDirectory;
  const retainedAt = new Map<string, Map<string, Map<string, CommandUnattributed>>>();
  const revisions = new Map<string, number>();
  const outstanding = new Map<string, number>();
  let kept = 0;

  const journaled = <E extends { readonly message: string }>(work: Effect.Effect<void, E>, warning: string): Effect.Effect<boolean> =>
    Effect.flatMap(Effect.result(work), (written) =>
      written._tag === 'Success' ? Effect.succeed(true) : Effect.as(Effect.logWarning(warning, { reason: written.failure.message }), false),
    );

  const background = (work: Effect.Effect<void, StoreFailure>, warning: string): void => {
    Effect.runFork(journaled(work, warning));
  };

  const remember = (row: CommandUnattributed): void => {
    const sessions = retainedAt.get(row.checkout) ?? new Map<string, Map<string, CommandUnattributed>>();
    const key = sessionOf(row.projectId, row.threadId);
    const paths = sessions.get(key) ?? new Map<string, CommandUnattributed>();
    paths.delete(row.path);
    paths.set(row.path, row);
    sessions.set(key, paths);
    retainedAt.set(row.checkout, sessions);
  };

  const drop = (checkout: string, session: string | null, paths: readonly string[], through: number): void => {
    const sessions = retainedAt.get(checkout);
    if (sessions === undefined) return;
    for (const [key, standing] of sessions) {
      if (session !== null && key !== session) continue;
      for (const path of paths) if ((standing.get(path)?.at ?? Infinity) <= through) standing.delete(path);
      if (standing.size === 0) sessions.delete(key);
    }
    if (sessions.size === 0) retainedAt.delete(checkout);
  };

  const unattribute = (at: Commanding, names: readonly string[], reason: string, now: number, team: string | null = null): void => {
    const rows = names.map((path) => ({ projectId: at.projectId, threadId: at.threadId, checkout: at.key, path, reason, team, at: now }));
    for (const row of rows) remember(row);
    if (journal !== null) background(journal.unattribute(rows), 'unattributed command paths were not journaled; a restart forgets them');
  };

  const adopt = (at: Commanding, names: readonly string[], through: number): void => {
    if (names.length === 0) return;
    drop(at.key, sessionOf(at.projectId, at.threadId), names, through);
    if (journal === null) return;
    background(
      journal.forgotten({ projectId: at.projectId, threadId: at.threadId, checkout: at.key }, names, through),
      'adopted command paths stay journaled as unattributed; a restart names them again',
    );
  };

  const teamOf = (threadId: string): Effect.Effect<string | null> =>
    records === null
      ? Effect.succeed(null)
      : records.facts(threadId).pipe(
          Effect.map((facts) => facts?.spawnRootId ?? null),
          Effect.catchTag(['EffectDrizzleQueryError', 'SqlError', 'ThreadStorageFailed'], (failure) =>
            Effect.as(
              Effect.logWarning('the team of a command could not be read, so its writes beside teammates stay overlaps', {
                threadId,
                reason: failure.message,
              }),
              null,
            ),
          ),
        );

  const closeWindow = (window: string): void => {
    if (journal === null) return;
    Effect.runFork(
      Effect.suspend(() =>
        outstanding.has(window)
          ? Effect.void
          : Effect.asVoid(journaled(journal.closed([window]), 'a decided command window stays journaled; a restart decides it again')),
      ),
    );
  };

  const hold = (window: string | null): (() => void) => {
    if (window === null) return () => undefined;
    outstanding.set(window, (outstanding.get(window) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (outstanding.get(window) ?? 1) - 1;
      if (left > 0) outstanding.set(window, left);
      else {
        outstanding.delete(window);
        closeWindow(window);
      }
    };
  };

  const enqueue = (at: Commanding, life: Life, moved: CommandMoves, moves: readonly QueuedMove[], now: number): Effect.Effect<void> => {
    if (moves.length === 0) return Effect.void;
    const session = sessionOf(at.projectId, at.threadId);
    revisions.set(session, (revisions.get(session) ?? 0) + 1);
    const held = lives.hold(at.key, moved.window.from);
    const window = hold(at.windowId);
    const weight = moves.reduce((total, move) => total + (move.bytes?.byteLength ?? 0), 0);
    const keeping = kept + weight <= keptBytes;
    if (keeping) kept += weight;
    const queued = keeping ? moves : moves.map((move): QueuedMove => (move.bytes === null ? move : { ...move, bytes: null }));
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (keeping) kept -= weight;
      held();
      window();
    };
    const paths = new Set(moves.map((move) => move.name));
    const unwritten = (names: readonly string[], reason: string): void => unattribute(at, names, reason, Date.now());
    const adopted = (names: readonly string[]): void => adopt(at, names, now);
    const entry: CommandEntry = { ...at, life, window: moved.window, base: moved.base, moves: queued, paths, release, unwritten, adopted };
    return queue.append(`${at.key}\0${at.threadId}`, [entry]);
  };

  const judged = (at: Commanding, life: Life, moved: CommandMoves) => {
    const verdicts: CommandVerdict[] = [];
    const decided: QueuedMove[] = [];
    const overlapped: string[] = [];
    const unproven: string[] = [];
    const teamed = new Map<string, string[]>();
    const bases: Basis[] = [];
    const claims: Judged[] = [];
    const decide = lives.decider(at.key, life, moved.window);
    for (const move of moved.moves) {
      if (move.name === graphDirectory || move.name.startsWith(`${graphDirectory}/`)) continue;
      const claim = decide({ name: move.name, after: move.after, written: move.written });
      claims.push({ name: move.name, claim, at: move.written?.to ?? moved.window.to });
      if (claim.counted) bases.push(claim.basis);
      decided.push({
        ...move,
        claim:
          claim.kind === 'mine'
            ? 'mine'
            : claim.basis === 'unproven'
              ? 'unproven'
              : claim.kind === 'overlap' || claim.kind === 'team'
                ? 'overlap'
                : 'other',
      });
      if (claim.kind === 'overlap') (claim.basis === 'unproven' ? unproven : overlapped).push(move.name);
      if (claim.kind === 'team') teamed.set(claim.root, [...(teamed.get(claim.root) ?? []), move.name]);
      verdicts.push(
        claim.kind === 'taken'
          ? { name: move.name, verdict: 'taken', by: claim.by }
          : { name: move.name, verdict: claim.basis === 'unproven' && claim.kind === 'overlap' ? 'unproven' : VERDICTS[claim.kind] },
      );
    }
    return { verdicts, decided, overlapped, unproven, teamed, bases, lesson: lessonOf(life.command, claims) };
  };

  const settle = (at: Commanding, life: Life, moved: CommandMoves, teaching: boolean): Effect.Effect<readonly CommandVerdict[]> =>
    Effect.suspend(() => {
      const guard = hold(at.windowId);
      const now = Date.now();
      const { verdicts, decided, overlapped, unproven, teamed, bases, lesson } = judged(at, life, moved);
      if (overlapped.length > 0) unattribute(at, overlapped, OVERLAP_REASON, now);
      if (unproven.length > 0) unattribute(at, unproven, UNPROVEN_REASON, now);
      for (const [root, names] of teamed) unattribute(at, names, TEAM_REASON, now, root);
      return recorded(bases).pipe(
        Effect.andThen(!teaching || lesson === null || lessons === null ? Effect.void : lessons.taught(at.key, lesson)),
        Effect.andThen(enqueue(at, life, moved, decided, now)),
        Effect.ensuring(Effect.sync(guard)),
        Effect.as(verdicts),
      );
    });

  const reading = (opening: CommandOpening): CommandLife => {
    const living = lives.reading(opening.key, opening.threadId);
    return {
      based: () => Effect.void,
      opened: living.opened,
      ended: living.ended,
      close: living.close,
      forget: living.forget,
      settle: (moved) => Effect.sync(() => judged({ ...opening, windowId: null }, living.life, moved).verdicts),
    };
  };

  const life = (opening: CommandOpening, id: string, command: Command, journal: CommandJournal | null): CommandLife => {
    const living = lives.open(opening.key, opening.threadId, command);
    let settled = journal === null;
    const unsettled = (): void => {
      if (settled) return;
      settled = true;
      closeWindow(id);
    };
    return {
      based: (base) =>
        journal === null
          ? Effect.void
          : Effect.asVoid(
              journaled(journal.based(id, base), 'the command baseline was not fully retained; attribution can remain unproven'),
            ),
      opened: living.opened,
      ended: living.ended,
      close: () => {
        unsettled();
        living.close();
      },
      forget: () => {
        unsettled();
        living.forget();
      },
      settle: (moved) =>
        Effect.suspend(() => {
          const window = settled || journal === null ? null : id;
          settled = true;
          const deciding = settle({ ...opening, windowId: window }, living.life, moved, true);
          if (window === null || journal === null || moved.moves.length === 0) return deciding;
          const life = { start: living.life.start, end: living.life.end };
          return Effect.andThen(
            journaled(
              journal.settled(window, life, moved.window, moved.moves),
              'a settled command window was not journaled; a restart before its rows land judges it as open',
            ),
            deciding,
          );
        }),
    };
  };

  return {
    ...CommandChanges.of({
      settled: queue.settled,
      decided: (session) =>
        Effect.suspend(() => Effect.as(queue.settled(session), revisions.get(sessionOf(session.projectId, session.threadId)) ?? 0)),
      unattributed: (session) => {
        const key = sessionOf(session.projectId, session.threadId);
        return [...retainedAt.values()].flatMap((sessions) => [...(sessions.get(key)?.values() ?? [])]);
      },
      retained: (session, checkout) => retainedAt.get(checkout)?.get(sessionOf(session.projectId, session.threadId)) ?? NOTHING_RETAINED,
      unattributedUnder: (checkout, place) =>
        [...(retainedAt.get(checkout)?.values() ?? [])].flatMap((paths) => [...paths.values()].filter((one) => under(place, one.path))),
    }),
    onClose: (listener: (checkout: string) => Effect.Effect<void>): (() => void) => journal?.onClose(listener) ?? (() => undefined),
    sweep: (checkout: string, clean: readonly string[], before: number): void => {
      if (clean.length === 0) return;
      drop(checkout, null, clean, before - 1);
      if (journal !== null)
        background(journal.swept(checkout, clean, before), 'swept unattributed command paths stay journaled; a restart names them again');
    },
    retire: (sessions: readonly CommandSession[]): void => {
      if (sessions.length === 0) return;
      const keys = new Set(sessions.map((session) => sessionOf(session.projectId, session.threadId)));
      for (const [checkout, paths] of retainedAt) {
        for (const key of keys) paths.delete(key);
        if (paths.size === 0) retainedAt.delete(checkout);
      }
      if (journal !== null) background(journal.retired(sessions), 'retired sessions stay journaled; a restart retires them again');
    },
    unowned: (key: string, name: string, after: string, at: number): (() => void) => {
      const undo = lives.unowned(key, name, after, at);
      if (journal === null) return undo;
      const id = uuidv7();
      background(
        journal.unowned({ id, checkout: key, path: name, after, at }),
        'a write held by nobody was not journaled; a restart may credit it to a command',
      );
      return () => {
        undo();
        background(journal.owned(id), 'a withdrawn nobody-write stays journaled; a restart reads it as nobody');
      };
    },
    open: Effect.fn('CommandWrites.open')(function* (opening: CommandOpening, facts: CommandFacts, tree: string) {
      const id = uuidv7();
      if (lessons !== null) yield* lessons.ready;
      const learned = lessons === null ? UNTAUGHT : lessons.learned(yield* lessons.repositoryOf(opening.key));
      const command = commandOf(id, facts, tree, learned, yield* teamOf(opening.threadId));
      if (journal === null) return life(opening, id, command, null);
      const window = {
        id,
        ...opening,
        checkout: opening.key,
        openedAt: yield* Clock.currentTimeMillis,
        role: command.role,
        signatures: command.signatures,
        team: command.team,
      };
      const written = yield* journaled(
        journal.opened(window),
        'a command window was not journaled, so a restart while it runs leaves its paths external',
      );
      return life(opening, id, command, written ? journal : null);
    }),
    reading,
    replay: (at: Commanding, life: Life, moved: CommandMoves) => settle(at, life, moved, false),
    remembered: (rows: readonly CommandUnattributed[]): void => {
      for (const row of rows) remember(row);
    },
  };
});
