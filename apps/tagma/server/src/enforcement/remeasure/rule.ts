import { newViolations } from '@tagma/inspection/verdict';
import { ancestorAt, commitsAt } from '@runlith/git/history';
import { Git } from '@runlith/git/Git';
import { diffTreeAt, treePresentAt } from '@runlith/git/trees';
import { canonicalJson } from '@runlith/utils/object';
import { Clock, Effect } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { homesOfHolders } from '../../change-record/record/sessions.js';
import {
  type CarriedViolation,
  type Measurement,
  crossingOf,
  inspectionBase,
  inspectionFileLocal,
  type RuleCrossing,
  type RuleViolation,
  toldOf,
} from '../contract/wire/enforcement.js';
import { findingLines } from '../contract/wire/findings.js';
import type { Debt, Escape } from '../../graph/contract/wire/enforcement.js';
import { type CountedDebt, documentOf, isProgrammed, isUnrun, type Law } from '../contract/wire/document.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { enforcementField } from '../rules/predicate.js';
import { type EscapeNotice, type FileSubject, RULE_ESCAPED_SIGNAL } from '../contract/wire/checks.js';
import { fileTree } from '../judging/trees.js';
import { judgement } from '../judging/judge.js';
import { measuredDebt } from '../rules/debt.js';
import { declarationOf, keepMeasurement, measuredAs, measurementsOf, treeOf } from '../rules/measurements.js';
import { measureReach, type Measured, placeOf } from '../rules/measure.js';
import { measureBound } from '../rules/measureBound.js';
import { awaitingLanding, judgedDebt } from '../rules/held.js';
import { ledgerHasSources, ledgerSources, partitionLedger } from '../rules/ledger.js';
import { gitUnread } from '../workers/unread.js';
import { Inspections } from '../workers/inspectionLanes.js';
import { afterTriggered, covers, type Enforced, enforcedRules, runsOn } from '../rules/reach.js';
import { escapeOrigins } from './origin.js';

export type Carried = CarriedViolation & { readonly commit: string; readonly told?: true };

export type Aim =
  | { readonly _tag: 'Landed'; readonly op: string; readonly commit: string; readonly paths: readonly string[] }
  | { readonly _tag: 'Moved' }
  | { readonly _tag: 'Checked'; readonly op: string }
  | { readonly _tag: 'Enforced'; readonly rule: string }
  | { readonly _tag: 'Start' };

export type Remeasured =
  | { readonly _tag: 'Skipped' }
  | { readonly _tag: 'Stale' }
  | {
      readonly _tag: 'Measured';
      readonly rule: string;
      readonly head: string;
      readonly retired: readonly Debt[];
      readonly escaped: readonly Escape[];
      readonly fixed: readonly Escape[];
      readonly notices: readonly EscapeNotice[];
      readonly tracing?: Tracing;
    };

export type Tracing = {
  readonly rule: string;
  readonly uuid: string;
  readonly measured: Measured;
  readonly previous: Measurement | undefined;
  readonly debt: readonly CountedDebt[];
  readonly untraced: readonly { readonly first: RuleViolation; readonly at: RuleViolation }[];
  readonly law: Law;
  readonly places: readonly string[];
  readonly tree: string;
  readonly code: string | undefined;
  readonly at: string;
  readonly commonDir: string | undefined;
  readonly shelf: string | undefined;
};

const kept = (tracing: Tracing, law: Law) =>
  keepMeasurement(
    tracing.measured.root,
    tracing.uuid,
    {
      commit: tracing.measured.head,
      ms: tracing.measured.ms,
      at: tracing.at,
      sources: ledgerSources(law, tracing.measured.found, tracing.previous?.sources),
      remeasure: tracing.measured.remeasure,
      identity: { tree: tracing.tree, declaration: declarationOf(law, tracing.places), implementation: tracing.code },
    },
    tracing.shelf,
  );

const RUNS: ReadonlySet<Law['strictness']> = new Set(['watch', 'gate']);

