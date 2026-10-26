import { Result } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { canonicalJson } from '@runlith/utils/object';
import { sha256 } from '@runlith/utils/sha256';
import { type CatalogRelease, type Declaration, type Tag, TAG_DEFAULTS } from '../contract/wire/tags/declaration.js';
import { shippedTypeId } from '../contract/wire/tags/identity.js';
import type { Fork, KeyedLayer, LayerEdit, Section, SectionEdit, SectionOrigin } from '../contract/wire/tags/sections.js';
import type { BehaviourRegistry } from '../contract/service/behaviours.js';
import { compose, SECTION_JOIN } from './compiler.js';

export type Stale = { readonly section: string; readonly edit: SectionEdit; readonly reason: 'changed' | 'removed' };

export type Forbidden = { readonly section: string; readonly edit: SectionEdit; readonly reason: string };

export type Layered = {
  readonly sections: readonly Section[];
  readonly layered: Readonly<Record<string, SectionOrigin>>;
  readonly stale: readonly Stale[];
};

export type Copy = {
  readonly declaration: Declaration;
  readonly layer: KeyedLayer | null;
  readonly fork: Fork | null;
};

export type Structure = (declaration: Declaration) => Declaration;

export type Kept =
  | { readonly kind: 'fork'; readonly at: string; readonly now: string }
  | { readonly kind: 'migration-conflict'; readonly reason: string };

export type Settled =
  | {
      readonly kind: 'shipped';
      readonly declaration: Declaration;
      readonly layer: KeyedLayer | null;
      readonly layered: Readonly<Record<string, SectionOrigin>>;
      readonly stale: readonly Stale[];
    }
  | { readonly kind: 'kept'; readonly declaration: Declaration; readonly kept: Kept };

const digest = (value: unknown): string => sha256().update(canonicalJson(value)).digest('hex');

export const typeRevision = (tag: Tag): string => digest(tag);

export const sectionRevision = (section: Section): string => digest({ key: section.key, text: section.text });

const joined = (head: string, tail: string): string => (head === '' ? tail : tail === '' ? head : `${head}${SECTION_JOIN}${tail}`);

export type ReleaseBase = { readonly library: string; readonly release: CatalogRelease };

export function baseSectionsOf(releases: readonly ReleaseBase[], typeId: string): readonly Section[] | null {
  for (const { library, release } of releases) {
    for (const tag of release.tags) {
      if (shippedTypeId(library, tag.id) !== typeId) continue;
      return tag.sections ?? [{ key: tag.id, text: tag.prompt }];
    }
  }
  return null;
}

export function writtenLayer(
  key: string,
  typeId: string | null,
  layer: KeyedLayer,
  base: readonly Section[] | null,
): Result.Result<{ readonly sections: readonly Section[]; readonly prompt: string }, GateRefusal<'layer-forbidden' | 'field-invalid'>> {
  if (typeId === null || layer.type !== typeId) {
    return Result.fail(
      new GateRefusal('field-invalid', `#${key}.layer names ${layer.type}, not this type's permanent id`, [
        `write layer.type as this type's id${typeId === null ? '' : ` ${typeId}`}: a layer stands over the type it was accepted for`,
      ]),
    );
  }
  if (base === null) {
    return Result.fail(
      new GateRefusal('field-invalid', `#${key} has no installed release base, so a layer cannot stand over it`, [
        'a layer edits a shipped type whose release this project records; a local type is edited directly',
      ]),
    );
  }
  const applied = applyLayer(base, layer);
  if (Result.isFailure(applied)) {
    return Result.fail(
      new GateRefusal(
        'layer-forbidden',
        `#${key}: its layer edits what the shipped type closes: ${applied.failure.map((one) => one.reason).join('; ')}`,
        [`drop those edits from the layer of #${key}`],
      ),
    );
  }
  return Result.succeed({ sections: applied.success.sections, prompt: composedText(applied.success.sections) });
}

