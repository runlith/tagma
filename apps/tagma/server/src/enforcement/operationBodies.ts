import { randomUUID } from 'node:crypto';
import { said } from '../platform/contract/service/presentation.js';
import { keyOrder, page, type PageKey, type PageQuestion, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Context, Effect, Option, Result } from 'effect';
import { ChangeRecord } from '../change-record/contract/service/record.js';
import { applyEnforcement, type ChangeCrossings, ownersMatched, type Prepared, planEnforcement } from './rules/enforce.js';
import type { TreeSubject } from './contract/wire/checks.js';
import type { ChangeInput } from '../change-record/contract/service/prepared.js';
import { GateMemory, rememberGating } from './judging/gateMemory.js';
import { Remeasure } from './contract/service/remeasure.js';
import { inspectionsAnswer } from './rules/reads.js';
import { type RuleCheckInput, checkChange, type Checking as Checked, checkHead, checkTargets, type Targets } from './judging/check.js';
import { RuleChecks } from './contract/service/ruleChecks.js';
import { headOf } from './rules/measure.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { measuredRoot } from '../graph/contract/service/serving.js';
import { Projects } from '../projects/contract/service/registry.js';
import { GIT_COMMIT } from './contract/wire/landings.js';
import { PreparedChanges } from '../change-record/contract/service/prepared.js';
import { saidByGit } from '../change-record/prepared/subject.js';
import { notAdmitted, OwnGitFailed } from '../platform/git/ownGit.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { BlockNames, type BlockRow } from '../graph/contract/service/acts.js';
import { Blocks } from '../graph/contract/service/blocks.js';
import { Orientation } from '../graph/contract/service/orientation.js';
import { documentRunsUnasked, FINDING_UNHEARD } from '../graph/contract/wire/tags/law.js';
import type { LawEnforcement } from '../graph/contract/wire/enforcement.js';
import { settleJournalCall } from '../graph/journal/callRange.js';
import { landingPlace } from '../change-record/prepared/place.js';
import { selectCheckout } from '../change-record/prepared/selection.js';
import { Settings } from '../settings/contract/service/values.js';
import { checkoutMode } from '../graph/settings.js';
import { ServingGit } from '../executions/contract/service/git.js';
import { type CheckAnswer, type CheckedViolation, type InspectionsReading, shownBodies } from './contract/wire/enforcement.js';
import { VIOLATIONS } from './contract/wire/pages.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { type InputOf, type Refused, type TaggedBody, body, pair } from '../platform/contract/service/body.js';
import { OperationSubjects } from './contract/service/operationSubjects.js';
import { actorRefOfTerminal, custodianOf } from '../executions/terminals/principals.js';
import type { ActorRef } from '../platform/contract/wire/actor.js';
import { TerminalRefused } from '../executions/contract/wire/refusals.js';
import type { TerminalActor } from '../executions/contract/wire/terminals.js';
import { scoped } from '../graph/operations/crossing.js';
import { CallerWorkspace } from '../workspace/contract/service/places.js';
import { ServedTree } from '../graph/contract/service/serving.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import type { EnforcedAnswer } from './contract/wire/enforcement.js';
import { documentRevision } from './rules/revision.js';
import type { ConfigVersion } from '../config/contract/service/configs.js';
import { moduleMapOf } from './rules/reach.js';
import { ENFORCEMENT_OPERATIONS } from './contract/wire/operationCatalog.js';
import { checkedText, enforcedText, inspectionsText, modulesText } from './voice.js';
import { applyModules, type ModulesPrepared, planModules } from './rules/modules.js';
import type { ModulesSet } from './contract/wire/modules.js';
import { enforcementText } from './engineVoice.js';
import { rulesReading } from './rules/engines.js';
import { engineReading } from './rules/engineReading.js';
import { GraphSource } from '../graph/contract/service/source.js';

const answerOf = (plan: Prepared) => ({
  rule: plan.rule,
  title: plan.title,
  strictness: plan.strictness,
  was: plan.was,
  on: plan.on,
  inspection: plan.inspection,
  head: plan.head,
  places: plan.places,
  debt: { before: plan.debt.before.length, after: plan.debt.after.length },
  absorbed: plan.absorbed,
  retired: plan.retired,
  escaped: plan.escaped.length,
  unjudged: plan.unjudged,
  ms: plan.ms,
});