const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const SKIPPED: Remeasured = { _tag: 'Skipped' };

const STALE: Remeasured = { _tag: 'Stale' };

const reached = Effect.fn('enforcement.reached')(function* (root: string, commit: string) {
  const git = actingGit(yield* Git, 'enforcement-head');
  return yield* ancestorAt(git, root, commit, 'HEAD');
});

export type Ruled = {
  readonly name: string;
  readonly title: string;
  readonly document: Law;
  readonly reach: Enforced['reach'];
  readonly entry: Enforced & { readonly document: Law };
  readonly field: string;
};

export type RuleSnapshot = {
  readonly root: string;
  readonly head: string;
  readonly commonDir: string | undefined;
  readonly shelf: string | undefined;
  readonly ruled: readonly Ruled[];
};

export const ruleSnapshot = Effect.fn('enforcement.ruleSnapshot')(function* (projectId: number) {
  const root = yield* measuredRoot(yield* (yield* Projects).byId(projectId));
  const table = yield* (yield* Tags).of(projectId);
  const { head, commonDir, shelf } = yield* placeOf(root);
  const version = { projectId, actor: { _tag: 'Operator' } as const, root, tree: head, commonDir };
  const ruled = (yield* enforcedRules(projectId, version)).flatMap((entry): Ruled[] => {
    const field = enforcementField(table, entry.rule);
    if (entry.document === null || field === null) return [];
    const { document } = entry;
    return [
      { name: blockName(entry.rule.uuid), title: entry.rule.title, document, reach: entry.reach, entry: { ...entry, document }, field },
    ];
  });
  return { root, head, commonDir, shelf, ruled } satisfies RuleSnapshot;
});

export const chosenRules = Effect.fn('enforcement.chosenRules')(function* (projectId: number, aim: Aim, snapshot?: RuleSnapshot) {
  const { root, head, shelf, ruled } = snapshot ?? (yield* ruleSnapshot(projectId));
  const previous =
    aim._tag === 'Moved'
      ? yield* measurementsOf(
          root,
          ruled.map((entry) => entry.entry.rule.uuid),
          shelf,
        )
      : undefined;
  const changes = new Map<string, readonly string[] | null>();
  const moved = Effect.fnUntraced(function* (tree: string | undefined) {
    if (tree === undefined) return null;
    if (changes.has(tree)) return changes.get(tree)!;
    const git = actingGit(yield* Git, 'enforcement-remeasure');
    const paths = (yield* treePresentAt(git, root, tree).pipe(Effect.mapError(gitUnread)))
      ? (yield* diffTreeAt(git, root, tree, head).pipe(Effect.mapError(gitUnread))).map((entry) => entry.path)
      : null;
    changes.set(tree, paths);
    return paths;
  });
  if (aim._tag === 'Landed' && !(yield* reached(root, aim.commit))) return null;
  const rules: string[] = [];
  const untouched: { readonly entry: Ruled; readonly places: readonly string[] }[] = [];
  let enforcing = false;
  for (const entry of ruled) {
    const { document, name } = entry;
    if (!RUNS.has(document.strictness) || document.on.length === 0) continue;
    enforcing = true;
    const inspection = document.check;
    if (isUnrun(inspection)) continue;
    if (aim._tag === 'Start' || (aim._tag === 'Enforced' && aim.rule === name)) rules.push(name);
    if (aim._tag === 'Checked' && afterTriggered(document, aim.op)) rules.push(name);
    if (aim._tag === 'Moved') {
      const measured = previous?.get(entry.entry.rule.uuid);
      const places = yield* entry.reach(inspectionBase(inspection));
      if (measured?.identity?.declaration !== declarationOf(document, places)) rules.push(name);
      else {
        const paths = yield* moved(measured.identity.tree);
        if (paths === null || paths.some(covers(places))) rules.push(name);
      }
    }
    if (aim._tag !== 'Landed' || !runsOn(document, aim.op)) continue;
    const places = yield* entry.reach(inspectionBase(inspection));
    if (aim.paths.some(covers(places))) rules.push(name);
    else untouched.push({ entry, places });
  }
  if (untouched.length > 0) {
    const measured = yield* measurementsOf(
      root,
      untouched.map(({ entry }) => entry.entry.rule.uuid),
      shelf,
    );
    for (const { entry, places } of untouched) {
      const declared = measured.get(entry.entry.rule.uuid)?.identity?.declaration;
      if (declared !== undefined && declared !== declarationOf(entry.document, places)) rules.push(entry.name);
    }
  }
  return { root, enforcing, rules };
});

