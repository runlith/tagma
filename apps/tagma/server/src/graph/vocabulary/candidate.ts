import { Result } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import { sha256 } from '@runlith/utils/sha256';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { blockName } from '../contract/wire/references.js';
import type { BehaviourRegistry } from '../contract/service/behaviours.js';
import type { Catalogs } from '../contract/wire/catalogs.js';
import {
  type Catalog,
  CATALOG_DECLARATION,
  type CatalogRelease,
  type Declaration,
  type Tag,
  TAG_DECLARATION,
} from '../contract/wire/tags/declaration.js';
import type { CatalogFinding } from '../contract/wire/tags/findings.js';
import {
  CORE_LIBRARY,
  type InstalledRelease,
  shippedTypeId,
  type TagIdentity,
  type TypeIdentities,
} from '../contract/wire/tags/identity.js';
import type { VocabularyRevision } from '../contract/wire/tags/revision.js';
import { type Fork, type GuidanceFork, type KeyedLayer, type SectionOrigin, shippedSections } from '../contract/wire/tags/sections.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { type Candidate as Entry, type Compiled, compileVocabulary, sameSchema, type TypeResolver } from './compiler.js';
import { blockedFinding, closedFinding, conflictFinding, forkFinding, staleFinding, type Subject } from './findings.js';
import { type DeclaredType, Identities } from './identity.js';
import {
  carrying,
  type Copy as Settling,
  type Forbidden,
  sectionsRevision,
  settle,
  type Settled,
  type SettledText,
  settleText,
  typeRevision,
} from './layers.js';

export type StandingType = {
  readonly row: number;
  readonly uuid: string;
  readonly name: string;
  readonly ord: number;
  readonly declaration: Declaration;
  readonly unread: string | null;
  readonly identity: TagIdentity | null;
  readonly layer: KeyedLayer | null;
  readonly fork: Fork | null;
};

export type StandingCatalog = {
  readonly row: number;
  readonly name: string;
  readonly id: string;
  readonly guidance: string;
  readonly members: readonly string[];
  readonly listed: readonly string[];
  readonly release: CatalogRelease | null;
  readonly layer: KeyedLayer | null;
  readonly fork: GuidanceFork | null;
  readonly unread: string | null;
};

export type Installed = { readonly types: readonly StandingType[]; readonly catalogs: readonly StandingCatalog[] };

export type TypeWrite = {
  readonly key: string;
  readonly row: number | null;
  readonly declaration: Declaration;
  readonly layer: KeyedLayer | null;
  readonly identity: TagIdentity | null;
  readonly fork?: Fork | null;
  readonly keepBody?: true;
};

export type CatalogWrite = {
  readonly catalog: string;
  readonly row: number | null;
  readonly guidance: string;
  readonly layer: KeyedLayer | null;
  readonly fork: GuidanceFork | null;
  readonly release: CatalogRelease;
  readonly members: readonly string[];
  readonly listed: readonly string[];
  readonly joining: readonly string[];
};

export type Change = 'text' | 'structural';

export type CatalogCandidate = {
  readonly id: string;
  readonly over: { readonly vocabulary: VocabularyRevision; readonly installed: string };
  readonly identities: TypeIdentities;
  readonly types: readonly TypeWrite[];
  readonly catalogs: readonly CatalogWrite[];
  readonly compiled: ReadonlyMap<string, Compiled>;
  readonly changed: ReadonlyMap<string, Change>;
  readonly affected: readonly string[];
};

export type CandidateRefusal = 'unknown-catalog' | 'field-invalid' | 'layer-forbidden' | 'type-collision';

type Refused = GateRefusal<CandidateRefusal>;

const digest = (value: unknown): string => sha256().update(canonicalJson(value)).digest('hex');

export const installedRevision = (installed: Installed): string => digest(installed);

export const releaseRevision = (catalog: Catalog): string => digest(catalog);

const ROLLED_BACK = 'correct the local declaration and repeat catalog installation; this installation was rolled back';

const forbiddenRefusal = (key: string, forbidden: readonly Forbidden[]): Refused =>
  new GateRefusal(
    'layer-forbidden',
    `#${key}: its layer edits what the shipped type closes: ${forbidden.map((one) => one.reason).join('; ')}`,
    [
      `drop those edits from the layer of #${key}, or keep the type as an explicit fork of the shipped one`,
      'ask the catalog for the parameter through a reflection, if many projects need it',
    ],
  );