const actorOf = (caller: Caller, projectId: number): TerminalActor | null => {
  const actor = custodianOf(caller.actor, projectId);
  return actor instanceof TerminalRefused ? null : actor;
};

const actorRefOf = (caller: Caller, projectId: number): ActorRef => {
  const actor = actorOf(caller, projectId);
  return actor === null ? { kind: 'operator' } : actorRefOfTerminal(actor);
};

const violationKey = (row: CheckedViolation): PageKey => [
  row.rule,
  row.fingerprint,
  row.file,
  row.line ?? 0,
  row.specifier ?? row.message ?? '',
];
const ASCENDING = ['asc', 'asc', 'asc', 'asc', 'asc'] as const;

type Checking = { readonly row: BlockRow | undefined };

const checkAsk = (
  input: InputOf<typeof ENFORCEMENT_OPERATIONS.check_rules>,
  projectId: number,
  caller: Caller,
  prepared: Checking,
): RuleCheckInput => ({
  projectId,
  caller: actorOf(caller, projectId),
  rules: input.rules ?? 'all',
  inspection: input.inspection,
  row: prepared.row,
});

const OPERATOR: TerminalActor = { _tag: 'Operator' };

const versionAt = (ask: RuleCheckInput, root: string, tree: string, commonDir?: string): ConfigVersion => ({
  projectId: ask.projectId,
  actor: ask.caller ?? OPERATOR,
  root,
  tree,
  commonDir,
});

type CheckOwners =
  | Effect.Services<ReturnType<typeof checkTargets>>
  | Effect.Services<ReturnType<typeof checkHead>>
  | Effect.Services<ReturnType<typeof checkChange>>
  | Effect.Services<ReturnType<typeof landingPlace>>
  | Effect.Services<ReturnType<typeof selectCheckout>>
  | Effect.Services<ReturnType<typeof scoped>>
  | Effect.Services<ReturnType<typeof headOf>>
  | MachineStore
  | MachineUnits
  | PreparedChanges
  | ServingGit
  | RuleChecks
  | Remeasure
  | CurrentProject
  | GraphSource;

type ChangeServices =
  | Effect.Services<ReturnType<typeof checkTargets>>
  | Effect.Services<ReturnType<typeof checkChange>>
  | Effect.Services<ReturnType<typeof landingPlace>>
  | MachineStore
  | MachineUnits
  | PreparedChanges
  | Settings
  | ServingGit;

const checking = <A>(
  effect: Effect.Effect<A, Refused<typeof ENFORCEMENT_OPERATIONS.check_rules>, CheckOwners>,
): Effect.Effect<A, Refused<typeof ENFORCEMENT_OPERATIONS.check_rules>, CheckOwners> => effect;

type LandingPlace = Effect.Success<ReturnType<typeof landingPlace>>;

const judgedIn = (ask: RuleCheckInput, targets: Targets, change: TreeSubject) =>
  ask.inspection === undefined
    ? checkChange(ask, targets, change)
    : Effect.map(checkHead(ask, targets, { root: change.root, head: change.built }), (found) => ({ ...found, refuses: false }));

const overChange = Effect.fnUntraced(function* <A, E, R>(
  projectId: number,
  caller: Caller,
  place: LandingPlace,
  change: ChangeInput,
  use: (subject: TreeSubject) => Effect.Effect<A, E, R>,
) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const service = yield* PreparedChanges;
  const everything = (yield* (yield* Settings).value(checkoutMode, projectId)) === 'single';
  const outcome = yield* Effect.result(
    service.prepare({
      projectId,
      git: place.git,
      root: place.root,
      store,
      units,
      origin: place.origin,
      checkout: place.checkout,
      input: { ...change, everything },
      job: `check:${randomUUID()}`,
      caller: actorOf(caller, projectId) ?? undefined,
      act: actorRefOf(caller, projectId),
    }),
  );
  if (outcome._tag === 'Failure') {
    if (outcome.failure instanceof OwnGitFailed) {
      if (outcome.failure.admission !== undefined) return yield* notAdmitted(outcome.failure.admission);
      return yield* new GateRefusal('git-unavailable', `the change could not be built to check it: ${saidByGit(outcome.failure)}`, [
        'read what git said and clear it, then check again',
      ]);
    }
    return yield* outcome.failure;
  }
  const made = outcome.success.prepared;
  const reshaped = made === null ? (outcome.success.emptied?.reshaped ?? []) : made.built.reshaped;
  const formed = reshaped.map((one) => one.path).sort();
  if (made === null) return { ran: null, formed };
  return { ran: yield* use(made.subject).pipe(Effect.ensuring(service.release(made))), formed };
});