export const startRules = Effect.fn('enforcement.startRules')(function* (snapshot: RuleSnapshot, rules: readonly string[]) {
  const code = (yield* Inspections).code;
  if (code === undefined || rules.length === 0) return rules;
  const { root, head } = snapshot;
  const wanted = new Set(rules);
  const ruled = snapshot.ruled.filter((entry) => wanted.has(entry.name));
  const tree = yield* treeOf(root, head);
  const previous = yield* measurementsOf(
    root,
    ruled.map((entry) => entry.entry.rule.uuid),
    snapshot.shelf,
  );
  const selected: string[] = [];
  for (const entry of ruled) {
    const inspection = entry.document.check;
    if (isUnrun(inspection)) continue;
    if (isProgrammed(inspection)) {
      selected.push(entry.name);
      continue;
    }
    const places = yield* entry.reach(inspectionBase(inspection));
    if (
      !measuredAs(previous.get(entry.entry.rule.uuid), { tree, declaration: declarationOf(entry.document, places), implementation: code })
    ) {
      selected.push(entry.name);
      continue;
    }
    const held = entry.document.debt.filter((one) => one.held !== undefined);
    if ((yield* awaitingLanding(root, head, held, new Set<string>())).size !== held.length) selected.push(entry.name);
  }
  return selected;
});

type Placed = RuleViolation & { readonly line: number };

const isPlaced = (one: RuleViolation): one is Placed => one.line !== undefined;

const lineOf = (violations: readonly Placed[], hint: Carried): Placed | undefined =>
  violations.find((one) => one.fingerprint === hint.fingerprint && one.file === hint.file && one.line === hint.line) ??
  violations.find((one) => one.fingerprint === hint.fingerprint && one.file === hint.file && one.specifier === hint.specifier);

type Told = { readonly carried: Carried; readonly finding: RuleCrossing };

const withheldNote = ({ carried }: Told): string => (carried.withheld === undefined ? '' : `standing only on ${carried.withheld}`);

const noticeText = (rule: string, body: string, commit: string, lines: readonly Told[]) => {
  const written = lines.filter((one) => one.carried.withheld === undefined);
  const standing = lines.filter((one) => one.carried.withheld !== undefined);
  const one = standing.length === 1;
  const shown = (told: readonly Told[]) =>
    findingLines(
      told.map((line) => ({ ...line.finding, told: line })),
      '  ',
      (line) => withheldNote(line.told),
      { [rule]: body },
    );
  return [
    ...(written.length === 0
      ? []
      : [
          `${written.length === 1 ? 'A line' : `${written.length} lines`} the change record holds as yours crossed ${rule} and landed in ${commit} with another session's commit:`,
          ...shown(written),
          `Each stands in the rule's escaped violations and raises ${RULE_ESCAPED_SIGNAL} until it is gone. Where the code belongs there and the place itself is shaped wrong, enforce_rule absorbs it as debt owned by a new task naming the area.`,
        ]),
    ...(standing.length === 0
      ? []
      : [
          `${one ? 'An import' : `${standing.length} imports`} another session landed in ${commit} cross${one ? 'es' : ''} ${rule} only because the branch lacks a path you hold uncommitted:`,
          ...shown(standing),
          `Each stands in the rule's escaped violations and raises ${RULE_ESCAPED_SIGNAL} until the path it stands on lands: submit_work with it ends the crossing.`,
        ]),
  ].join('\n');
};