type Plan = {
  readonly types: TypeWrite[];
  readonly layered: Map<string, Readonly<Record<string, SectionOrigin>>>;
  readonly claimed: Set<string>;
};

const retarget = (declaration: Declaration, catalogId: string, exports: ReadonlySet<string>): Declaration => {
  const own = (word: string): string => (exports.has(word) ? shippedTypeId(catalogId, word) : word);
  const fields = Object.fromEntries(
    Object.entries(declaration.fields ?? {}).map(([name, type]) =>
      typeof type === 'object' && type.type === 'ref' && type.tag !== undefined ? [name, { ...type, tag: own(type.tag) }] : [name, type],
    ),
  );
  return {
    ...declaration,
    extends: declaration.extends === undefined ? undefined : own(declaration.extends),
    fields,
    gates: (declaration.gates ?? []).map((gate) => (gate.gate === 'open-children' ? { ...gate, tag: own(gate.tag) } : gate)),
  };
};

const wanted = (shipped: Catalogs['Service'], catalogIds: readonly string[], retained: readonly string[]): Set<string> => {
  const ids = new Set([...catalogIds, ...retained]);
  if (shipped.byId(CORE_LIBRARY) !== null) ids.add(CORE_LIBRARY);
  return ids;
};

type Copy = {
  readonly own: StandingType | undefined;
  readonly held: boolean;
  readonly row: StandingType | undefined;
};

function copyOf(library: string, tag: Tag, installed: Installed, table: TagTable): Copy {
  const verified = table.identities.resolveStoredType(shippedTypeId(library, tag.id));
  const own = verified === null ? undefined : installed.types.find((row) => row.declaration.id === verified);
  const forked = installed.types.find((row) => row.fork?.library === library && row.fork.export === tag.id);
  const named = installed.types.find((row) => row.declaration.id === tag.id);
  const held =
    own === undefined &&
    forked === undefined &&
    named !== undefined &&
    (table.identities.typeOf(named.declaration.id)?.shipped ?? null) !== null;
  return { own, held, row: held ? undefined : (own ?? forked ?? named) };
}

const settling = (row: StandingType): Settling => ({ declaration: row.declaration, layer: row.layer, fork: row.fork });

type SettledCatalog = { readonly write: CatalogWrite; readonly findings: readonly CatalogFinding[] };

function retiredMembers(table: TagTable, installed: Installed, library: string, exports: ReadonlySet<string>): Set<string> {
  return new Set(
    installed.types.flatMap((row) => {
      const origin = row.identity?.shipped ?? table.identities.declaredBy(row.name)?.shipped;
      return origin?.library === library && !exports.has(origin.export) ? [row.name] : [];
    }),
  );
}

