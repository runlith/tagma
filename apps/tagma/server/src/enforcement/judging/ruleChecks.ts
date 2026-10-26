import { statSync } from 'node:fs';
import { Clock, Effect, Result } from 'effect';
import type { CommitRecord, RuleCrossing } from '../contract/wire/enforcement.js';
import { findingLines, said } from '../contract/wire/findings.js';
import { type TriggerPhase } from '../../graph/contract/wire/enforcement.js';
import {
  type AfterDelivery,
  type Checked,
  type CommitSubject,
  type HeadSubject,
  holderOf,
  type StagedSubject,
  UNCHECKED,
} from '../contract/wire/checks.js';
import type { RefusalRecord } from '../refusals/record.js';
import { actorRefOfTerminal, terminalActorOfRef } from '../../executions/terminals/principals.js';
import { type CommitQueue, type QueuedCommit, CommitRecordFailed } from '../commits/queue.js';
import type { RuleChecks } from '../contract/service/ruleChecks.js';
import type { CommitRecords } from '../contract/service/commitRecords.js';
import type { GateMemory } from './gateMemory.js';
import { type JudgeGraph, type Judgement, judgingBuilt, judgingOver, unowned, WAYS_OUT } from './judge.js';
import { branchAt } from './branch.js';
import { enforcedStatutes } from '../rules/reach.js';
import type { Remeasure } from '../contract/service/remeasure.js';
import { landedTree, stagedTree } from './trees.js';
import { Git } from '@runlith/git/Git';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';

export const TRIGGER_INDEX_MS = 60_000;

type Triggered = { readonly on: ReadonlySet<string>; readonly unreadable: boolean };

type Indexed = Triggered & { readonly read: number };

export type Wanted = { readonly runs: boolean };

const NOTHING: Triggered = { on: new Set<string>(), unreadable: false };

const keyOf = (op: string, phase: TriggerPhase): string => `${op}\0${phase}`;

export type Checks = RuleChecks['Service'] & CommitRecords['Service'];

export const triggerIndex = (standing: JudgeGraph, indexMs = TRIGGER_INDEX_MS) => {
  const index = new Map<string, Indexed>();
  const epochs = new Map<number, number>();
  const flights = new Map<string, { readonly epoch: number; readonly effect: Effect.Effect<Triggered> }>();

  const read = Effect.fnUntraced(
    function* (projectId: number, root: string | null) {
      const context = yield* standing(projectId, root);
      const enforced = yield* Effect.result(Effect.provide(enforcedStatutes(projectId), context));
      if (Result.isFailure(enforced)) {
        yield* Effect.logWarning(
          'the rules of this checkout could not be read, so every operation that changes nothing is judged until they read',
          {
            projectId,
            cause: enforced.failure.message,
          },
        );
        return { on: new Set<string>(), unreadable: true } satisfies Triggered;
      }
      const on = new Set<string>();
      let unreadable = false;
      for (const entry of enforced.success) {
        if (entry.document === null) unreadable = true;
        if (entry.document === null || entry.document.strictness === 'note') continue;
        for (const one of entry.document.on) on.add(keyOf(one.op, one.phase));
      }
      return { on, unreadable } satisfies Triggered;
    },
    (effect, projectId, root) =>
      effect.pipe(
        Effect.result,
        Effect.flatMap((answer) =>
          Result.isSuccess(answer)
            ? Effect.succeed(answer.success)
            : Effect.as(
                Effect.logWarning(
                  'the triggers of enforced rules could not be read, so no rule runs on an operation that changes nothing until they are read again',
                  {
                    projectId,
                    cause: String(answer.failure),
                  },
                ),
                NOTHING,
              ),
        ),
      ),
  );

  const checkoutOf = (projectId: number, root: string | null): string => `${projectId}\0${root ?? ''}`;

  const indexed = Effect.fnUntraced(function* (projectId: number, root: string | null) {
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
    const key = checkoutOf(projectId, root);
    const kept = index.get(key);
    if (kept !== undefined && now() - kept.read < indexMs) return kept;
    let epoch = epochs.get(projectId) ?? 0;
    const pending = flights.get(key);
    if (pending?.epoch === epoch) return yield* pending.effect;
    let flight: Effect.Effect<Triggered>;
    const reading = read(projectId, root).pipe(
      Effect.tap((triggered) =>
        Effect.sync(() => {
          if ((epochs.get(projectId) ?? 0) === epoch) index.set(key, { ...triggered, read: now() });
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (flights.get(key)?.effect === flight) flights.delete(key);
        }),
      ),
    );
    flight = yield* Effect.cached(reading);
    const fresh = index.get(key);
    if (fresh !== undefined && now() - fresh.read < indexMs) return fresh;
    epoch = epochs.get(projectId) ?? 0;
    const current = flights.get(key);
    if (current?.epoch === epoch) return yield* current.effect;
    flights.set(key, { epoch, effect: flight });
    return yield* flight;
  });

  const at = (projectId: number, op: string, phase: TriggerPhase, root: string | null = null): Effect.Effect<Wanted> =>
    Effect.map(indexed(projectId, root), ({ on, unreadable }) => ({
      runs: on.has(keyOf(op, phase)) || (unreadable && phase === 'before' && !WAYS_OUT.has(op)),
    }));

  return {
    at,
    wanted: (projectId: number, op: string, phase: TriggerPhase, root: string | null = null): Effect.Effect<boolean> =>
      Effect.map(at(projectId, op, phase, root), ({ runs }) => runs),
    forget: (projectId: number): void => {
      const prefix = checkoutOf(projectId, '');
      for (const key of [...index.keys()]) if (key.startsWith(prefix)) index.delete(key);
      for (const key of [...flights.keys()]) if (key.startsWith(prefix)) flights.delete(key);
      epochs.set(projectId, (epochs.get(projectId) ?? 0) + 1);
    },
  };
};