const changeCrossings = Effect.fnUntraced(function* (row: BlockRow, caller: Caller) {
  const projectId = row.projectId;
  if (caller.actor.kind !== 'thread') return undefined;
  const workspace = yield* Effect.serviceOption(CallerWorkspace);
  const record = yield* Effect.serviceOption(ChangeRecord);
  const changes = yield* Effect.serviceOption(PreparedChanges);
  const git = yield* Effect.serviceOption(ServingGit);
  if (Option.isNone(workspace) || Option.isNone(record) || Option.isNone(changes) || Option.isNone(git)) return undefined;
  const context = Context.make(CallerWorkspace, workspace.value).pipe(
    Context.add(ChangeRecord, record.value),
    Context.add(PreparedChanges, changes.value),
    Context.add(ServingGit, git.value),
    Context.merge(yield* Effect.context<Exclude<ChangeServices, CallerWorkspace | ChangeRecord | PreparedChanges | ServingGit>>()),
  );
  const ask: RuleCheckInput = { projectId, caller: actorOf(caller, projectId), rules: 'all' };
  const crossings: ChangeCrossings = Effect.fnUntraced(
    function* (target: Targets['targets'][number]) {
      const place = yield* landingPlace(projectId, caller, (yield* ServingGit).run);
      const { ran } = yield* overChange(projectId, caller, place, {}, (subject) =>
        Effect.gen(function* () {
          const refreshed =
            target.key === undefined
              ? { targets: [target] }
              : yield* checkTargets(
                  { ...ask, inspection: target.key, row },
                  versionAt(ask, subject.root, subject.built, subject.commonDir),
                );
          const targets = refreshed.targets.map((one) => ({
            ...one,
            name: target.name,
            title: target.title,
            said: target.said,
            gatesLanding: false,
            key: target.key,
            debt: target.inspection === null ? [] : target.debt,
          }));
          return yield* checkChange(ask, { targets }, subject);
        }),
      );
      const failed = ran?.rules.find((one) => one.failed !== undefined)?.failed;
      if (failed !== undefined)
        return yield* new GateRefusal('inspection-failed', `${target.name} could not run over this session's change: ${failed}`, [
          'check_rules with this rule over the change shows what runs and why it fails',
        ]);
      return { violations: ran?.violations ?? [], counts: ran?.counts.get(target.name) ?? new Map() };
    },
    (effect) => Effect.provide(effect, context),
  );
  return crossings;
});

const enforcing = <A, R>(
  effect: Effect.Effect<A, Refused<typeof ENFORCEMENT_OPERATIONS.enforce_rule>, R>,
): Effect.Effect<A, Refused<typeof ENFORCEMENT_OPERATIONS.enforce_rule>, R> => effect;

const enforcePreparing = Effect.fn('enforce_rule.prepare')(function* (
  input: InputOf<typeof ENFORCEMENT_OPERATIONS.enforce_rule>,
  caller: Caller,
) {
  const id = yield* (yield* BlockNames).idOfName(input.blockId);
  const row = yield* (yield* Blocks).blockById(id);
  const subjects = yield* OperationSubjects;
  const planned = yield* enforcing(
    planEnforcement(row, {
      change: yield* changeCrossings(row, caller),
      caller: actorOf(caller, row.projectId),
      subjectOf: subjects.of,
      base: input.base,
      strictness: input.strictness,
      on: input.on,
      inspection: input.inspection,
      owners: input.owners,
      owner: input.owner,
      absorb: input.absorb,
    }),
  );
  yield* enforcing(ownersMatched(input.owners, [planned]));
  return planned;
});