function settleCatalog(
  catalog: Catalog,
  standing: StandingCatalog | undefined,
  installed: Installed,
  table: TagTable,
  behaviours: BehaviourRegistry,
  plan: Plan,
  collect = false,
): Result.Result<SettledCatalog, Refused> {
  const base = standing?.release ?? null;
  const knownById = new Map((base?.tags ?? []).map((tag) => [tag.id, tag]));
  const exports = new Set<string>();
  for (const tag of catalog.tags) {
    if (exports.has(tag.id))
      return Result.fail(
        new GateRefusal('field-invalid', `${catalog.id} exports #${tag.id} more than once`, ['give each export in a catalog its own id']),
      );
    exports.add(tag.id);
  }
  const retired = retiredMembers(table, installed, catalog.id, exports);
  const structure = (declaration: Declaration) => retarget(declaration, catalog.id, exports);
  const releaseTags: Tag[] = [];
  const joining: string[] = [];
  const findings: CatalogFinding[] = [];
  const assigned = new Set<string>();
  const wrote = new Set<string>();
  for (const tag of catalog.tags) {
    const { own, held, row } = copyOf(catalog.id, tag, installed, table);
    const separate = held || (row === undefined && plan.claimed.has(tag.id));
    const key = separate ? table.identities.assignKey(catalog.id, tag.id, plan.claimed) : (own?.declaration.id ?? tag.id);
    if (key !== tag.id) assigned.add(tag.id);
    plan.claimed.add(key);
    const known = own === undefined ? null : (knownById.get(tag.id) ?? null);
    const settled: Result.Result<Settled, readonly Forbidden[]> =
      row === undefined || row.unread === null
        ? settle(shippedTypeId(catalog.id, tag.id), tag, row === undefined ? null : settling(row), known, behaviours, structure)
        : Result.succeed({ kind: 'kept', declaration: row.declaration, kept: { kind: 'migration-conflict', reason: row.unread } });
    const subject: Subject = { kind: 'type', catalog: catalog.id, name: row?.name ?? newName(key), key, export: tag.id };
    if (Result.isFailure(settled)) {
      if (!collect) return Result.fail(forbiddenRefusal(tag.id, settled.failure));
      findings.push(closedFinding(subject, settled.failure, tag.prompt, typeRevision(tag)));
      continue;
    }
    const outcome = settled.success;
    if (outcome.kind === 'shipped' && outcome.stale.length > 0) findings.push(staleFinding(subject, outcome.stale, tag.prompt));
    if (outcome.kind === 'kept') {
      if (outcome.kept.kind === 'fork') {
        if (outcome.kept.at !== outcome.kept.now) findings.push(forkFinding(subject, outcome.kept.at, outcome.kept.now, tag.prompt));
      } else {
        findings.push(conflictFinding(subject, outcome.kept.reason, tag.prompt, typeRevision(tag)));
      }
      if (known !== null) releaseTags.push(known);
      if (row !== undefined && canonicalJson(row.declaration) !== canonicalJson(outcome.declaration)) {
        plan.types.push({
          key,
          row: row.row,
          declaration: outcome.declaration,
          layer: row.layer,
          identity: row.identity,
          fork: row.fork,
          keepBody: true,
        });
      }
      continue;
    }
    releaseTags.push(tag);
    if (Object.keys(outcome.layered).length > 0) plan.layered.set(key, outcome.layered);
    const declaration: Declaration = separate ? structure({ ...outcome.declaration, id: key }) : { ...outcome.declaration, id: key };
    const identity = separate ? { shipped: { library: catalog.id, export: tag.id } } : (row?.identity ?? null);
    if (
      row === undefined ||
      canonicalJson(row.declaration) !== canonicalJson(declaration) ||
      canonicalJson(row.layer) !== canonicalJson(outcome.layer) ||
      canonicalJson(row.identity) !== canonicalJson(identity)
    ) {
      plan.types.push({ key, row: row?.row ?? null, declaration, layer: outcome.layer, identity });
      wrote.add(key);
    }
    if (row === undefined || !(standing?.members ?? []).includes(row.name)) joining.push(key);
  }
  const shippedGuidance = shippedSections(catalog.id, catalog.guidance);
  const guided = settleText(
    catalog.id,
    shippedGuidance,
    standing === undefined ? null : { text: standing.guidance, layer: standing.layer, fork: standing.fork },
    base === null ? null : shippedSections(catalog.id, base.guidance),
  );
  const guidanceSubject: Subject = { kind: 'guidance', catalog: catalog.id, name: standing?.name ?? catalog.id };
  if (Result.isFailure(guided)) {
    if (!collect) return Result.fail(forbiddenRefusal(`${catalog.id}.guidance`, guided.failure));
    findings.push(closedFinding(guidanceSubject, guided.failure, catalog.guidance, sectionsRevision(shippedGuidance)));
  }
  const outcome: SettledText | null =
    standing !== undefined && standing.unread !== null
      ? { kind: 'kept', kept: { kind: 'migration-conflict', reason: standing.unread } }
      : Result.isSuccess(guided)
        ? guided.success
        : null;
  if (outcome?.kind === 'shipped' && outcome.stale.length > 0)
    findings.push(staleFinding(guidanceSubject, outcome.stale, catalog.guidance));
  if (outcome?.kind === 'kept' && outcome.kept.kind === 'fork' && outcome.kept.at !== outcome.kept.now)
    findings.push(forkFinding(guidanceSubject, outcome.kept.at, outcome.kept.now, catalog.guidance));
  if (outcome?.kind === 'kept' && outcome.kept.kind === 'migration-conflict')
    findings.push(conflictFinding(guidanceSubject, outcome.kept.reason, catalog.guidance, sectionsRevision(shippedGuidance)));
  const guidance = outcome?.kind === 'shipped' ? outcome.text : (standing?.guidance ?? catalog.guidance);
  if (assigned.size > 0) {
    for (let at = 0; at < plan.types.length; at += 1) {
      const write = plan.types[at]!;
      if (!wrote.has(write.key)) continue;
      plan.types[at] = { ...write, declaration: retarget(write.declaration, catalog.id, assigned) };
    }
  }
  const release: CatalogRelease = {
    revision: releaseRevision(catalog),
    guidance: catalog.guidance,
    tags: releaseTags,
    profile: catalog.profile,
  };
  return Result.succeed({
    write: {
      catalog: catalog.id,
      row: standing?.row ?? null,
      guidance,
      layer: outcome?.kind === 'shipped' ? outcome.layer : (standing?.layer ?? null),
      fork: standing?.fork ?? null,
      release,
      members: (standing?.members ?? []).filter((name) => !retired.has(name)),
      listed: (standing?.listed ?? []).filter((name) => !retired.has(blockName(name.toLowerCase()))),
      joining,
    },
    findings,
  });
}

