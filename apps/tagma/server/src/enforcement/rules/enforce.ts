import { type Assembled, BUILTINS, packOf } from '@tagma/inspection/builtins';
import { Clock, Effect, Result } from 'effect';
import type { Raised } from '@runlith/agent/permissions';
import { Blocks, type EnforcementWrite } from '../../graph/contract/service/blocks.js';
import { BlockNames, type BlockRow } from '../../graph/contract/service/acts.js';
import { Supersession } from '../../graph/contract/service/work.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { type CheckedViolation, type EnforcementPlan, inspectionBase, type RuleViolation, toldOf } from '../contract/wire/enforcement.js';
import { placeSaid } from '../contract/wire/findings.js';
import type { Targets } from '../judging/check.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { awaitingLanding } from './held.js';
import {
  checkOf,
  type CountedDebt,
  documentOf,
  isProgrammed,
  isUnrun,
  type Ledger,
  MAP_RECOVERY,
  type MapReading,
  type Programmed,
  readLaw,
  storedInspection,
} from '../contract/wire/document.js';
import { CONFIG_FILE } from '../../config/contract/wire/config.js';
import { configAt, descriptionsAt, inspectionIn } from './descriptions.js';
import { type EnforcedStrictness, type LawEnforcement, type Trigger } from '../../graph/contract/wire/enforcement.js';
import type { CheckSubjectKind } from '../../platform/contract/wire/operation.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { checkedTriggers } from '../contract/wire/checks.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { tagLabel } from '../../graph/contract/wire/tags/roles.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { followedDebt, lineageFrom, needsLineage, renamedBetween, renamedModuleDebt } from '../lineage.js';
import { declarationOf, keepMeasurement, measurementsOf, treeOf } from './measurements.js';
import { type CheckoutPlace, measureReach, movedUnder, placeOf, reachRefusal, standingAt } from './measure.js';
import { measureBound } from './measureBound.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { measuredRoot } from '../../graph/contract/service/serving.js';
import { Inspections } from '../workers/inspectionLanes.js';
import type { ReachRequest } from '../workers/asks.js';
import type { Footprint } from '@tagma/inspection/node/reading';
import { ledgerSources, partitionLedger } from './ledger.js';
import { enforcementField, isSwitchedOn, ownerStanding } from './predicate.js';
import { enforcedRules, moduleMapOf, reachOf } from './reach.js';
import { Sources } from '../../graph/contract/service/sources.js';
import { anchorsOf } from '../../graph/contract/wire/sources.js';
import { digest, revisionOf, storedLaw } from './revision.js';

export type ChangeFindings = {
  readonly violations: readonly CheckedViolation[];
  readonly counts: ReadonlyMap<string, number>;
};

export type ChangeCrossings = (target: Targets['targets'][number]) => Effect.Effect<ChangeFindings, GateRefusal<string> | StoreFailure>;

export type EnforceInput = {
  readonly change?: ChangeCrossings;
  readonly strictness: EnforcedStrictness;
  readonly on?: readonly Trigger[];
  readonly inspection?: string;
  readonly owners?: Readonly<Record<string, string>>;
  readonly owner?: string;
  readonly absorb?: 'all' | readonly string[];
  readonly caller: TerminalActor | null;
  readonly subjectOf: (op: string) => CheckSubjectKind | null;
  readonly base: string | null;
  readonly remap?: MapReading;
  readonly previousMap?: MapReading;
  readonly renamedModules?: ReadonlyMap<string, string>;
  readonly pinned?: Pinned;
};

export type Prepared = EnforcementPlan & {
  readonly check: Assembled | Programmed | null;
  readonly reading: MapReading;
  readonly projectId: number;
  readonly actor: TerminalActor;
  readonly id: number;
  readonly uuid: string;
  readonly anchors: readonly string[];
  readonly root: string | null;
  readonly at: string | null;
  readonly stood: unknown;
  readonly document: LawEnforcement | null;
  readonly read: readonly string[] | null;
  readonly footprint?: Footprint;
  readonly packCheck?: true;
  readonly consents: readonly Raised[];
  readonly code?: string;
  readonly sources?: Readonly<Record<string, string>>;
  readonly shelf?: string | undefined;
  readonly commonDir?: string | undefined;
};

const OPERATOR: TerminalActor = { _tag: 'Operator' };