export function applyLayer(base: readonly Section[], layer: KeyedLayer): Result.Result<Layered, readonly Forbidden[]> {
  const edits = new Map<string, LayerEdit>();
  const forbidden: Forbidden[] = [];
  for (const edit of layer.edits) {
    if (edits.has(edit.section))
      forbidden.push({ section: edit.section, edit: edit.edit, reason: `a layer edits section "${edit.section}" once` });
    else edits.set(edit.section, edit);
  }
  const sections: Section[] = [];
  const layered: Record<string, SectionOrigin> = {};
  const stale: Stale[] = [];
  for (const section of base) {
    const edit = edits.get(section.key);
    if (edit === undefined) {
      sections.push(section);
      continue;
    }
    edits.delete(section.key);
    const allowed = section.edits ?? [];
    if (!allowed.includes(edit.edit)) {
      forbidden.push({
        section: section.key,
        edit: edit.edit,
        reason: `section "${section.key}" takes ${allowed.length === 0 ? 'no edit' : allowed.join(', ')}, and the layer ${edit.edit}s it`,
      });
      continue;
    }
    layered[section.key] = { edit: edit.edit, over: edit.over };
    if (edit.edit !== 'append' && sectionRevision(section) !== edit.over)
      stale.push({ section: section.key, edit: edit.edit, reason: 'changed' });
    if (edit.edit === 'hide') continue;
    sections.push({ ...section, text: edit.edit === 'replace' ? (edit.text ?? '') : joined(section.text, edit.text ?? '') });
  }
  for (const edit of edits.values()) {
    stale.push({ section: edit.section, edit: edit.edit, reason: 'removed' });
    if (edit.edit === 'hide' || edit.text === undefined || edit.text === '') continue;
    layered[edit.section] = { edit: edit.edit, over: edit.over };
    sections.push({ key: edit.section, text: edit.text });
  }
  return forbidden.length > 0 ? Result.fail(forbidden) : Result.succeed({ sections, layered, stale });
}

const PARTS = ['extends', 'fields', 'edges', 'sources', 'gates', 'roles', 'body', 'open'] as const;

const partOf = (declaration: Declaration, part: (typeof PARTS)[number]): unknown => {
  if (part === 'fields') return declaration.fields ?? TAG_DEFAULTS.fields;
  if (part === 'edges') return declaration.edges ?? TAG_DEFAULTS.edges;
  if (part === 'gates') return declaration.gates ?? TAG_DEFAULTS.gates;
  if (part === 'roles') return declaration.roles ?? TAG_DEFAULTS.roles;
  if (part === 'body') return declaration.body ?? TAG_DEFAULTS.body;
  return declaration[part];
};

export const differing = (one: Declaration, other: Declaration): string[] =>
  PARTS.filter((part) => canonicalJson(partOf(one, part)) !== canonicalJson(partOf(other, part)));

const textOf = (declaration: Declaration, behaviours: BehaviourRegistry): string | null => {
  const composed = compose({ name: `#${declaration.id}`, declaration }, null, behaviours);
  return Result.isSuccess(composed) ? composed.success.tag.prompt : null;
};

function layeredShipped(shipped: Tag, layer: KeyedLayer | null): Result.Result<Settled, readonly Forbidden[]> {
  if (layer === null) return Result.succeed({ kind: 'shipped', declaration: shipped, layer: null, layered: {}, stale: [] });
  const applied = applyLayer(shipped.sections ?? [], layer);
  if (Result.isFailure(applied)) return Result.fail(applied.failure);
  const { sections, layered, stale } = applied.success;
  return Result.succeed({ kind: 'shipped', declaration: { ...shipped, sections }, layer, layered, stale });
}

export const composedText = (sections: readonly Section[]): string =>
  sections.flatMap((section) => (section.text === '' ? [] : [section.text])).join(SECTION_JOIN);

export const sectionsRevision = (sections: readonly Section[]): string => digest(sections);

export function appended(type: string, local: string, base: string, sections: readonly Section[] | undefined): KeyedLayer | null {
  const last = sections?.at(-1);
  if (last === undefined || !(last.edits ?? []).includes('append')) return null;
  const head = base === '' ? '' : `${base}${SECTION_JOIN}`;
  if (!local.startsWith(head) || local.length === head.length) return null;
  return { type, edits: [{ section: last.key, edit: 'append', text: local.slice(head.length), over: sectionRevision(last) }] };
}

type Decision = { readonly kind: 'shipped'; readonly layer: KeyedLayer | null } | { readonly kind: 'conflict'; readonly reason: string };

export function onShipped(
  type: string,
  sections: readonly Section[] | undefined,
  local: string | null,
  shipped: string,
): KeyedLayer | null {
  if (local === null) return null;
  if (local === shipped) return { type, edits: [] };
  return appended(type, local, shipped, sections);
}

function fromBase(type: string, sections: readonly Section[] | undefined, local: string | null, base: string | null): Decision {
  if (base === null) return { kind: 'conflict', reason: 'its installed base is unknown' };
  if (local === base) return { kind: 'shipped', layer: null };
  const derived = local !== null ? appended(type, local, base, sections) : null;
  return derived !== null
    ? { kind: 'shipped', layer: derived }
    : { kind: 'conflict', reason: 'its text differs from the installed base outside a section it may append to' };
}

const accepted = (layer: KeyedLayer | null): KeyedLayer | null => (layer !== null && layer.edits.length === 0 ? null : layer);