const unheard = Effect.fnUntraced(function* (rule: string, document: LawEnforcement | null) {
  if (documentRunsUnasked(document)) return undefined;
  const { id, projectId } = yield* scoped(rule);
  return (yield* (yield* Orientation).ruleReach(projectId)).get(id)?.delivery === 'finding' ? FINDING_UNHEARD : undefined;
});

const enforceExecuting = Effect.fnUntraced(function* (_input: InputOf<typeof ENFORCEMENT_OPERATIONS.enforce_rule>, prepared: Prepared) {
  yield* GateMemory;
  const driver = yield* Remeasure;
  const applied = yield* enforcing(applyEnforcement(prepared));
  const projectId = (yield* yield* CurrentProject).project.id;
  yield* rememberGating(projectId);
  yield* driver.enforced({ projectId, root: applied.root, rule: applied.rule });
  const plan = {
    ...answerOf(applied),
    revision: applied.document === null ? null : documentRevision(applied.document),
    graph: (yield* ServedTree)?.treeRoot ?? null,
    warning: yield* unheard(applied.rule, applied.document),
  } satisfies EnforcedAnswer;
  return { status: 'ok' as const, block: { name: plan.rule }, ...plan };
});

const blockNamed = Effect.fn('set_module.blockNamed')(function* (name: string) {
  const found = yield* Effect.result(scoped(name));
  if (Result.isSuccess(found)) return found.success;
  if (found.failure instanceof GateRefusal) return found.failure;
  return yield* Effect.fail(found.failure);
});

const modulesPreparing = Effect.fn('set_module.prepare')(function* (
  input: InputOf<typeof ENFORCEMENT_OPERATIONS.set_module>,
  caller: Caller,
) {
  const projectId = (yield* yield* CurrentProject).project.id;
  const subjects = yield* OperationSubjects;
  const modules = yield* Effect.forEach(input.modules, (ask) =>
    Effect.gen(function* () {
      const card = ask.block === undefined ? undefined : yield* blockNamed(ask.block);
      const under = ask.parent === undefined ? undefined : yield* blockNamed(ask.parent);
      return { ...ask, card, under };
    }),
  );
  return yield* planModules({
    projectId,
    modules,
    caller: actorOf(caller, projectId),
    subjectOf: subjects.of,
    owners: input.owners,
    owner: input.owner,
    absorb: input.absorb,
  });
});

const modulesExecuting = Effect.fnUntraced(function* (input: InputOf<typeof ENFORCEMENT_OPERATIONS.set_module>, prepared: ModulesPrepared) {
  if (input.preview === true)
    return {
      status: 'preview' as const,
      modules: prepared.modules,
      rules: prepared.rules,
      graph: (yield* ServedTree)?.treeRoot ?? null,
    } satisfies ModulesSet & { readonly status: 'preview' };
  yield* GateMemory;
  const driver = yield* Remeasure;
  const applied = yield* applyModules(prepared);
  yield* rememberGating(applied.projectId);
  for (const one of applied.measured) yield* driver.enforced({ projectId: applied.projectId, root: one.root, rule: one.rule });
  return {
    status: 'ok' as const,
    modules: applied.modules,
    rules: applied.rules,
    graph: (yield* ServedTree)?.treeRoot ?? null,
    crowded: applied.crowded.length === 0 ? undefined : applied.crowded,
  } satisfies ModulesSet & { readonly status: 'ok' };
});

type ModulesOwners =
  | Effect.Services<ReturnType<typeof modulesPreparing>>
  | Effect.Services<ReturnType<typeof modulesExecuting>>
  | Effect.Services<ReturnType<typeof settleJournalCall>>;

type EnforceOwners =
  | Effect.Services<ReturnType<typeof enforcePreparing>>
  | Effect.Services<ReturnType<typeof enforceExecuting>>
  | Effect.Services<ReturnType<typeof settleJournalCall>>;