const describedForm = (check: Assembled | Programmed): unknown => (isProgrammed(check) ? check.program : storedInspection(check));

const ownerNamed = Effect.fn('enforcement.ownerNamed')(function* (table: TagTable, projectId: number, name: string) {
  const blocks = yield* Blocks;
  const blockNames = yield* BlockNames;
  const found = yield* Effect.result(blockNames.idOfName(name));
  if (Result.isFailure(found)) {
    if (found.failure instanceof GateRefusal) {
      if (found.failure.code === 'not-found') return { why: `"${name}" answers no block of this project` };
    }
    return yield* Effect.fail(found.failure);
  }
  const row = yield* Effect.result(blocks.blockById(found.success));
  if (Result.isFailure(row)) {
    if (row.failure instanceof GateRefusal) {
      if (row.failure.code === 'deleted') return { why: `${name} rests in the trash` };
    }
    return yield* Effect.fail(row.failure);
  }
  const owner = row.success;
  if (owner.projectId !== projectId) return { why: `${name} belongs to another project` };
  const standing = yield* ownerStanding(table, owner);
  if (standing === 'not-owner') return { why: `${name} is ${tagLabel(table.tagOf(owner))}, and debt is owned by a task or a spec` };
  if (standing === 'ended') return { why: `${name} has ended` };
  if (standing === 'replaced') return { why: `${name} was replaced` };
  return blockName(owner.uuid);
});

const ownersOf = Effect.fn('enforcement.ownersOf')(function* (
  table: TagTable,
  projectId: number,
  wanted: readonly { readonly fingerprint: string; readonly name: string | undefined }[],
) {
  const named = new Map<string, string>();
  const unowned: { readonly fingerprint: string; readonly why: string }[] = [];
  const resolved = new Map<string, string | { readonly why: string }>();
  for (const { fingerprint, name } of wanted) {
    if (name === undefined) {
      unowned.push({ fingerprint, why: `${fingerprint} names no owner` });
      continue;
    }
    const owner = resolved.get(name) ?? (yield* ownerNamed(table, projectId, name));
    resolved.set(name, owner);
    if (typeof owner === 'string') named.set(fingerprint, owner);
    else unowned.push({ fingerprint, why: `${fingerprint}: ${owner.why}` });
  }
  return { named, unowned };
});

export type Pinned = CheckoutPlace & { readonly root: string };

const pinnedAt = Effect.fn('enforcement.pinnedAt')(function* (project: ProjectRow) {
  const root = yield* measuredRoot(project);
  return { root, ...(yield* placeOf(root)) } satisfies Pinned;
});

const measuredRule = Effect.fn('enforcement.measuredRule')(function* (
  project: ProjectRow,
  rule: string,
  inspection: Assembled | Programmed,
  places: readonly string[],
  caller: TerminalActor | null,
  at: Pinned,
  previous?: ReachRequest['previous'],
) {
  if (!isProgrammed(inspection)) return yield* measureReach(project, inspection, places, at, 'foreground', previous);
  return yield* measureBound(project.id, at.root, at.head, rule, inspection, places, caller);
});

