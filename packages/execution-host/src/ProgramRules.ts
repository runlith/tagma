import { Effect, Ref } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { CommandPrograms, LimitProvenance, ProgramRuleCopy } from '@runlith/executions/protocol/command';
import type { EndedAt, ProcessRuling, ProcessWatchReading, RuleNamed } from '@runlith/executions/protocol/stop';
import { climb as ladderClimb, type Climb, type LadderAim, type Opening } from '@runlith/executions/stopLadder';
import { Processes, type ProcessFacts } from './ProcessReader';
import { sameProcess, type ProcessWitness } from '@runlith/executions/protocol/evidence';
import { matchTightest, type ProgramLookups } from './ProgramMatch';
import type { BoundRuleRecord } from './db/persisted';
import { namedOf, proofOf, ROUND_PERIOD_MS, type Member, type ProvenSet, type SetReading } from './ProvenSet';

export const RULINGS_MAX = 32;
const PROCESS_WORDS_MAX = 160;

export type StandingDeadline = {
  readonly revision: number;
  readonly executionMs: number | undefined;
  readonly origin: LimitProvenance;
  readonly elapsedMs: number | undefined;
  readonly foregroundMs?: number | undefined;
};

export type DefaultDeadline = {
  readonly defaultMs: number;
  readonly read: Effect.Effect<StandingDeadline | undefined>;
  readonly extend: (expected: number, executionMs: number) => Effect.Effect<void>;
};

export type ProgramRulesPorts = {
  readonly lookups: ProgramLookups;
  readonly kill: (witness: ProcessWitness, step: StopStep) => Effect.Effect<boolean>;
  readonly first: Opening;
  readonly changed: Effect.Effect<void>;
  readonly persist?: ((bound: ReadonlyArray<BoundRuleRecord>) => Effect.Effect<void>) | undefined;
  readonly deadline?: DefaultDeadline | undefined;
  readonly climb?: (first: Opening, aims: ReadonlyArray<LadderAim>) => Effect.Effect<Climb>;
};

type Seen = { readonly node: ProcessWitness; readonly facts: ProcessFacts | undefined; readonly unread: boolean };
type LeaderObservation = Seen | 'gone' | 'unknown';

type Matchable = {
  readonly words: ReadonlyArray<string>;
  readonly folder: string | undefined;
  readonly list: number;
  readonly limitMs: number;
  readonly copy: ProgramRuleCopy;
};

const listOf = (copy: ProgramRuleCopy): number => (copy.machine === true ? 0 : copy.thread === undefined ? 1 : 2);

type Bound = {
  readonly pid: number;
  readonly birth: string;
  readonly rule: ProgramRuleCopy;
  readonly dueMs: number;
  readonly ending: boolean;
};

type Held = {
  readonly bound: ReadonlyMap<string, Bound>;
  readonly ending: ReadonlySet<string>;
  readonly rulings: ReadonlyMap<string, ProcessRuling>;
  readonly omitted: number;
  readonly dropped: ReadonlySet<string>;
  readonly extending: boolean;
};

const keyOf = (node: ProcessWitness): string => `${node.pid}:${node.birth}`;

const recordOf = (one: Bound): BoundRuleRecord => ({ pid: one.pid, birth: one.birth, ruleId: one.rule.id, dueMs: one.dueMs });

const moved = (before: ReadonlyMap<string, Bound>, after: ReadonlyMap<string, Bound>): boolean => {
  if (before.size !== after.size) return true;
  for (const [key, one] of after) {
    const was = before.get(key);
    if (was === undefined || was.rule.id !== one.rule.id || was.dueMs !== one.dueMs) return true;
  }
  return false;
};

const namedRule = (rule: ProgramRuleCopy): RuleNamed => ({
  id: rule.id,
  words: rule.program.words,
  folder: rule.program.folder,
  limitMs: rule.limitMs,
});

const describe = (pid: number, facts: ProcessFacts | undefined): string => {
  const named = namedOf(pid, facts);
  return named.length <= PROCESS_WORDS_MAX ? named : `${named.slice(0, PROCESS_WORDS_MAX - 1)}…`;
};

const ruled = (held: Held, found: ReadonlyMap<string, ProcessRuling>): Held => {
  const rulings = new Map(held.rulings);
  const dropped = new Set(held.dropped);
  for (const [key, ruling] of found) {
    if (dropped.has(key)) continue;
    if (!rulings.has(key) && rulings.size >= RULINGS_MAX && ruling._tag !== 'Unread') {
      const unread = [...rulings].find(([, standing]) => standing._tag === 'Unread');
      if (unread !== undefined) {
        rulings.delete(unread[0]);
        dropped.add(unread[0]);
      }
    }
    if (rulings.has(key) || rulings.size < RULINGS_MAX) rulings.set(key, ruling);
    else dropped.add(key);
  }
  return { ...held, rulings, dropped, omitted: dropped.size };
};