const noticesOf = Effect.fn('enforcement.escapeNotices')(function* (
  projectId: number,
  rule: string,
  body: string,
  standing: readonly Told[],
) {
  const owed = new Map<string, Told[]>();
  for (const one of standing) {
    if (one.carried.told === true) continue;
    for (const holder of new Set(one.carried.holders)) {
      const key = `${holder}\0${one.carried.commit}`;
      owed.set(key, [...(owed.get(key) ?? []), one]);
    }
  }
  if (owed.size === 0) return [];
  const homes = yield* homesOfHolders(
    yield* MachineStore,
    [...owed.keys()].map((key) => key.split('\0')[0]!),
  );
  return [...owed].flatMap(([key, lines]): EscapeNotice[] => {
    const [threadId = '', commit = ''] = key.split('\0');
    const home = homes.get(threadId);
    return home === undefined
      ? []
      : [
          {
            projectId: home,
            threadId,
            id: `${RULE_ESCAPED_SIGNAL}:${projectId}:${rule}:${commit}`,
            text: noticeText(rule, body, commit, lines),
          },
        ];
  });
});

type LedgerNext = {
  readonly debt: readonly CountedDebt[];
  readonly escaped: readonly Escape[];
  readonly journal: Readonly<Record<string, unknown>>;
};

const ledgerWritten = Effect.fn('enforcement.remeasureWritten')(function* (ruled: Ruled, next: LedgerNext) {
  const { entry, field } = ruled;
  const document = documentOf(ruled.document.strictness, ruled.document.on, ruled.document.inspection, {
    debt: next.debt,
    escaped: next.escaped,
  });
  const outcome = yield* Effect.result(
    (yield* Blocks).setEnforcement({
      id: entry.rule.id,
      anchors: entry.anchors,
      stood: entry.rule.fields[field],
      document,
      op: 'remeasure',
      journal: next.journal,
    }),
  );
  if (outcome._tag === 'Success') return true;
  if (outcome.failure instanceof GateRefusal && outcome.failure.code === 'enforcement-stale') return false;
  return yield* Effect.fail(outcome.failure);
});

const standingOver = Effect.fnUntraced(function* (projectId: number, rule: string, head: string, law: Law, places: readonly string[]) {
  const latest = yield* ruleSnapshot(projectId);
  const current = latest.ruled.find((one) => one.name === rule);
  if (latest.head !== head || current === undefined) return undefined;
  return declarationOf(current.document, yield* current.reach(inspectionBase(current.document.check))) === declarationOf(law, places)
    ? current
    : undefined;
});

const carriedSince = Effect.fn('enforcement.carriedSince')(function* (
  root: string,
  head: string,
  previous: Measurement | undefined,
  escaped: readonly Escape[],
  carried: readonly Carried[],
) {
  if (carried.length === 0) return carried;
  const git = actingGit(yield* Git, 'enforcement-carried');
  const commits = [...new Set(carried.map((hint) => hint.commit).filter((commit) => OBJECT_NAME.test(commit)))];
  const present = yield* commitsAt(git, root, [...commits, ...(previous === undefined ? [] : [previous.commit])]).pipe(
    Effect.mapError(gitUnread),
  );
  const boundary =
    previous !== undefined &&
    present.has(previous.commit) &&
    (yield* ancestorAt(git, root, previous.commit, head).pipe(Effect.mapError(gitUnread)))
      ? previous.commit
      : undefined;
  const reachable = new Set<string>();
  const older = new Set<string>();
  for (const commit of commits) {
    if (!present.has(commit) || !(yield* ancestorAt(git, root, commit, head).pipe(Effect.mapError(gitUnread)))) continue;
    reachable.add(commit);
    if (boundary !== undefined && (yield* ancestorAt(git, root, commit, boundary).pipe(Effect.mapError(gitUnread)))) older.add(commit);
  }
  const continuous = new Set(escaped.map((one) => `${one.fingerprint}\0${one.commit}`));
  return carried.filter(
    (hint) => reachable.has(hint.commit) && (!older.has(hint.commit) || continuous.has(`${hint.fingerprint}\0${hint.commit}`)),
  );
});