export const planEnforcement = Effect.fn('enforcement.plan')(function* (row: BlockRow, ask: EnforceInput) {
  const supersession = yield* Supersession;
  const table = yield* (yield* Tags).of(row.projectId);
  const field = enforcementField(table, row);
  const name = blockName(row.uuid);
  if (field === null) {
    return yield* new GateRefusal('not-enforced', `${name} is ${tagLabel(table.tagOf(row))}, which binds no enforcement`, [
      'enforce a node whose tag binds core/enforced',
    ]);
  }
  if (yield* supersession.isSuperseded(row.id)) {
    return yield* new GateRefusal('superseded', `${name} was replaced, and a replaced rule binds nobody`, [
      `read_block ${name} — the edge names the rule that took its place; enforce that one`,
    ]);
  }
  const stood = row.fields[field];
  const reading = ask.remap ?? (yield* moduleMapOf(row.projectId));
  const document = yield* storedLaw(table, row);
  const was =
    document !== undefined ? { strictness: document.strictness, on: document.on } : stood === undefined ? null : ('unreadable' as const);
  const revision = revisionOf(document, stood);
  if (ask.remap === undefined && ask.base !== revision) {
    return yield* new GateRefusal(
      'enforcement-stale',
      `${name}'s enforcement stands at revision ${revision ?? 'none'}, and this input was built on ${ask.base ?? 'none'}: the document moved since it was read`,
      [
        `read_enforcement with rule ${name} answers its revision; rebuild the input on it and enforce_rule ${name} with base ${revision === null ? 'null' : `"${revision}"`}`,
      ],
    );
  }
  const actor = ask.caller ?? OPERATOR;
  const plan = {
    projectId: row.projectId,
    actor,
    id: row.id,
    uuid: row.uuid,
    anchors: anchorsOf(yield* (yield* Sources).of(row.id)),
    rule: name,
    title: row.title,
    stood,
    was,
    reading,
    code: (yield* Inspections).code,
    debt: { before: document?.debt ?? [] },
  };

  if (ask.strictness === 'off') {
    return {
      ...plan,
      strictness: 'off',
      on: null,
      inspection: null,
      check: null,
      head: null,
      root: null,
      at: null,
      places: [],
      debt: { before: plan.debt.before, after: [] },
      absorbed: [],
      retired: [],
      escaped: [],
      consents: [],
      unjudged: [],
      ms: null,
      document: null,
      read: [],
    } satisfies Prepared;
  }

  if (was === 'unreadable') {
    return yield* new GateRefusal(
      'field-invalid',
      `${name}'s enforcement document does not decode, so its debt and strictness cannot be read`,
      [
        `enforce_rule ${name} with strictness off first: the journal keeps the document it removes, and the next enforcement is a first one`,
      ],
    );
  }
  if (!isSwitchedOn(table, row)) {
    return yield* new GateRefusal('rule-disabled', `${name} is switched off, so no thread holds the rule an enforcement would judge by`, [
      `set_rule_enabled ${name} with enabled true first, then enforce it`,
    ]);
  }
  const key = ask.inspection ?? document?.inspection;
  if (key === undefined) {
    return yield* new GateRefusal(
      'inspection-required',
      `${name} carries no enforcement yet, so a first enforcement names its inspection`,
      [
        'name a key of the inspections tagma.config.ts declares at HEAD in `inspection`; read_config lists the keys, read_inspections with `key` answers one',
        'check_rules with the key and `over: "all"` — what it finds over this rule\'s reach',
      ],
    );
  }
  const project = yield* (yield* Projects).byId(row.projectId);
  const pinned = ask.pinned ?? (yield* pinnedAt(project));
  const version = { projectId: row.projectId, actor, root: pinned.root, tree: pinned.head, commonDir: pinned.commonDir };
  const config = yield* configAt(version);
  const inspection = yield* inspectionIn(config, version, key, reading);
  if (isUnrun(inspection)) {
    return yield* new GateRefusal(
      inspection.cause === 'module-map' ? 'module-map-invalid' : 'inspection-failed',
      inspection.unrun,
      inspection.cause === 'module-map' ? MAP_RECOVERY : ['check_rules with the inspection key after its description can be read'],
    );
  }
  const on = yield* checkedTriggers(ask.on ?? document?.on ?? [], ask.subjectOf);
  const places = yield* reachOf(row, inspectionBase(inspection));
  if (places.length === 0) return yield* reachRefusal(name, inspectionBase(inspection));
  const newBuiltin = !isProgrammed(inspection) && (document === undefined || document.inspection !== key);
  if (newBuiltin && !isProgrammed(inspection)) {
    const used = yield* (yield* Inspections)
      .packs({ root: pinned.root, commit: pinned.head })
      .pipe(
        Effect.mapError(
          (failure) =>
            new GateRefusal('inspection-failed', `the project packs at HEAD could not be read (${failure.cause}): ${failure.reason}`, [
              'read_inspections again after the checkout and its package manifests can be read',
            ]),
        ),
      );
    const pack = packOf(inspection.builtin);
    if (!used.includes(pack)) {
      return yield* new GateRefusal(
        'pack-unused',
        `${name}'s inspection belongs to the ${pack} pack, which this project's HEAD does not use`,
        [
          'read_inspections lists the functions the packs this project uses offer',
          `choose an inspection from a used pack, or add the ${pack} technology to the project's code before enforcing it`,
        ],
      );
    }
  }
  const prior = ask.previousMap === undefined || document === undefined ? undefined : readLaw(document, { config }, ask.previousMap).check;
  const previous =
    prior === undefined || isProgrammed(prior) || isUnrun(prior)
      ? undefined
      : {
          inspection: prior,
          fingerprints: [
            ...(document?.debt ?? []).map(({ fingerprint }) => fingerprint),
            ...(document?.escaped ?? []).map(({ fingerprint }) => fingerprint),
          ],
        };
  const standingLedger: Ledger = { debt: document?.debt ?? [], escaped: document?.escaped ?? [] };
  const measured = yield* measuredRule(project, name, inspection, places, ask.caller, pinned, previous);
  const at = new Date(yield* Clock.currentTimeMillis).toISOString();
  const partition = partitionLedger(standingLedger, undefined, undefined);
  const priorDebt = partition.selected.debt;
  const listed = ask.absorb === 'all' ? [] : (ask.absorb ?? []);
  const unmeasured = ask.remap === undefined ? listed.filter((fingerprint) => !measured.found.has(fingerprint)) : [];
  const pending = new Map<string, RuleViolation>();
  const pendingCounts = new Map<string, number>();
  if (unmeasured.length > 0 && ask.change !== undefined) {
    const wanted = new Set(unmeasured);
    const crossings = yield* ask
      .change({
        name,
        title: row.title,
        body: row.body,
        said: { rule: name, strictness: ask.strictness, on },
        gatesLanding: false,
        key,
        places,
        inspection,
        debt: priorDebt.filter((entry) => !wanted.has(entry.fingerprint)),
      })
      .pipe(
        Effect.mapError((failure) =>
          failure instanceof GateRefusal
            ? new GateRefusal(
                'inspection-failed',
                `absorb names ${unmeasured.length} fingerprint(s) absent at HEAD ${measured.head}, and this session's change could not be read to find them: ${failure.code}: ${failure.reason}`,
                failure.unblock,
              )
            : failure,
        ),
      );
    for (const crossing of crossings.violations) {
      if (!wanted.has(crossing.fingerprint)) continue;
      if (!pending.has(crossing.fingerprint)) pending.set(crossing.fingerprint, crossing);
      pendingCounts.set(crossing.fingerprint, crossings.counts.get(crossing.fingerprint)!);
    }
  }
  const absent = unmeasured.filter((fingerprint) => !pending.has(fingerprint));
  if (absent.length > 0)
    return yield* new GateRefusal(
      'inspection-failed',
      `absorb names ${absent.length} fingerprint(s) the inspection found neither at HEAD ${measured.head} nor in this session's uncommitted change: ${absent.join('; ')}`,
      [
        'check_rules with over "all" reads the fingerprints standing at HEAD, and over "change" those this session\'s change brings; absorb only those found',
        'a session absorbs what its own change brings: the session holding the change absorbs it',
      ],
    );
  const found: ReadonlyMap<string, RuleViolation> = pending.size === 0 ? measured.found : new Map([...measured.found, ...pending]);
  const counts: ReadonlyMap<string, number> = pending.size === 0 ? measured.counts : new Map([...measured.counts, ...pendingCounts]);
  const owners = ask.owners ?? {};

  const standingDebt = document === undefined ? [] : renamedModuleDebt(inspection, priorDebt, found, ask.renamedModules ?? new Map());
  const renamed =
    document !== undefined &&
    !isProgrammed(inspection) &&
    needsLineage(
      standingDebt.filter((entry) => entry.held === undefined),
      found,
    )
      ? yield* renamedBetween(
          measured.root,
          yield* lineageFrom(measured.root, row, (yield* measurementsOf(measured.root, [row.uuid], pinned.shelf)).get(row.uuid)),
          measured.head,
          inspection.params.base,
        )
      : [];
  const carriedDebt = isProgrammed(inspection) ? standingDebt : followedDebt(inspection, standingDebt, found, renamed);
  const awaiting = yield* awaitingLanding(measured.root, measured.head, carriedDebt, new Set(found.keys()));
  const stands = (fingerprint: string): boolean => found.has(fingerprint) || awaiting.has(fingerprint);
  const kept = carriedDebt.filter((entry) => stands(entry.fingerprint));
  const retired = carriedDebt.filter((entry) => !stands(entry.fingerprint)).map((entry) => entry.fingerprint);
  const standing = new Set(kept.map((entry) => entry.fingerprint));
  const outside = [...found.keys()].filter((fingerprint) => !standing.has(fingerprint));
  const grown = kept.filter((entry) => (counts.get(entry.fingerprint) ?? 0) > (entry.count ?? 1)).map((entry) => entry.fingerprint);

  const absorbing = new Set(ask.absorb === 'all' ? [...outside, ...grown] : listed);
  const escaping = new Set(document === undefined ? [] : [...outside, ...grown].filter((fingerprint) => !absorbing.has(fingerprint)));
  const { named, unowned } = yield* ownersOf(table, row.projectId, [
    ...kept.map((entry) => ({ fingerprint: entry.fingerprint, name: owners[entry.fingerprint] ?? entry.owner })),
    ...outside
      .filter((fingerprint) => !escaping.has(fingerprint))
      .map((fingerprint) => ({ fingerprint, name: owners[fingerprint] ?? ask.owner })),
  ]);
  const strays = unowned.filter((one) => pending.has(one.fingerprint));
  if (strays.length > 0)
    return yield* new GateRefusal(
      'inspection-failed',
      `a violation standing only in this session's uncommitted change becomes debt only under a standing owner, and ${strays.length} have none: ${strays.map((one) => one.why).join('; ')}`,
      ['name a standing task or spec in `owners` or `owner` for each, then absorb again'],
    );
  const ownerless = new Set(unowned.map((one) => one.fingerprint));
  const owing = (fingerprint: string): boolean => !ownerless.has(fingerprint) && !(escaping.has(fingerprint) && !standing.has(fingerprint));
  const owned = (fingerprint: string, standing: CountedDebt | undefined): CountedDebt => {
    const owner = named.get(fingerprint) ?? '';
    const waits = awaiting.has(fingerprint);
    const value = found.get(fingerprint)?.value ?? (waits ? standing?.value : undefined);
    const measuredCount = counts.get(fingerprint) ?? (waits ? (standing?.count ?? 1) : 1);
    const count = standing === undefined || absorbing.has(fingerprint) ? measuredCount : Math.min(standing.count ?? 1, measuredCount);
    const brought = pending.get(fingerprint);
    const held = brought !== undefined ? { base: measured.head, path: brought.file } : waits ? standing?.held : undefined;
    return { fingerprint, owner, value, count: count === 1 ? undefined : count, held };
  };
  const after = [
    ...kept.filter((entry) => owing(entry.fingerprint)).map((entry) => owned(entry.fingerprint, entry)),
    ...outside.filter(owing).map((fingerprint) => owned(fingerprint, undefined)),
  ];
  const absorbed =
    document === undefined
      ? []
      : [...outside, ...grown]
          .filter((fingerprint) => absorbing.has(fingerprint) && owing(fingerprint))
          .map((fingerprint) => owned(fingerprint, undefined));
  const owed = new Set(after.map((entry) => entry.fingerprint));
  const escapes = [...measured.found.values()]
    .filter((one) => !owed.has(one.fingerprint))
    .map((one) => ({
      fingerprint: one.fingerprint,
      path: one.file,
      line: one.line === undefined || one.line < 1 ? undefined : one.line,
      ...toldOf(one),
      commit: measured.head,
    }));
  const placed = (fingerprint: string): string => {
    const one = found.get(fingerprint);
    return one === undefined ? fingerprint : `${fingerprint} (${placeSaid(one)} ${toldOf(one).said})`;
  };
  const consents: Raised[] = [
    ...(escaping.size === 0
      ? []
      : [
          {
            condition: 'debt-grows',
            fact: `${escaping.size} violation(s) at ${measured.head} stand outside ${name}'s debt, and stay outside it, recorded as escaped: ${[...escaping].map(placed).join('; ')}`,
          },
        ]),
    ...(unowned.length === 0
      ? []
      : [
          {
            condition: 'debt-unowned',
            fact: `${unowned.length} violation(s) have no standing task or spec to own them, so they stand as escaped instead of debt: ${unowned.map((one) => one.why).join('; ')}`,
          },
        ]),
  ];

  const ledger = partition.merge({ debt: after, escaped: escapes });
  const { debt: allDebt, escaped: allEscapes } = ledger;
  const written = documentOf(ask.strictness, on, key, ledger);

  return {
    ...plan,
    strictness: ask.strictness,
    on,
    inspection: key,
    check: inspection,
    head: measured.head,
    root: measured.root,
    at,
    places,
    debt: { before: plan.debt.before, after: allDebt },
    absorbed,
    retired,
    escaped: allEscapes.map((one) => one.fingerprint),
    consents,
    unjudged: measured.verdict.unjudged,
    ms: measured.ms,
    document: written,
    sources: ledgerSources(ledger, found),
    read: measured.read,
    footprint: measured.footprint,
    packCheck: newBuiltin ? true : undefined,
    shelf: pinned.shelf,
    commonDir: pinned.commonDir,
  } satisfies Prepared;
});