type EnforceBody = Omit<
  TaggedBody<typeof ENFORCEMENT_OPERATIONS.enforce_rule, Prepared, EnforceOwners, Refused<typeof ENFORCEMENT_OPERATIONS.enforce_rule>>,
  'place'
> & { readonly place: typeof selectCheckout };

export const ENFORCEMENT_PAIRS = {
  enforce_rule: pair<typeof ENFORCEMENT_OPERATIONS.enforce_rule, EnforceBody>(ENFORCEMENT_OPERATIONS.enforce_rule, {
    ...body<typeof ENFORCEMENT_OPERATIONS.enforce_rule, Prepared, EnforceOwners>(ENFORCEMENT_OPERATIONS.enforce_rule, {
      prepare: enforcePreparing,
      execute: enforceExecuting,
      settle: settleJournalCall,
      voice: said(enforcedText),
    }),
    place: selectCheckout,
  }),

  set_module: pair(
    ENFORCEMENT_OPERATIONS.set_module,
    body<typeof ENFORCEMENT_OPERATIONS.set_module, ModulesPrepared, ModulesOwners>(ENFORCEMENT_OPERATIONS.set_module, {
      prepare: modulesPreparing,
      execute: modulesExecuting,
      settle: settleJournalCall,
      voice: said(modulesText),
    }),
  ),

  read_inspections: pair(
    ENFORCEMENT_OPERATIONS.read_inspections,
    body(ENFORCEMENT_OPERATIONS.read_inspections, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof ENFORCEMENT_OPERATIONS.read_inspections>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const projectId = (yield* yield* CurrentProject).project.id;
        const reading = input.map === true ? yield* moduleMapOf(projectId) : undefined;
        const answered = yield* inspectionsAnswer(input, projectId, actorOf(caller, projectId) ?? OPERATOR);
        return {
          status: 'ok' as const,
          ...answered,
          map: reading === undefined ? undefined : { ...reading.map, problems: reading.problems },
          graph: (yield* ServedTree)?.treeRoot ?? null,
        } satisfies InspectionsReading & { readonly status: 'ok' };
      }),
      voice: said(inspectionsText),
    }),
  ),

  check_rules: pair(
    ENFORCEMENT_OPERATIONS.check_rules,
    body<typeof ENFORCEMENT_OPERATIONS.check_rules, Checking, CheckOwners>(ENFORCEMENT_OPERATIONS.check_rules, {
      place: (input, caller) => ((input.over ?? 'change') === 'change' ? selectCheckout(input, caller) : Effect.succeed(null)),
      prepare: (input: InputOf<typeof ENFORCEMENT_OPERATIONS.check_rules>, caller: Caller) =>
        checking(
          Effect.gen(function* () {
            if (input.over === 'staged') return { row: undefined } satisfies Checking;
            const row = input.inspection === undefined || input.blockId === undefined ? undefined : yield* scoped(input.blockId);
            return { row } satisfies Checking;
          }).pipe(Effect.withSpan('check_rules.prepare')),
        ),
      execute: (input: InputOf<typeof ENFORCEMENT_OPERATIONS.check_rules>, prepared: Checking, caller: Caller) =>
        checking(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const projectId = call.project.id;
            const over = input.over ?? 'change';
            if (over === 'staged') return yield* stagedCheck(input, caller, projectId);
            const ask = checkAsk(input, projectId, caller, prepared);
            const ran = yield* over === 'all'
              ? Effect.gen(function* () {
                  const root = yield* measuredRoot(yield* (yield* Projects).byId(projectId));
                  const head = yield* headOf(root);
                  const targets = yield* checkTargets(ask, versionAt(ask, root, head));
                  const checking = yield* checkHead(ask, targets, { root, head });
                  return {
                    head: checking.head,
                    built: checking.head,
                    paths: [] as readonly string[],
                    formed: [] as readonly string[],
                    checking,
                  };
                })
              : Effect.gen(function* () {
                  const place = yield* landingPlace(projectId, caller, (yield* ServingGit).run);
                  const ready = yield* Effect.result((yield* Remeasure).ready(projectId, place.root));
                  const unjudged = Result.isFailure(ready) ? [{ gate: 'unread' as const, cause: ready.failure.reason }] : [];
                  const change = { paths: input.paths };
                  const { ran, formed } = yield* overChange(projectId, caller, place, change, (subject) =>
                    Effect.gen(function* () {
                      const targets = yield* checkTargets(
                        { ...ask, root: place.root },
                        versionAt(ask, subject.root, subject.built, subject.commonDir),
                      );
                      return {
                        head: subject.base,
                        built: subject.built,
                        paths: [...subject.paths].sort(),
                        checking: yield* judgedIn(ask, targets, subject),
                      };
                    }),
                  );
                  if (ran !== null)
                    return { ...ran, formed, checking: { ...ran.checking, unjudged: [...ran.checking.unjudged, ...unjudged] } };
                  const head = yield* headOf(place.root);
                  const targets = yield* checkTargets({ ...ask, root: place.root }, versionAt(ask, place.root, head));
                  if (ask.inspection !== undefined) {
                    const found = yield* checkHead(ask, targets, { root: place.root, head });
                    return {
                      head,
                      built: head,
                      paths: [] as readonly string[],
                      formed,
                      checking: { ...found, unjudged: [...found.unjudged, ...unjudged], refuses: false },
                    };
                  }
                  const nothing: Checked = {
                    head,
                    counts: new Map(),
                    violations: [],
                    fingerprints: [],
                    unjudged,
                    rules: [],
                    bodies: {},
                    refuses: false,
                  };
                  return { head, built: head, paths: [] as readonly string[], formed, checking: nothing };
                });
            const question: PageQuestion = {
              operation: 'check_rules',
              selection: {
                projectId,
                over,
                rules: input.rules ?? 'all',
                inspection: input.inspection,
                blockId: input.blockId,
                head: ran.head,
                built: ran.built,
              },
              order: VIOLATIONS.order,
            };
            const continued = input.cursor === undefined ? undefined : readCursor(input.cursor, question);
            if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
            const rows = ran.checking.violations.toSorted((left, right) => keyOrder(ASCENDING)(violationKey(left), violationKey(right)));
            const cut = page({
              rows: continued === undefined ? rows : pastKey(rows, violationKey, ASCENDING, continued.at),
              asked: pageRows(input.limit, VIOLATIONS, ceilingOf(VIOLATIONS)),
              keyOf: violationKey,
              question,
              total: rows.length,
            });
            return {
              status: 'ok' as const,
              over,
              head: ran.head,
              paths: ran.paths,
              formed: ran.formed.length === 0 ? undefined : ran.formed,
              violations: cut.rows,
              shown: cut.shown,
              total: rows.length,
              next: cut.next,
              fingerprints: ran.checking.fingerprints,
              bodies: shownBodies(ran.checking.bodies, cut.rows),
              unjudged: ran.checking.unjudged,
              rules: ran.checking.rules,
              refuses: ran.checking.refuses,
              reader: (yield* GraphSource).source ?? null,
            } satisfies CheckAnswer & { readonly status: 'ok' };
          }),
        ),
      voice: said(checkedText),
    }),
  ),

  read_enforcement: pair(
    ENFORCEMENT_OPERATIONS.read_enforcement,
    body(ENFORCEMENT_OPERATIONS.read_enforcement, {
      execute: Effect.fnUntraced(function* (input: InputOf<typeof ENFORCEMENT_OPERATIONS.read_enforcement>, _prepared: undefined) {
        const projectId = (yield* yield* CurrentProject).project.id;
        const graph = (yield* ServedTree)?.treeRoot ?? null;
        if (input.rule === undefined)
          return { status: 'ok' as const, ...(yield* rulesReading(projectId, input.limit, input.cursor)), graph };
        const row = yield* scoped(input.rule);
        return {
          status: 'ok' as const,
          ...(yield* engineReading({ projectId, row, focus: input.focus, asked: input.limit, cursor: input.cursor })),
          graph,
        };
      }),
      voice: said(enforcementText),
    }),
  ),

  gate_commit: pair(
    ENFORCEMENT_OPERATIONS.gate_commit,
    body(ENFORCEMENT_OPERATIONS.gate_commit, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof ENFORCEMENT_OPERATIONS.gate_commit>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const projectId = (yield* yield* CurrentProject).project.id;
        return yield* stagedAnswer(yield* stagedJudged(input, caller, projectId, true), undefined, undefined);
      }),
    }),
  ),

  record_commit: pair(
    ENFORCEMENT_OPERATIONS.record_commit,
    body(ENFORCEMENT_OPERATIONS.record_commit, {
      execute: Effect.fnUntraced(function* (
        input: InputOf<typeof ENFORCEMENT_OPERATIONS.record_commit>,
        _prepared: undefined,
        caller: Caller,
      ) {
        const call = yield* yield* CurrentProject;
        const actor = actorOf(caller, call.project.id);
        const record = yield* (yield* RuleChecks).landed(GIT_COMMIT, {
          kind: 'commit',
          projectId: call.project.id,
          root: input.root,
          commit: input.commit,
          caller: actor ?? undefined,
        });
        return { status: 'ok' as const, record };
      }),
    }),
  ),
};