export function carrying(shipped: Tag, kept: Declaration): Declaration {
  const roles = kept.roles ?? TAG_DEFAULTS.roles;
  const structure = Object.entries(shipped.roles).every(
    ([role, value]) => canonicalJson(roles[role as keyof typeof roles]) === canonicalJson(value),
  );
  if (!structure) return kept;
  const carried = Object.entries(shipped.contracts ?? {}).filter(
    ([contract, binding]) =>
      kept.contracts?.[contract as keyof NonNullable<Declaration['contracts']>] === undefined &&
      Object.keys(binding.slots).length === 0 &&
      Object.keys(binding.words).length === 0,
  );
  return carried.length === 0 ? kept : { ...kept, contracts: { ...kept.contracts, ...Object.fromEntries(carried) } };
}

export function settle(
  type: string,
  shipped: Tag,
  copy: Copy | null,
  known: Tag | null,
  behaviours: BehaviourRegistry,
  structure: Structure = (declaration) => declaration,
): Result.Result<Settled, readonly Forbidden[]> {
  if (copy === null) return layeredShipped(shipped, null);
  const { layer, fork } = copy;
  const declaration = carrying(shipped, copy.declaration);
  const gained = Object.keys(declaration.contracts ?? {}).filter(
    (contract) => copy.declaration.contracts?.[contract as keyof NonNullable<Declaration['contracts']>] === undefined,
  );
  const conflict = (reason: string): Result.Result<Settled, readonly Forbidden[]> =>
    Result.succeed({
      kind: 'kept',
      declaration,
      kept: {
        kind: 'migration-conflict',
        reason:
          gained.length === 0
            ? reason
            : `${reason}; it keeps ${gained.join(', ')}, which its roles drew before the shipped type bound ${gained.length === 1 ? 'it' : 'them'} explicitly`,
      },
    });
  if (fork !== null) return Result.succeed({ kind: 'kept', declaration, kept: { kind: 'fork', at: fork.at, now: typeRevision(shipped) } });
  const comparable = structure(declaration);
  const differs = (other: Declaration) => differing(comparable, structure(other));
  if (layer !== null) {
    if (layer.type !== type) return conflict(`its layer was accepted over ${layer.type}, not ${type}`);
    const parts = differs(shipped);
    if (parts.length > 0 && (known === null || differs(known).length > 0))
      return conflict(`its ${parts.join(', ')} differ from the shipped type`);
    return layeredShipped(shipped, layer);
  }
  const local = textOf(declaration, behaviours);
  const shippedText = textOf(shipped, behaviours);
  if (differs(shipped).length === 0 && shippedText !== null) {
    const taken = onShipped(type, shipped.sections, local, shippedText);
    if (taken !== null) return layeredShipped(shipped, accepted(taken));
  }
  const parts = known === null ? [] : differs(known);
  if (parts.length > 0) return conflict(`its ${parts.join(', ')} differ from the installed base`);
  const decision = fromBase(type, shipped.sections, local, known === null ? null : textOf(known, behaviours));
  return decision.kind === 'conflict' ? conflict(decision.reason) : layeredShipped(shipped, decision.layer);
}

export type TextCopy = {
  readonly text: string;
  readonly layer: KeyedLayer | null;
  readonly fork: { readonly at: string } | null;
};

export type SettledText =
  | { readonly kind: 'shipped'; readonly text: string; readonly layer: KeyedLayer | null; readonly stale: readonly Stale[] }
  | { readonly kind: 'kept'; readonly kept: Kept };

export function settleText(
  type: string,
  shipped: readonly Section[],
  copy: TextCopy | null,
  base: readonly Section[] | null,
): Result.Result<SettledText, readonly Forbidden[]> {
  const layered = (layer: KeyedLayer | null): Result.Result<SettledText, readonly Forbidden[]> => {
    if (layer === null) return Result.succeed({ kind: 'shipped', text: composedText(shipped), layer: null, stale: [] });
    const applied = applyLayer(shipped, layer);
    if (Result.isFailure(applied)) return Result.fail(applied.failure);
    return Result.succeed({ kind: 'shipped', text: composedText(applied.success.sections), layer, stale: applied.success.stale });
  };
  const conflict = (reason: string): Result.Result<SettledText, readonly Forbidden[]> =>
    Result.succeed({ kind: 'kept', kept: { kind: 'migration-conflict', reason } });
  if (copy === null) return layered(null);
  if (copy.fork !== null) return Result.succeed({ kind: 'kept', kept: { kind: 'fork', at: copy.fork.at, now: sectionsRevision(shipped) } });
  if (copy.layer !== null) {
    return copy.layer.type === type ? layered(copy.layer) : conflict(`its layer was accepted over ${copy.layer.type}, not ${type}`);
  }
  const taken = onShipped(type, shipped, copy.text, composedText(shipped));
  if (taken !== null) return layered(accepted(taken));
  const decision = fromBase(type, shipped, copy.text, base === null ? null : composedText(base));
  return decision.kind === 'conflict' ? conflict(decision.reason) : layered(decision.layer);
}