const describedAgain = Effect.fnUntraced(function* (prepared: Prepared, key: string, check: Assembled | Programmed, head: string) {
  if (prepared.root === null) return false;
  const descriptions = yield* descriptionsAt({
    projectId: prepared.projectId,
    actor: prepared.actor,
    root: prepared.root,
    tree: head,
    commonDir: prepared.commonDir,
  });
  return digest(checkOf(key, descriptions, prepared.reading)) === digest(check);
});

export const staleUnder = Effect.fn('enforcement.staleUnder')(function* (prepared: Prepared, again: string) {
  if (prepared.root === null || prepared.head === null || prepared.inspection === null || prepared.check === null) return undefined;
  const { head, tree } = yield* standingAt(prepared.root, prepared.head);
  if (head === prepared.head) return tree;
  const read = prepared.read === null || prepared.footprint?.region === true ? null : new Set(prepared.read);
  const inputs = new Set([...(prepared.read ?? []), ...(prepared.footprint?.files ?? [])]);
  const moved = [
    ...(yield* movedUnder(prepared.root, prepared.head, head, prepared.places, read, prepared.packCheck === true, inputs)),
    ...((yield* describedAgain(prepared, prepared.inspection, prepared.check, head))
      ? []
      : [`${CONFIG_FILE}, whose description of ${prepared.inspection} changed`]),
  ];
  if (moved.length === 0) return tree;
  return yield* new GateRefusal(
    'enforcement-stale',
    `HEAD moved from ${prepared.head} to ${head} after ${prepared.rule}'s reach was measured, changing ${moved.length} path(s) its measurement or pack-use check stands on: ${moved.slice(0, 5).join(', ')}`,
    [`${again} again: prepare measures the reach at the HEAD that stands`],
  );
});