export type TriggerIndex = ReturnType<typeof triggerIndex>;

const watchedNotice = (op: string, subject: HeadSubject, judged: Judgement) => {
  const caller = subject.caller;
  if (caller?._tag !== 'Thread' || judged.watched.length === 0) return null;
  const lines = [
    ...findingLines(
      judged.watched.flatMap((one) => ('fingerprint' in one ? [one] : [])),
      '  ',
    ),
    ...judged.watched.flatMap((one) => ('failed' in one ? [`  ${one.rule} could not run: ${one.failed}`] : [])),
  ];
  const standing = judged.watched
    .map((one) => ('fingerprint' in one ? `${one.rule}:${one.fingerprint}` : `${one.rule}:${one.cause}`))
    .sort()
    .join(',');
  return {
    projectId: caller.projectId,
    threadId: caller.threadId,
    id: `rule-watched:${subject.projectId}:${op}:${standing}`,
    text: [
      `Before ${op}, rules at watch triggered by it found at HEAD, outside their debt:`,
      ...lines,
      'Nothing was refused or recorded.',
    ].join('\n'),
  };
};

export type ProjectAt = (root: string) => Effect.Effect<number | null, { readonly message: string }>;

const SETTLED_GIT: ReadonlySet<string> = new Set(['landed-head', 'landed-missing']);

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const whyUnjudged = (judged: Checked): string =>
  judged.refused?.reason ??
  judged.unjudged.map((one) => ('gate' in one ? one.cause : `${one.rule} ${one.file}:${one.line} ${one.specifier}`)).join('; ');

export type CommitRoad = {
  readonly git: Git['Service'];
  readonly projectAt: ProjectAt;
  readonly queue: CommitQueue['Service'];
};

type RefusedAt = { readonly projectId: number; readonly root: string; readonly base: string; readonly branch?: string | null };

type BranchRead = { readonly branch: string | null; readonly unread: string | null };

const branchRead = (standing: JudgeGraph, tree: RefusedAt): Effect.Effect<BranchRead> =>
  tree.branch !== undefined
    ? Effect.succeed({ branch: tree.branch, unread: null })
    : Effect.map(
        Effect.result(Effect.flatMap(standing(tree.projectId, tree.root), (graph) => Effect.provide(branchAt(tree.root), graph))),
        (read): BranchRead =>
          Result.isSuccess(read) ? { branch: read.success, unread: null } : { branch: null, unread: read.failure.message },
      );

const kept = (
  standing: JudgeGraph,
  refusals: RefusalRecord | undefined,
  op: string,
  tree: RefusedAt | undefined,
  caller: TerminalActor | undefined,
  judged: Checked,
): Effect.Effect<Checked> => {
  const refused = judged.refused;
  const crossed = judged.crossed ?? [];
  if (refusals === undefined || refused === null || refused.code !== 'rule-violated' || tree === undefined || crossed.length === 0)
    return Effect.succeed(judged);
  const actor = caller === undefined ? null : actorRefOfTerminal(caller);
  return Effect.gen(function* () {
    const { branch, unread } = yield* branchRead(standing, tree);
    const rows = crossed.map((one) => {
      const what = said(one);
      return {
        rule: one.rule,
        op,
        file: one.file,
        line: one.line ?? null,
        fingerprint: one.fingerprint,
        said: what === '' ? null : what,
        reached: one.specifier ?? null,
        fix: one.fix ?? null,
        base: tree.base,
        branch,
        actor,
      };
    });
    const written = yield* Effect.result(refusals.keep(tree.projectId, rows, new Date(yield* Clock.currentTimeMillis)));
    const notes = [
      ...(unread === null ? [] : [`this refusal was recorded without its branch: ${unread}`]),
      ...(Result.isSuccess(written) ? [] : [`this refusal could not be recorded: ${written.failure.message}`]),
    ];
    return notes.length === 0 ? judged : { ...judged, refused: { ...refused, reason: [refused.reason, ...notes].join('\n') } };
  });
};