export const remeasureRule = Effect.fn('enforcement.remeasureRule')(function* (
  projectId: number,
  rule: string,
  carried: readonly Carried[],
  refresh = true,
) {
  yield* Effect.annotateCurrentSpan({ 'enforcement.rule': rule, 'project.id': projectId });
  const snapshot = yield* ruleSnapshot(projectId);
  yield* Effect.annotateCurrentSpan('checkout.root', snapshot.root);
  const ruled = snapshot.ruled.find((one) => one.name === rule);
  if (ruled === undefined || !RUNS.has(ruled.document.strictness)) return SKIPPED;
  const { document } = ruled;
  yield* Effect.annotateCurrentSpan('inspection.key', document.inspection);
  const inspection = document.check;
  if (isUnrun(inspection)) return SKIPPED;
  const places = yield* ruled.reach(inspectionBase(inspection));
  if (places.length === 0) return SKIPPED;
  const uuid = ruled.entry.rule.uuid;
  const { head } = snapshot;
  const tree = yield* treeOf(snapshot.root, head);
  const previous = (yield* measurementsOf(snapshot.root, [uuid], snapshot.shelf)).get(uuid);
  const declaration = declarationOf(document, places);
  const code = (yield* Inspections).code;
  let confirmed: ReadonlySet<string> | undefined;
  if (!isProgrammed(inspection) && !refresh && measuredAs(previous, { tree, declaration, implementation: code })) {
    const held = document.debt.filter((one) => one.held !== undefined);
    confirmed = yield* awaitingLanding(snapshot.root, head, held, new Set<string>());
    if (confirmed.size === held.length) return SKIPPED;
  }
  const identity = previous?.identity;
  const candidate =
    identity !== undefined &&
    ledgerHasSources(document, previous?.sources) &&
    (isProgrammed(inspection)
      ? identity.declaration === declaration
      : inspectionFileLocal(inspection) && measuredAs(previous, { tree: identity.tree, declaration, implementation: code }))
      ? identity.tree
      : undefined;
  const basis =
    candidate === undefined || candidate === tree
      ? candidate
      : (yield* treePresentAt(actingGit(yield* Git, 'enforcement-remeasure'), snapshot.root, candidate).pipe(Effect.mapError(gitUnread)))
        ? candidate
        : undefined;
  let paths =
    basis !== undefined
      ? [
          ...new Set([
            ...(yield* diffTreeAt(actingGit(yield* Git, 'enforcement-remeasure'), snapshot.root, basis, tree).pipe(
              Effect.mapError(gitUnread),
            )).map((entry) => entry.path),
            ...carried.map((entry) => entry.file),
            ...document.debt.flatMap((entry) => (entry.held === undefined ? [] : [entry.held.path])),
          ]),
        ].filter(covers(places))
      : undefined;
  if (isProgrammed(inspection) && paths?.length === 0) return SKIPPED;
  let comparison = isProgrammed(inspection) && basis !== undefined && previous?.remeasure === 'delta' ? previous.commit : undefined;
  if (
    comparison !== undefined &&
    !(yield* commitsAt(actingGit(yield* Git, 'enforcement-remeasure'), snapshot.root, [comparison]).pipe(Effect.mapError(gitUnread))).has(
      comparison,
    )
  ) {
    comparison = undefined;
    paths = undefined;
  }
  const measured: Measured = isProgrammed(inspection)
    ? yield* measureBound(projectId, snapshot.root, head, rule, inspection, places, { _tag: 'Operator' }, paths, 'background', comparison)
    : yield* measureReach(
        yield* (yield* Projects).byId(projectId),
        inspection,
        places,
        { root: snapshot.root, head },
        'background',
        undefined,
        paths,
      );
  const at = new Date(yield* Clock.currentTimeMillis).toISOString();
  yield* Effect.annotateCurrentSpan('measurement.scope', paths === undefined ? 'reach' : 'paths');
  if (paths !== undefined) yield* Effect.annotateCurrentSpan('measurement.paths', paths.length);
  const { found, verdict } = measured;
  const partition = partitionLedger(document, paths, previous?.sources, measured.coverage);
  const { debt, standing, retired, followed } = yield* measuredDebt({
    rule: ruled.entry.rule,
    inspection,
    debt: partition.selected.debt,
    measured,
    previous,
    confirmed,
  });
  const revalued = debt.filter((one, at) => canonicalJson(one) !== canonicalJson(standing[at]));
  const excess = newViolations(verdict.violations, [], judgedDebt(debt)).violations;
  const outside = new Set(excess.map((one) => one.fingerprint));
  const fixed = partition.selected.escaped.filter((one) => !outside.has(one.fingerprint));
  const violations = excess.filter(isPlaced);
  const firsts = new Map<string, RuleViolation>();
  for (const one of excess) if (!firsts.has(one.fingerprint)) firsts.set(one.fingerprint, one);
  const eligible = yield* carriedSince(measured.root, measured.head, previous, partition.selected.escaped, carried);
  const standingLines = eligible.filter((hint) => lineOf(violations, hint) !== undefined);
  const hints = new Map<string, Carried>();
  for (const hint of standingLines) if (!hints.has(hint.fingerprint)) hints.set(hint.fingerprint, hint);
  const held: Escape[] = [];
  const standingEscapes = partition.selected.escaped.flatMap((one): Escape[] => {
    if (!outside.has(one.fingerprint)) return [];
    const hint = one.holder === undefined ? hints.get(one.fingerprint) : undefined;
    const holder = hint?.holders[0];
    if (hint === undefined || holder === undefined) return [one];
    const claimed = { ...one, holder, commit: OBJECT_NAME.test(hint.commit) ? hint.commit : one.commit };
    held.push(claimed);
    return [claimed];
  });
  const recorded = new Set(standingEscapes.map((one) => one.fingerprint));
  const proved = (hint: Carried | undefined): hint is Carried => hint !== undefined && OBJECT_NAME.test(hint.commit);
  const entering = [...firsts].flatMap(([fingerprint, first]) => {
    if (recorded.has(fingerprint)) return [];
    const hint = hints.get(fingerprint);
    return [{ fingerprint, first, hint, at: (hint === undefined ? undefined : lineOf(violations, hint)) ?? first }];
  });
  const hinted = entering.flatMap(({ fingerprint, hint, at }): Escape[] =>
    proved(hint) ? [{ fingerprint, path: at.file, line: at.line, ...toldOf(at), commit: hint.commit, holder: hint.holders[0] }] : [],
  );
  const untraced = entering.flatMap(({ first, hint, at }) => (proved(hint) ? [] : [{ first, at }]));
  const notices = yield* noticesOf(
    projectId,
    rule,
    ruled.entry.rule.body,
    standingLines.map((carried): Told => {
      const norm = { rule, title: ruled.title, strictness: document.strictness };
      return { carried, finding: crossingOf(norm, inspection, lineOf(violations, carried) ?? carried, carried.withheld) };
    }),
  );
  const settling = yield* standingOver(projectId, rule, measured.head, document, places);
  if (settling === undefined) return STALE;
  let settledLaw: Law = document;
  if (retired.length > 0 || hinted.length > 0 || fixed.length > 0 || held.length > 0 || followed.length > 0 || revalued.length > 0) {
    const ledger = partition.merge({ debt, escaped: [...standingEscapes, ...hinted] });
    const wrote = yield* ledgerWritten(settling, {
      ...ledger,
      journal: {
        head: measured.head,
        places,
        retired,
        escaped: hinted,
        fixed,
        held: held.length === 0 ? undefined : held,
        followed: followed.length === 0 ? undefined : followed,
        revalued: revalued.length === 0 ? undefined : revalued,
        ms: measured.ms,
      },
    });
    if (!wrote) return STALE;
    settledLaw = { ...document, ...ledger };
  }
  const tracing: Tracing = {
    rule,
    uuid,
    measured,
    previous,
    debt,
    untraced,
    law: settledLaw,
    places,
    tree,
    code,
    at,
    commonDir: measured.root === snapshot.root ? snapshot.commonDir : undefined,
    shelf: measured.root === snapshot.root ? snapshot.shelf : undefined,
  };
  if (untraced.length === 0) yield* kept(tracing, settledLaw);
  return {
    _tag: 'Measured',
    rule,
    head: measured.head,
    retired,
    escaped: hinted,
    fixed,
    notices,
    tracing: untraced.length === 0 ? undefined : tracing,
  } satisfies Remeasured;
});