export type ProgramRules = {
  readonly round: (readAtMs: number) => Effect.Effect<void>;
  readonly reading: () => Effect.Effect<ProcessWatchReading>;
};

export type ProgramRulesInput = {
  readonly set: ProvenSet;
  readonly programs: CommandPrograms;
  readonly ports: ProgramRulesPorts;
  readonly resumed?: ReadonlyArray<BoundRuleRecord>;
};
type BoundLadder = { readonly bound: Bound; readonly nodes: ReadonlyArray<ProcessWitness> };

export const makeProgramRules = Effect.fnUntraced(function* ({ set, programs, ports, resumed = [] }: ProgramRulesInput) {
  const reader = yield* Processes;
  const copies = new Map(programs.rules.map((copy) => [copy.id, copy] as const));
  const restored = new Map<string, Bound>();
  for (const one of resumed) {
    const rule = copies.get(one.ruleId);
    if (rule !== undefined) restored.set(keyOf(one), { pid: one.pid, birth: one.birth, rule, dueMs: one.dueMs, ending: false });
  }
  const state = yield* Ref.make<Held>({
    bound: restored,
    ending: new Set(),
    rulings: new Map(),
    omitted: 0,
    dropped: new Set(),
    extending: false,
  });
  const rules: ReadonlyArray<Matchable> = programs.rules
    .filter((copy) => programs.root !== undefined || copy.program.folder === undefined)
    .map((copy) => ({ words: copy.program.words, folder: copy.program.folder, list: listOf(copy), limitMs: copy.limitMs, copy }));
  const root = programs.root;
  const scope = yield* Effect.scope;

  const round = Effect.fnUntraced(function* (readAtMs: number) {
    if (yield* set.taken) return;
    const members = yield* set.members;
    const answered = yield* leaderSeen();
    const leader = typeof answered === 'string' ? undefined : answered;
    const seen: Seen[] = leader === undefined ? [] : [leader];
    for (const member of members) seen.push({ node: member, facts: member.facts, unread: member.unread !== undefined });
    const facts = new Map(seen.map((one) => [keyOf(one.node), one.facts] as const));
    const before = yield* Ref.get(state);
    const bound = new Map<string, Bound>();
    const found = new Map<string, ProcessRuling>();
    for (const { node, facts: read, unread } of seen) {
      const key = keyOf(node);
      const kept = before.bound.get(key);
      if (kept?.ending === true) {
        bound.set(key, kept);
        continue;
      }
      if (unread || read === undefined) {
        if (kept !== undefined) bound.set(key, kept);
        else if (unread && !before.rulings.has(key)) {
          found.set(key, { _tag: 'Unread', pid: node.pid, process: describe(node.pid, read), fields: ['args', 'folder'] });
        }
        continue;
      }
      const match = matchTightest(read, rules, root ?? '/', ports.lookups);
      if (match._tag === 'Unread') {
        if (kept !== undefined) bound.set(key, kept);
        else if (!before.rulings.has(key))
          found.set(key, { _tag: 'Unread', pid: node.pid, process: describe(node.pid, read), fields: match.fields });
        continue;
      }
      if (match._tag === 'None') continue;
      const rule = match.rule.copy;
      bound.set(
        key,
        kept !== undefined && kept.rule.id === rule.id
          ? kept
          : { pid: node.pid, birth: node.birth, rule, dueMs: readAtMs + rule.limitMs, ending: false },
      );
    }
    for (const [key, kept] of before.bound) {
      if (bound.has(key)) continue;
      const unreadLeader = answered === 'unknown' && kept.pid === set.leader;
      if (unreadLeader || members.some((member) => member.lineage.some((above) => keyOf(above) === key))) bound.set(key, kept);
    }
    const lineage = lineageOf(members, leader?.node);
    const ending = new Set(before.ending);
    const ladders: BoundLadder[] = [];
    for (const one of [...bound.values()]) {
      if (one.ending || one.dueMs > readAtMs) continue;
      const reached = [one, ...lineage.below(one)].filter((node) => !ending.has(keyOf(node)));
      for (const node of reached) {
        ending.add(keyOf(node));
        found.set(keyOf(node), {
          _tag: 'Ending',
          pid: node.pid,
          process: describe(node.pid, facts.get(keyOf(node))),
          rule: namedRule(one.rule),
        });
      }
      bound.set(keyOf(one), { ...one, ending: true });
      ladders.push({ bound: one, nodes: reached });
    }
    if (ports.persist !== undefined && moved(before.bound, bound)) {
      yield* ports.persist([...bound.values()].map(recordOf));
    }
    yield* Ref.update(state, (current) => {
      for (const key of current.ending) ending.add(key);
      return ruled({ ...current, bound, ending }, found);
    });
    for (const ladder of ladders) yield* Effect.forkIn(end(ladder.bound, ladder.nodes, facts, lineage.root), scope);
    if (found.size > 0) yield* ports.changed;
    yield* extend(readAtMs, bound, lineage);
  });

  const reading = Effect.fnUntraced(function* () {
    const watched = yield* set.reading;
    const held = yield* Ref.get(state);
    return { ...watchReading(watched), rulings: [...held.rulings.values()], omitted: held.omitted };
  });

  const leaderSeen = Effect.fnUntraced(function* (): Effect.fn.Return<LeaderObservation> {
    const node = yield* set.witness(set.leader);
    if (node === undefined) return 'gone';
    return yield* reader.facts([node.pid]).pipe(
      Effect.match({
        onFailure: (): LeaderObservation => 'unknown',
        onSuccess: (read): LeaderObservation => {
          const facts = read.processes.find((one) => sameProcess(one, node));
          if (facts !== undefined) return { node, facts, unread: false };
          const refused = read.unread.find((one) => one.pid === node.pid);
          return refused === undefined || refused._tag === 'Gone' ? 'gone' : { node, facts: undefined, unread: true };
        },
      }),
    );
  });

  const end = Effect.fnUntraced(function* (
    bound: Bound,
    nodes: ReadonlyArray<ProcessWitness>,
    facts: ReadonlyMap<string, ProcessFacts | undefined>,
    root: ProcessWitness | undefined,
  ) {
    const late: ProcessWitness[] = [];
    const known = new Set(nodes.map(keyOf));
    const aimAt = (node: ProcessWitness): LadderAim => ({
      send: Effect.fnUntraced(function* (signal) {
        const proof = proofOf(reader.identity(node.pid), node);
        if (proof._tag === 'Standing') yield* ports.kill(node, signal);
      }),
      gone: Effect.sync(() => {
        const proof = proofOf(reader.identity(node.pid), node);
        return proof._tag === 'Left' || proof._tag === 'Ended';
      }),
    });
    const joined = Effect.gen(function* () {
      const ending = (yield* Ref.get(state)).ending;
      const fresh: ProcessWitness[] = [];
      for (const node of lineageOf(yield* set.members, root).below(bound)) {
        if (known.has(keyOf(node)) || ending.has(keyOf(node))) continue;
        known.add(keyOf(node));
        fresh.push(node);
      }
      if (fresh.length > 0) {
        late.push(...fresh);
        yield* Ref.update(state, (held) => ({ ...held, ending: new Set([...held.ending, ...fresh.map(keyOf)]) }));
      }
      return fresh;
    });
    const climb = ports.climb ?? ladderClimb;
    const [matched, ...below] = nodes;
    const lateEnded = new Map<string, EndedAt>();
    let last: StopStep | undefined;
    let matchedEnded: EndedAt | undefined;
    const head: LadderAim = {
      send: Effect.fnUntraced(function* (signal) {
        last = signal;
        yield* joined;
        if (matched !== undefined && matchedEnded === undefined) yield* aimAt(matched).send(signal);
        for (const node of late) if (!lateEnded.has(keyOf(node))) yield* aimAt(node).send(signal);
      }),
      gone: Effect.gen(function* () {
        const fresh = yield* joined;
        if (last !== undefined) for (const node of fresh) yield* aimAt(node).send(last);
        if (matched !== undefined && matchedEnded === undefined && (yield* aimAt(matched).gone)) matchedEnded = last ?? 'unsignalled';
        let standing = matched !== undefined && matchedEnded === undefined;
        for (const node of late) {
          if (lateEnded.has(keyOf(node))) continue;
          if (yield* aimAt(node).gone) lateEnded.set(keyOf(node), last ?? 'unsignalled');
          else standing = true;
        }
        return !standing;
      }),
    };
    const climbed = yield* climb(ports.first, [head, ...below.map(aimAt)]);
    const graded: Array<readonly [ProcessWitness, EndedAt | undefined, ReadonlyArray<StopStep>]> = [
      ...(matched === undefined ? [] : [[matched, matchedEnded, climbed.steps] as const]),
      ...below.map((node, index) => [node, climbed.endedAt[index + 1], climbed.steps] as const),
    ];
    const settled = new Set<string>();
    for (let pass = 0; pass < 3; pass += 1) {
      for (const node of late) {
        if (settled.has(keyOf(node))) continue;
        settled.add(keyOf(node));
        graded.push([node, lateEnded.get(keyOf(node)), climbed.steps]);
      }
      const rest = yield* joined;
      if (rest.length === 0) break;
      const again = yield* climb(ports.first, rest.map(aimAt));
      for (const [index, node] of rest.entries()) {
        settled.add(keyOf(node));
        graded.push([node, again.endedAt[index], again.steps]);
      }
    }
    const fresh = new Map((yield* set.members).map((member) => [keyOf(member), member.facts] as const));
    const named = namedRule(bound.rule);
    const outcomes = new Map<string, ProcessRuling>();
    for (const [node, endedAt, steps] of graded) {
      const key = keyOf(node);
      const base = { pid: node.pid, process: describe(node.pid, facts.get(key) ?? fresh.get(key)), rule: named };
      if (endedAt !== undefined) {
        outcomes.set(key, { _tag: 'Ended', ...base, step: endedAt });
        continue;
      }
      const proof = proofOf(reader.identity(node.pid), node);
      outcomes.set(
        key,
        proof._tag === 'Standing'
          ? { _tag: 'Survived', ...base, steps }
          : proof._tag === 'Unreadable'
            ? {
                _tag: 'Unverifiable',
                ...base,
                reason: `its birth witness could not be read (${proof.detail}), so whether it still stands is unknown`,
              }
            : { _tag: 'Ended', ...base, step: steps.at(-1) ?? 'unsignalled' },
      );
    }
    yield* Ref.update(state, (held) => ruled(held, outcomes));
    yield* ports.changed;
  });

  const extend = Effect.fnUntraced(function* (readAtMs: number, bound: ReadonlyMap<string, Bound>, lineage: Lineage) {
    const deadline = ports.deadline;
    if (deadline === undefined) return;
    if ((yield* Ref.get(state)).extending) return;
    const standing = yield* deadline.read;
    if (standing === undefined || standing.origin !== 'default') return;
    if (standing.executionMs === undefined || standing.elapsedMs === undefined) return;
    if (standing.executionMs <= standing.elapsedMs) return;
    const ends = [...bound.values()].map((one) => lineage.endOf(one, bound));
    const left = ends.length === 0 ? 0 : Math.max(0, Math.max(...ends) - readAtMs);
    const wanted = Math.ceil(Math.max(deadline.defaultMs, standing.elapsedMs + left));
    const target = standing.foregroundMs === undefined ? wanted : Math.min(wanted, standing.foregroundMs);
    const moved = Math.abs(target - standing.executionMs);
    if (moved === 0 || (target < standing.executionMs && standing.executionMs <= deadline.defaultMs)) return;
    if (moved < ROUND_PERIOD_MS && target !== deadline.defaultMs && ends.length > 0) return;
    yield* Ref.update(state, (held) => ({ ...held, extending: true }));
    yield* Effect.forkIn(
      deadline.extend(standing.revision, target).pipe(Effect.ensuring(Ref.update(state, (held) => ({ ...held, extending: false })))),
      scope,
    );
  });

  return { round, reading } satisfies ProgramRules;
});