export function catalogFindings(
  table: TagTable,
  installed: Installed,
  shipped: Catalogs['Service'],
  behaviours: BehaviourRegistry,
): readonly CatalogFinding[] {
  const plan: Plan = { types: [], layered: new Map(), claimed: new Set(installed.types.map((row) => row.declaration.id)) };
  return installed.catalogs.flatMap((standing) => {
    const catalog = shipped.byId(standing.id);
    if (catalog === null || standing.release === null) return [];
    const blocked = standing.release.blocked === undefined ? [] : [blockedFinding(standing.id, standing.name, standing.release.blocked)];
    const settled = settleCatalog(catalog, standing, installed, table, behaviours, plan, true);
    return Result.isSuccess(settled) ? [...blocked, ...settled.success.findings] : blocked;
  });
}

function compiledOf(
  table: TagTable,
  installed: Installed,
  plan: Plan,
  behaviours: BehaviourRegistry,
  resolver: TypeResolver,
): Result.Result<ReadonlyMap<string, Compiled>, Refused> {
  const byRow = new Map(plan.types.flatMap((write) => (write.row === null ? [] : [[write.row, write] as const])));
  const rows = [...installed.types].sort((one, other) => one.ord - other.ord || one.row - other.row);
  const entries: Entry[] = [
    ...rows.map((row): Entry => {
      const written = byRow.get(row.row);
      const layered = plan.layered.get(written?.key ?? row.declaration.id);
      if (written === undefined) return { name: row.name, declaration: row.declaration, unread: row.unread, layered };
      return { name: row.name, declaration: written.declaration, unread: null, layered };
    }),
    ...plan.types.flatMap((write): Entry[] => {
      if (write.row !== null) return [];
      const layered = plan.layered.get(write.key);
      return [{ name: `#${write.key}`, declaration: write.declaration, unread: null, layered }];
    }),
  ];
  const touched = new Set(plan.types.map((write) => write.key));
  const parents = new Map<string, string | undefined>();
  for (const { declaration } of entries) {
    if (parents.has(declaration.id)) continue;
    parents.set(declaration.id, declaration.extends === undefined ? undefined : (resolver(declaration.extends) ?? declaration.extends));
  }
  const reaches = (id: string): boolean => {
    const seen = new Set<string>();
    for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = parents.get(at)) {
      if (touched.has(at)) return true;
      seen.add(at);
    }
    return false;
  };
  const compiled = new Map<string, Compiled>();
  for (const [at, outcome] of compileVocabulary(entries, behaviours, resolver).entries()) {
    if (outcome.kind === 'compiled') {
      compiled.set(outcome.compiled.tag.id, outcome.compiled);
      continue;
    }
    const { name, declaration } = entries[at]!;
    const written = touched.has(declaration.id);
    if (!written && !(reaches(declaration.id) && table.tagById(declaration.id) !== null)) continue;
    const reason =
      outcome.kind === 'duplicate' ? `${name} declares it beside the declaration this installation writes` : outcome.unreadable.reason;
    return Result.fail(
      new GateRefusal(
        'field-invalid',
        `#${declaration.id}: catalog upgrade refused: ${reason}`,
        outcome.kind === 'refused' ? (outcome.unblock ?? [ROLLED_BACK]) : [ROLLED_BACK],
      ),
    );
  }
  return Result.succeed(compiled);
}