export const ruleChecks = (options: {
  readonly graphOf: JudgeGraph;
  readonly triggers: TriggerIndex;
  readonly standing?: JudgeGraph;
  readonly commits?: CommitRoad;
  readonly memory?: GateMemory['Service'];
  readonly driver?: Remeasure['Service'];
  readonly refusals?: RefusalRecord;
}): Checks => {
  const standing = options.standing ?? options.graphOf;
  const judging = judgingOver(options.graphOf, options.memory);
  const judgingHead = judgingOver(standing, options.memory);
  const road = options.commits;
  const hooked = road === undefined ? null : judgingBuilt(standing, options.memory, road.git);
  const recorded = road === undefined ? null : judgingBuilt(options.graphOf, options.memory, road.git);
  const projectAt: ProjectAt = road?.projectAt ?? (() => Effect.succeed(null));
  const afterStart = (projectId: number, root: string, check: Effect.Effect<Checked>): Effect.Effect<Checked> =>
    options.driver === undefined
      ? check
      : Effect.matchEffect(options.driver.ready(projectId, root), {
          onSuccess: () => check,
          onFailure: (failure) =>
            Effect.succeed({ ...UNCHECKED, refused: { code: failure.code, reason: failure.reason, unblock: failure.unblock } }),
        });

  const owning = (root: string): Effect.Effect<{ readonly unowned: Checked } | { readonly projectId: number }> =>
    Effect.map(Effect.result(projectAt(root)), (answer) => {
      if (Result.isFailure(answer))
        return { unowned: unowned(root, `${root} could not be resolved to a project: ${answer.failure.message}`) };
      const projectId = answer.success;
      return road === undefined || projectId === null ? { unowned: unowned(root) } : { projectId };
    });

  const staged = (op: string, subject: StagedSubject): Effect.Effect<Checked> =>
    Effect.flatMap(owning(subject.root), (owner) => {
      if ('unowned' in owner || hooked === null) return Effect.succeed('unowned' in owner ? owner.unowned : UNCHECKED);
      return afterStart(
        owner.projectId,
        subject.root,
        Effect.map(
          hooked(op, owner.projectId, subject.root, stagedTree(owner.projectId, subject.root, subject.index), 'before', subject.caller),
          ({ judged, tree }): Checked => (tree === null ? judged : { ...judged, tree }),
        ),
      );
    }).pipe(Effect.withSpan(`${op}.before`));

  const record = Effect.fnUntraced(
    function* (queued: QueuedCommit) {
      if (recorded === null || road === undefined) return;
      const { op, projectId, root, commit, holder } = queued;
      const caller = queued.caller === undefined ? undefined : terminalActorOfRef(queued.caller);
      const standing = yield* Effect.try({
        try: () => statSync(root, { throwIfNoEntry: false }) !== undefined,
        catch: (failure) => new CommitRecordFailed({ reason: `${root} could not be read: ${String(failure)}` }),
      });
      const owner = standing
        ? yield* Effect.mapError(projectAt(root), (failure) => new CommitRecordFailed({ reason: failure.message }))
        : null;
      const gone = !standing ? `${root} is gone` : owner !== projectId ? `${root} is no longer a checkout of project ${projectId}` : null;
      if (gone !== null)
        return yield* Effect.logInfo('a queued commit is not recorded, because its checkout is not the project’s any more', {
          commit,
          reason: gone,
        });
      const landing = yield* Effect.result(Effect.provideService(landedTree(projectId, root, commit), Git, road.git));
      if (Result.isFailure(landing)) {
        if (!SETTLED_GIT.has(landing.failure.op)) return yield* new CommitRecordFailed({ reason: landing.failure.message });
        return yield* Effect.logInfo('a queued commit is no longer one its checkout carries, so nothing it let in is recorded', {
          commit,
          root,
          reason: landing.failure.message,
        });
      }
      const { judged, tree } = yield* recorded(op, projectId, root, Effect.succeed(landing.success), 'landed', caller);
      const unresolved = judged.watched.flatMap((one) =>
        'failed' in one && (one.cause === 'unsupported' || one.cause === 'module-map') ? [`${one.rule}: ${one.failed}`] : [],
      );
      if (tree === null || judged.refused !== null || judged.unjudged.some((one) => 'gate' in one) || unresolved.length > 0)
        return yield* new CommitRecordFailed({ reason: [whyUnjudged(judged), ...unresolved].filter((line) => line !== '').join('; ') });
      const failed = judged.watched.flatMap((one) => ('failed' in one ? [`${one.rule}: ${one.failed}`] : []));
      if (failed.length > 0)
        yield* Effect.logWarning('a landed commit is recorded without the rules that could not judge it; their re-measure judges them', {
          commit,
          root,
          failed: failed.join('; '),
        });
      const crossings = judged.watched.flatMap((one): RuleCrossing[] => ('fingerprint' in one ? [one] : []));
      if (options.driver === undefined) return;
      yield* options.driver.landed(op, {
        kind: 'tree',
        projectId,
        root: tree.root,
        commit,
        base: tree.base,
        paths: tree.paths,
        carried: crossings.map((one) => ({ ...one, holders: [holder] })),
        told: true,
        caller,
      });
    },
    (effect, queued) => effect.pipe(Effect.withSpan(`${queued.op}.after`)),
  );

  const landed = (op: string, subject: CommitSubject): Effect.Effect<CommitRecord> =>
    Effect.flatMap(owning(subject.root), (owner) => {
      const holder = holderOf(subject.caller);
      if ('unowned' in owner || road === undefined) {
        return Effect.succeed<CommitRecord>({
          commit: subject.commit,
          holder,
          unjudged: whyUnjudged('unowned' in owner ? owner.unowned : UNCHECKED),
        });
      }
      if (!OBJECT_ID.test(subject.commit)) {
        return Effect.succeed<CommitRecord>({
          commit: subject.commit,
          holder,
          unjudged: `${subject.commit} is not a full commit id, as \`git rev-parse HEAD\` prints one`,
        });
      }
      const queued: QueuedCommit = {
        op,
        projectId: owner.projectId,
        root: subject.root,
        commit: subject.commit,
        holder,
        caller: subject.caller === undefined ? undefined : actorRefOfTerminal(subject.caller),
      };
      return Effect.gen(function* () {
        const admitted = yield* Effect.result(road.queue.admit(queued));
        if (Result.isFailure(admitted)) {
          yield* Effect.logWarning('a landed commit could not be queued to be recorded', {
            commit: subject.commit,
            root: subject.root,
            reason: admitted.failure.reason,
          });
          return {
            commit: subject.commit,
            holder,
            unjudged: `it could not be queued to be recorded: ${admitted.failure.reason}`,
          } satisfies CommitRecord;
        }
        yield* Effect.annotateCurrentSpan({ 'record.waiting': admitted.success });
        return { commit: subject.commit, holder, waiting: admitted.success } satisfies CommitRecord;
      });
    });

  const wanted = options.triggers.wanted;

  const headBefore = (op: string, subject: HeadSubject): Effect.Effect<Checked> =>
    Effect.flatMap(options.triggers.at(subject.projectId, op, 'before', subject.root ?? null), ({ runs }) =>
      runs
        ? judgingHead(op, subject).pipe(
            Effect.tap((judged) => {
              const notice = watchedNotice(op, subject, judged);
              return notice === null || options.driver === undefined ? Effect.void : options.driver.tell(notice);
            }),
            Effect.withSpan(`${op}.before`),
          )
        : Effect.succeed(UNCHECKED),
    );

  return {
    before: (op, subject) =>
      subject.kind === 'file'
        ? Effect.succeed(UNCHECKED)
        : subject.kind === 'staged'
          ? staged(op, subject).pipe(
              Effect.flatMap((judged) =>
                subject.gate ? kept(standing, options.refusals, op, judged.tree, subject.caller, judged) : Effect.succeed(judged),
              ),
            )
          : subject.kind === 'tree'
            ? afterStart(subject.projectId, subject.rulesAt ?? subject.root, judging(op, subject)).pipe(
                Effect.flatMap((judged) => kept(standing, options.refusals, op, subject, subject.caller, judged)),
                Effect.withSpan(`${op}.before`),
              )
            : headBefore(op, subject),
    landed,
    after: (op, subject): Effect.Effect<AfterDelivery | void> => {
      const driver = options.driver;
      if (driver === undefined) return Effect.void;
      if (subject.kind === 'tree') return driver.landed(op, subject).pipe(Effect.withSpan(`${op}.after`));
      return Effect.flatMap(
        wanted(subject.projectId, op, 'after', subject.kind === 'head' ? (subject.root ?? null) : subject.root),
        (runs) => (runs ? driver.checked(op, subject).pipe(Effect.withSpan(`${op}.after`)) : Effect.void),
      );
    },
    record,
  };
};