type StagedAsk = { readonly root?: string; readonly index?: string };

const stagedRoot = Effect.fn('check_rules.stagedRoot')(function* (input: StagedAsk, projectId: number) {
  return input.root ?? (yield* CallerWorkspace)?.root ?? (yield* measuredRoot(yield* (yield* Projects).byId(projectId)));
});

const stagedJudged = Effect.fn('enforcement.stagedJudged')(function* (input: StagedAsk, caller: Caller, projectId: number, gate: boolean) {
  const actor = actorOf(caller, projectId);
  const root = yield* stagedRoot(input, projectId);
  const judged = yield* (yield* RuleChecks).before(GIT_COMMIT, {
    kind: 'staged',
    projectId,
    root,
    index: input.index,
    gate,
    caller: actor ?? undefined,
  });
  const crossings: readonly CheckedViolation[] = [
    ...(judged.crossed ?? []),
    ...judged.watched.flatMap((one): CheckedViolation[] => ('fingerprint' in one ? [one] : [])),
  ];
  const question: PageQuestion = {
    operation: 'check_rules',
    selection: { projectId, over: 'staged', root, head: judged.tree?.base ?? '', built: judged.tree?.built ?? '' },
    order: VIOLATIONS.order,
  };
  const rows = crossings.toSorted((left, right) => keyOrder(ASCENDING)(violationKey(left), violationKey(right)));
  return { judged, question, rows };
});