const newName = (key: string): string => `#${key}`;

type Compilation = { compiled: ReadonlyMap<string, Compiled> };

function identitiesOf(installed: Installed, plan: Plan, catalogs: readonly CatalogWrite[], compilation: Compilation): Identities {
  const nameOf = new Map(installed.types.map((row) => [row.declaration.id, row.name] as const));
  const writtenIdentity = new Map(plan.types.map((write) => [write.key, write.identity] as const));
  const declared: DeclaredType[] = [
    ...installed.types.flatMap((row) =>
      row.declaration.id === ''
        ? []
        : [
            {
              key: row.declaration.id,
              declaration: row.name,
              uuid: row.uuid,
              identity: writtenIdentity.get(row.declaration.id) ?? row.identity,
            },
          ],
    ),
    ...plan.types.flatMap((write) =>
      write.row === null ? [{ key: write.key, declaration: newName(write.key), uuid: newName(write.key), identity: write.identity }] : [],
    ),
  ];
  const written = new Set(catalogs.map((write) => write.catalog));
  const releases: InstalledRelease[] = [
    ...installed.catalogs.flatMap((row) =>
      row.release === null || written.has(row.id)
        ? []
        : [
            {
              library: row.id,
              version: row.release.revision,
              exports: row.release.tags.map((tag) => tag.id),
              members: row.members,
            },
          ],
    ),
    ...catalogs.map((write) => ({
      library: write.catalog,
      version: write.release.revision,
      exports: write.release.tags.map((tag) => tag.id),
      members: [...write.members, ...write.joining.map((key) => nameOf.get(key) ?? newName(key))],
    })),
  ];
  return new Identities([TAG_DECLARATION.id, CATALOG_DECLARATION.id], declared, releases, {
    fieldsOf: (typeKey) => Object.keys(compilation.compiled.get(typeKey)?.tag.fields ?? {}),
    originOf: (typeKey, fieldKey) => compilation.compiled.get(typeKey)?.provenance.fields[fieldKey] ?? null,
  });
}

export function prepareCandidate(
  table: TagTable,
  installed: Installed,
  shipped: Catalogs['Service'],
  catalogIds: readonly string[],
  behaviours: BehaviourRegistry,
): Result.Result<CatalogCandidate, Refused> {
  const retained = installed.catalogs.flatMap((row) => (row.release !== null && shipped.byId(row.id) !== null ? [row.id] : []));
  const plan: Plan = { types: [], layered: new Map(), claimed: new Set(installed.types.map((row) => row.declaration.id)) };
  const catalogs: CatalogWrite[] = [];
  for (const id of wanted(shipped, catalogIds, retained)) {
    const catalog = shipped.byId(id);
    if (catalog === null) {
      return Result.fail(
        new GateRefusal('unknown-catalog', `no catalog named "${id}" is shipped`, [
          'name a shipped catalog, or create local #catalog and #tag declarations',
        ]),
      );
    }
    const settled = settleCatalog(
      catalog,
      installed.catalogs.find((row) => row.id === id),
      installed,
      table,
      behaviours,
      plan,
    );
    if (Result.isFailure(settled)) return Result.fail(settled.failure);
    catalogs.push(settled.success.write);
  }
  const compilation: Compilation = { compiled: new Map() };
  const identities = identitiesOf(installed, plan, catalogs, compilation);
  for (const [at, write] of plan.types.entries()) {
    if ((write.fork ?? null) !== null || write.identity?.shipped !== undefined) continue;
    const verified = identities.typeOf(write.key)?.shipped ?? null;
    if (verified !== null)
      plan.types[at] = { ...write, identity: { ...write.identity, shipped: { library: verified.library, export: verified.export } } };
  }
  for (const row of installed.types) {
    if (
      row.declaration.id === '' ||
      row.fork !== null ||
      row.identity?.shipped !== undefined ||
      plan.types.some((write) => write.key === row.declaration.id)
    )
      continue;
    const verified = table.identities.typeOf(row.declaration.id)?.shipped ?? null;
    if (verified === null) continue;
    plan.types.push({
      key: row.declaration.id,
      row: row.row,
      declaration: row.declaration,
      layer: row.layer,
      identity: { ...row.identity, shipped: { library: verified.library, export: verified.export } },
    });
  }
  const built = compiledOf(table, installed, plan, behaviours, (word) => identities.resolveStoredType(word));
  if (Result.isFailure(built)) return Result.fail(built.failure);
  const compiled = built.success;
  compilation.compiled = compiled;
  const changed = new Map<string, Change>();
  for (const { key } of plan.types) {
    const was = table.tagById(key);
    const now = compiled.get(key)?.tag;
    if (now === undefined) continue;
    if (was === null || !sameSchema(was, now)) changed.set(key, 'structural');
    else if (canonicalJson(was) !== canonicalJson(now)) changed.set(key, 'text');
  }
  const structural = new Set([...changed].flatMap(([key, change]) => (change === 'structural' ? [key] : [])));
  const affected =
    structural.size === 0
      ? []
      : [...compiled.values()].flatMap(({ tag, lineage }) => (lineage.some((id) => structural.has(id)) ? [tag.id] : []));
  const over = { vocabulary: table.revision(), installed: installedRevision(installed) };
  return Result.succeed({
    id: digest({ over, catalogs, types: plan.types }),
    over,
    identities,
    types: plan.types,
    catalogs,
    compiled,
    changed,
    affected,
  });
}