export const traceEscapes = Effect.fn('enforcement.traceEscapes')(function* (projectId: number, tracing: Tracing) {
  const { rule, measured, places, law } = tracing;
  const tracer = yield* standingOver(projectId, rule, measured.head, law, places);
  if (tracer === undefined) return STALE;
  const origins = yield* escapeOrigins({
    projectId,
    ruled: tracer,
    measured,
    commonDir: tracing.commonDir,
    previous: tracing.previous,
    debt: tracing.debt,
    violations: tracing.untraced.map(({ first }) => first),
  });
  const escaped = tracing.untraced.flatMap(({ first, at }): Escape[] => {
    const origin = origins.get(first.fingerprint);
    return origin === undefined
      ? []
      : [{ fingerprint: first.fingerprint, path: at.file, line: at.line, ...toldOf(at), commit: origin.commit, changed: origin.changed }];
  });
  const writer = yield* standingOver(projectId, rule, measured.head, law, places);
  if (writer === undefined) return STALE;
  const ledger = { debt: law.debt, escaped: [...law.escaped, ...escaped] };
  const wrote = yield* ledgerWritten(writer, { ...ledger, journal: { head: measured.head, places, escaped, ms: measured.ms } });
  if (!wrote) return STALE;
  yield* kept(tracing, { ...law, ...ledger });
  return { _tag: 'Measured', rule, head: measured.head, retired: [], escaped, fixed: [], notices: [] } satisfies Remeasured;
});