const stagedCheck = Effect.fn('check_rules.staged')(function* (
  input: InputOf<typeof ENFORCEMENT_OPERATIONS.check_rules>,
  caller: Caller,
  projectId: number,
) {
  const staged = yield* stagedJudged(input, caller, projectId, false);
  const continued = input.cursor === undefined ? undefined : readCursor(input.cursor, staged.question);
  if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
  return yield* stagedAnswer(staged, input.limit, continued?.at);
});

const stagedAnswer = Effect.fnUntraced(function* (
  { judged, question, rows }: Effect.Success<ReturnType<typeof stagedJudged>>,
  limit: number | undefined,
  after: PageKey | undefined,
) {
  const cut = page({
    rows: after === undefined ? rows : pastKey(rows, violationKey, ASCENDING, after),
    asked: pageRows(limit, VIOLATIONS, ceilingOf(VIOLATIONS)),
    keyOf: violationKey,
    question,
    total: rows.length,
  });
  const head = judged.tree?.base ?? '';
  return {
    status: 'ok' as const,
    over: 'staged',
    head,
    paths: judged.tree?.paths ?? [],
    violations: cut.rows,
    shown: cut.shown,
    total: rows.length,
    next: cut.next,
    fingerprints: [...new Set(rows.map((one) => one.fingerprint))].sort(),
    bodies: shownBodies(judged.bodies, cut.rows),
    unjudged: judged.unjudged,
    rules: judged.runs ?? [],
    refuses: judged.refused !== null,
    refusal: judged.refused ?? undefined,
    reader: (yield* GraphSource).source ?? null,
  } satisfies CheckAnswer & { readonly status: 'ok' };
});