export const enforcementWriteOf = (prepared: Prepared): EnforcementWrite => ({
  id: prepared.id,
  anchors: prepared.anchors,
  stood: prepared.stood,
  document: prepared.document,
  journal: {
    strictness: prepared.strictness,
    on: prepared.on,
    inspection: prepared.inspection,
    described: prepared.check === null ? undefined : describedForm(prepared.check),
    head: prepared.head,
    debtBefore: prepared.debt.before,
    debtAfter: prepared.debt.after,
    absorbed: prepared.absorbed,
    retired: prepared.retired,
    ms: prepared.ms,
    was: prepared.stood ?? null,
  },
});

export const measurementKept = Effect.fn('enforcement.measurementKept')(function* (prepared: Prepared, tree: string | undefined) {
  if (
    prepared.document === null ||
    prepared.root === null ||
    prepared.head === null ||
    prepared.ms === null ||
    prepared.at === null ||
    prepared.check === null
  )
    return;
  const declaration = declarationOf(
    {
      strictness: prepared.document.strictness,
      on: prepared.document.on,
      inspection: prepared.document.inspection,
      check: prepared.check,
      debt: prepared.debt.after,
      escaped: prepared.document.escaped,
    },
    prepared.places,
  );
  yield* keepMeasurement(
    prepared.root,
    prepared.uuid,
    {
      commit: prepared.head,
      ms: prepared.ms,
      at: prepared.at,
      sources: prepared.sources,
      identity: {
        tree: tree ?? (yield* treeOf(prepared.root, prepared.head)),
        declaration,
        implementation: prepared.code,
      },
    },
    prepared.shelf,
  );
});

export const applyEnforcement = Effect.fn('enforcement.apply')(function* (prepared: Prepared) {
  const tree = yield* staleUnder(prepared, `enforce_rule ${prepared.rule}`);
  if (prepared.document === null && prepared.stood === undefined) return prepared;
  yield* (yield* Blocks).setEnforcement(enforcementWriteOf(prepared));
  yield* measurementKept(prepared, tree);
  return prepared;
});