export const watchReading = (set: SetReading | undefined): Omit<ProcessWatchReading, 'rulings' | 'omitted'> =>
  set === undefined
    ? { members: 0, capped: false, watched: false, unwatched: 'no-reader', failures: 0 }
    : {
        members: set.members,
        capped: set.capped,
        watched: set.watched && set.leader !== 'Lost',
        ...(!set.watched ? { unwatched: 'ended' as const } : set.leader === 'Lost' ? { unwatched: 'leader-unproven' as const } : {}),
        failures: set.failures,
      };

type Lineage = {
  readonly root: ProcessWitness | undefined;
  readonly below: (node: ProcessWitness) => ReadonlyArray<ProcessWitness>;
  readonly endOf: (bound: Bound, all: ReadonlyMap<string, Bound>) => number;
};

const lineageOf = (members: ReadonlyArray<Member>, root: ProcessWitness | undefined): Lineage => {
  const byKey = new Map(members.map((member) => [keyOf(member), member] as const));
  const ancestors = (node: ProcessWitness): ReadonlyArray<string> => (byKey.get(keyOf(node))?.lineage ?? []).map(keyOf);
  return {
    root,
    below: (node) => {
      const key = keyOf(node);
      if (root !== undefined && key === keyOf(root)) return members;
      return members.filter((member) => ancestors(member).includes(key));
    },
    endOf: (bound, all) => {
      let end = bound.dueMs;
      for (const up of ancestors(bound)) {
        const above = all.get(up);
        if (above !== undefined) end = Math.min(end, above.dueMs);
      }
      return end;
    },
  };
};