export function shippedIdentityMissing(table: TagTable, installed: Installed): boolean {
  return installed.types.some(
    (row) =>
      row.declaration.id !== '' &&
      row.identity?.shipped === undefined &&
      (table.identities.typeOf(row.declaration.id)?.shipped ?? null) !== null,
  );
}

export function releasesCurrent(
  table: TagTable,
  installed: Installed,
  shipped: Catalogs['Service'],
  catalogIds: readonly string[],
): boolean {
  const retained = installed.catalogs.flatMap((row) => (row.release !== null ? [row.id] : []));
  for (const id of wanted(shipped, catalogIds, retained)) {
    const standing = installed.catalogs.find((row) => row.id === id);
    if (!releaseCurrent(id, standing?.release ?? null, shipped)) return false;
    const catalog = shipped.byId(id);
    if (catalog === null || standing === undefined) continue;
    const retired = retiredMembers(table, installed, id, new Set(catalog.tags.map((tag) => tag.id)));
    if (standing.members.some((name) => retired.has(name))) return false;
  }
  return true;
}

export function carryMissing(table: TagTable, installed: Installed, shipped: Catalogs['Service'], catalogIds: readonly string[]): boolean {
  const retained = installed.catalogs.flatMap((row) => (row.release !== null ? [row.id] : []));
  for (const id of wanted(shipped, catalogIds, retained)) {
    const catalog = shipped.byId(id);
    if (catalog === null) continue;
    for (const tag of catalog.tags) {
      const { row } = copyOf(id, tag, installed, table);
      if (row !== undefined && row.unread === null && carrying(tag, row.declaration) !== row.declaration) return true;
    }
  }
  return false;
}

export function baseMissing(
  table: TagTable,
  installed: Installed,
  shipped: Catalogs['Service'],
  catalogIds: readonly string[],
  behaviours: BehaviourRegistry,
): boolean {
  const retained = installed.catalogs.flatMap((row) => (row.release !== null ? [row.id] : []));
  for (const id of wanted(shipped, catalogIds, retained)) {
    const catalog = shipped.byId(id);
    const release = installed.catalogs.find((row) => row.id === id)?.release ?? null;
    if (catalog === null || release === null) continue;
    for (const tag of catalog.tags) {
      if (release.tags.some((entry) => entry.id === tag.id)) continue;
      const { row } = copyOf(id, tag, installed, table);
      if (row === undefined || row.unread !== null) continue;
      const settled = settle(shippedTypeId(id, tag.id), tag, settling(row), null, behaviours);
      if (Result.isSuccess(settled) && settled.success.kind === 'shipped') return true;
    }
  }
  return false;
}

export function releaseCurrent(id: string, stored: CatalogRelease | null, shipped: Catalogs['Service']): boolean {
  const catalog = shipped.byId(id);
  return catalog !== null && stored?.revision === releaseRevision(catalog);
}