export const fileCheck = Effect.fn('enforcement.fileCheck')(function* (op: string, subject: FileSubject) {
  const tree = yield* fileTree(subject.root, subject.paths);
  const judged = yield* judgement(
    op,
    {
      kind: 'tree',
      projectId: subject.projectId,
      root: subject.root,
      base: tree.base,
      built: tree.built,
      paths: subject.paths,
      caller: subject.caller,
    },
    undefined,
    'after',
  );
  const caller = subject.caller;
  if (caller?._tag !== 'Thread') return [];
  const crossed = judged.watched.flatMap((one) => ('fingerprint' in one ? [one] : []));
  const failed = judged.watched.flatMap((one) => ('failed' in one ? [one] : []));
  if (crossed.length === 0 && failed.length === 0) return [];
  const text = [
    ...(crossed.length === 0
      ? []
      : [
          `After ${op} of ${subject.paths.join(', ')}, ${crossed.length === 1 ? 'a crossing' : `${crossed.length} crossings`} of rules triggered after ${op} stand in the file's new text against HEAD:`,
          ...findingLines(crossed, '  ', undefined, judged.bodies),
        ]),
    ...failed.map((one) => `  ${one.rule} could not run: ${one.failed}`),
    'Nothing was recorded: this tells you, and refuses nothing.',
  ].join('\n');
  const standing = [...crossed.map((one) => `${one.rule}:${one.fingerprint}`), ...failed.map((one) => `${one.rule}:${one.cause}`)]
    .sort()
    .join(',');
  return [
    { projectId: caller.projectId, threadId: caller.threadId, id: `rule-checked:${subject.projectId}:${op}:${standing}`, text },
  ] satisfies EscapeNotice[];
});
