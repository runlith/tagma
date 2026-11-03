import { Effect, Result, Schema } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Catalogs } from '../contract/wire/catalogs.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { CATALOG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { composedText, type KeyedLayer, keyedLayerSchema, type Section, shippedSections } from '../contract/wire/tags/sections.js';
import { closedParsing } from '../contract/wire/fields.js';
import { declarationOf } from './declarationRules.js';
import { applyLayer, baseSectionsOf, differing, type Forbidden, onShipped, writtenLayer } from './layers.js';
import { installedOf, vocabularyRows } from './installed.js';
import { librariesFor } from './candidate.js';

type LayerRefusal = GateRefusal<'field-invalid' | 'layer-forbidden'>;

const readLayer = (key: string, value: unknown): Effect.Effect<KeyedLayer, LayerRefusal> => {
  const read = Schema.decodeUnknownResult(keyedLayerSchema)(value, closedParsing);
  return read._tag === 'Failure'
    ? Effect.fail(
        new GateRefusal('field-invalid', `${key}.layer: ${read.failure.message}`, [
          'a layer names the type and the section edits it was accepted over',
        ]),
      )
    : Effect.succeed(read.success);
};

export const checkedLayer = Effect.fnUntraced(function* (
  db: StoreDb<'graph'>,
  projectId: number,
  table: TagTable,
  fields: Record<string, unknown>,
): Effect.fn.Return<{ readonly fields: Record<string, unknown>; readonly prompt: string | null }, StoreFailure | LayerRefusal> {
  if (fields.layer === undefined) return { fields, prompt: null };
  const key = typeof fields.id === 'string' ? fields.id : '';
  const layer = yield* readLayer(`#${key}`, fields.layer);
  const releases = installedOf(yield* vocabularyRows(db, projectId)).catalogs.flatMap((catalog) =>
    catalog.release === null ? [] : [{ library: catalog.id, release: catalog.release }],
  );
  const typeId = table.identities.typeOf(key)?.id ?? null;
  const written = writtenLayer(key, typeId, layer, typeId === null ? null : baseSectionsOf(releases, typeId));
  if (Result.isFailure(written)) return yield* written.failure;
  return { fields: { ...fields, sections: written.success.sections }, prompt: written.success.prompt };
});

export type TextWrite = {
  readonly fields: Record<string, unknown>;
  readonly cleared: readonly string[];
  readonly body: string | null;
};

type Node = { readonly tags: readonly string[]; readonly fields: Readonly<Record<string, unknown>>; readonly body: string };

const OWN_TEXT = ['layer', 'sections'] as const;

const present = (fields: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] =>
  keys.filter((name) => fields[name] !== undefined);

type Rewritten = { readonly layer: KeyedLayer; readonly sections: readonly Section[] } | null;

const closed = (key: string, forbidden: readonly Forbidden[]): LayerRefusal =>
  new GateRefusal(
    'layer-forbidden',
    `${key}: its layer edits what the shipped text closes: ${forbidden.map((one) => one.reason).join('; ')}`,
    [`drop those edits from the layer of ${key}`],
  );

const rewritten = Effect.fnUntraced(function* (
  type: string,
  shipped: readonly Section[] | null,
  merged: Readonly<Record<string, unknown>>,
  body: string,
  forking: boolean,
): Effect.fn.Return<Rewritten, LayerRefusal> {
  const layer = shipped === null || forking ? null : onShipped(type, shipped, body, composedText(shipped));
  if (shipped === null || layer === null || (layer.edits.length > 0 && merged.fork !== undefined)) return null;
  const applied = applyLayer(shipped, layer);
  if (Result.isFailure(applied)) return yield* closed(type, applied.failure);
  return { layer, sections: applied.success.sections };
});

export const checkedText = Effect.fnUntraced(function* (
  db: StoreDb<'graph'>,
  projectId: number,
  table: TagTable,
  shipped: Catalogs['Service'],
  node: Node,
  written: Record<string, unknown> | undefined,
  body: string | undefined,
): Effect.fn.Return<TextWrite | null, StoreFailure | LayerRefusal> {
  const named = written !== undefined && OWN_TEXT.some((name) => written[name] !== undefined);
  const rewrite = body !== undefined && body !== node.body && !named ? body : null;
  const catalog = node.tags.includes(CATALOG_DECLARATION.id);
  const merged = { ...node.fields, ...written };
  if (rewrite === null && (written === undefined || (catalog ? written.layer : merged.layer) === undefined)) return null;
  if (rewrite === null && !catalog) {
    const layered = yield* checkedLayer(db, projectId, table, merged);
    return { fields: layered.fields, cleared: [], body: layered.prompt };
  }
  const id = typeof merged.id === 'string' ? merged.id : '';
  if (catalog) {
    const guidance = shipped.byId(id)?.guidance;
    const sections = guidance === undefined ? null : shippedSections(id, guidance);
    if (rewrite !== null) {
      const taken = yield* rewritten(id, sections, merged, rewrite, written?.fork !== undefined);
      return taken === null
        ? { fields: { ...written }, cleared: present(merged, ['layer']), body: null }
        : { fields: { ...written, layer: taken.layer }, cleared: present(merged, ['fork']), body: null };
    }
    const layer = yield* readLayer(id, merged.layer);
    if (layer.type !== id) {
      return yield* new GateRefusal('field-invalid', `${id}.layer names ${layer.type}, not this catalog's id`, [
        `write layer.type as ${id}: a guidance layer stands over the catalog it was accepted for`,
      ]);
    }
    if (sections === null) {
      return yield* new GateRefusal('field-invalid', `catalog ${id} is not shipped, so a layer cannot stand over its guidance`, [
        "a layer edits a shipped catalog's guidance; a local catalog's guidance is edited directly",
      ]);
    }
    const applied = applyLayer(sections, layer);
    if (Result.isFailure(applied)) return yield* closed(id, applied.failure);
    return { fields: { ...written }, cleared: [], body: composedText(applied.success.sections) };
  }
  const text = rewrite ?? '';
  const type = table.identities.typeOf(id);
  const from = type?.shipped ?? null;
  const libraries = from === null ? null : librariesFor(shipped, installedOf(yield* vocabularyRows(db, projectId)), []);
  const tag = from === null ? undefined : libraries?.get(from.library)?.tags.find((one) => one.id === from.export);
  let taken: Rewritten = null;
  if (tag !== undefined && type !== null) {
    const declaration = yield* Effect.fromResult(declarationOf({ fields: merged, body: text })).pipe(
      Effect.mapError(
        (failure) => new GateRefusal('field-invalid', failure.message, ['repair the unreadable fields before changing their shipped text']),
      ),
    );
    if (differing(declaration, tag).length === 0)
      taken = yield* rewritten(type.id, tag.sections ?? null, merged, text, written?.fork !== undefined);
  }
  if (taken === null) return { fields: { ...written }, cleared: from === null ? [] : present(merged, ['sections', 'layer']), body: null };
  return { fields: { ...written, ...taken }, cleared: present(merged, ['fork']), body: composedText(taken.sections) };
});
