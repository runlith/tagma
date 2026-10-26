import { statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { block, edge, source } from '../store/tables.js';
import { linking, placing, projecting, referencing } from '../store/actWrites.js';
import { Act, BlockProjection, BlockReferences, type BlockRow } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { blockName } from '../contract/wire/references.js';
import { mintBlockId } from '../contract/wire/identity.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';

const stepping = writes('Tree.step.moduleCards', [block, source, edge], projecting, referencing, placing, linking);

type Check = { readonly builtin: string; readonly params: Record<string, unknown> };
type Door = { readonly at: string; readonly for?: readonly string[]; readonly role?: string };
type Module = { readonly id: string; readonly territory: readonly string[]; readonly entries?: readonly Door[] | null };
type Relation = { readonly from: string; readonly to: string; readonly role?: string };

const checkOf = (row: BlockRow): Check | undefined =>
  (row.fields.enforcement as { readonly checks?: readonly Check[] } | undefined)?.checks?.[0];

const TERRITORY = 'lode/territory';

type Release = { readonly tags: readonly Record<string, unknown>[] };

const carriesTerritory = (contracts: unknown): boolean => typeof contracts === 'object' && contracts !== null && TERRITORY in contracts;

const withoutTerritory = <T extends Record<string, unknown>>(declaration: T): T => {
  if (!carriesTerritory(declaration.contracts)) return declaration;
  const { [TERRITORY]: _territory, ...contracts } = declaration.contracts as Record<string, unknown>;
  const { contracts: _contracts, ...rest } = declaration;
  return (Object.keys(contracts).length === 0 ? rest : { ...rest, contracts }) as T;
};

const dirOf = (ref: string): string => `${ref.replace(/\/+$/, '')}/`;

export const moduleCards = Effect.fnUntraced(function* (project: ProjectRow) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const projection = yield* BlockProjection;
  const references = yield* BlockReferences;
  const rows = yield* BlockRows;
  const all = yield* db
    .select()
    .from(block)
    .where(and(eq(block.projectId, project.id), isNull(block.deletedAt)));
  const areaTag = all.find((row) => row.tags.includes('tag') && row.fields.id === 'area');
  const modulesRule = all.find((row) => checkOf(row)?.builtin === 'modules' && Array.isArray(checkOf(row)?.params.modules));
  const territorial = all.filter(
    (row) =>
      carriesTerritory(row.fields.contracts) ||
      (Array.isArray((row.fields.release as Release | undefined)?.tags) &&
        (row.fields.release as Release).tags.some((tag) => carriesTerritory(tag.contracts))),
  );
  if (areaTag === undefined && modulesRule === undefined && territorial.length === 0) return;
  const kindAt = (path: string): 'dir' | 'file' | null => {
    const found = statSync(join(project.rootPath, path), { throwIfNoEntry: false });
    return found === undefined ? null : found.isDirectory() ? 'dir' : 'file';
  };
  yield* act.unit(
    stepping,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const placed = yield* db
        .select({ id: source.id, blockId: source.blockId, kind: source.kind, ref: source.ref })
        .from(source)
        .innerJoin(block, eq(block.id, source.blockId))
        .where(and(eq(block.projectId, project.id), isNull(block.deletedAt)));
      const sourcesOf = (id: number) => placed.filter((one) => one.blockId === id && (one.kind === 'dir' || one.kind === 'file'));
      const byId = new Map(all.map((row) => [row.id, row] as const));
      const setFields = Effect.fnUntraced(function* (row: BlockRow, fields: Record<string, unknown>, tags: readonly string[] = row.tags) {
        yield* db
          .update(block)
          .set({ fields, tags: [...tags], updatedAt: now })
          .where(eq(block.id, row.id));
        yield* projection.syncTags(row.id);
        yield* act.record('update', row.id, { wasFields: row.fields, wasTags: tags === row.tags ? undefined : row.tags }, now);
      });
      const anchor = Effect.fnUntraced(function* (blockId: number, kind: 'dir' | 'file', ref: string) {
        yield* db.insert(source).values({ blockId, kind, ref, symbol: null, createdAt: now }).onConflictDoNothing();
        yield* act.record('anchor', blockId, { path: ref, kind }, now);
      });
      const exModules = new Set<number>();
      const keptModules = new Set(all.filter((row) => row.tags.includes('module')).map((row) => row.id));

      if (modulesRule !== undefined) {
        const check = checkOf(modulesRule)!;
        const modules = check.params.modules as readonly Module[];
        const relations = check.params.relations as readonly Relation[];
        const cards = all.filter((row) => row.tags.includes('module'));
        const cardAt = new Map(
          cards.flatMap((card) =>
            sourcesOf(card.id)
              .filter((one) => one.kind === 'dir')
              .map((one) => [dirOf(one.ref), card] as const),
          ),
        );
        const projectRoot = yield* rows.rootBlockOf(project.id);
        const planned = modules.map((module) => {
          const dirs = module.territory.filter((at) => at.endsWith('/') && kindAt(at) === 'dir').sort((a, b) => a.length - b.length);
          const root = dirs[0];
          if (root === undefined) throw new Error(`module ${module.id} has no live directory`);
          const stray = dirs.filter((at) => !at.startsWith(root));
          if (stray.length > 0)
            throw new Error(`module ${module.id} owns ${stray.join(', ')} outside its root ${root}, which a card cannot carry`);
          const cuts = module.territory.filter((at) => !at.endsWith('/') && !at.startsWith(root) && kindAt(at) === 'file');
          return { module, root, cuts };
        });
        const plans = new Map(planned.map((plan) => [plan.root, plan] as const));
        const floorGroups = new Map<string, Check[]>();
        for (const row of all) {
          const check = checkOf(row);
          if (check?.builtin !== 'boundaries' && check?.builtin !== 'direction') continue;
          let at = dirOf(String(check.params.base));
          let owner = plans.get(at);
          while (owner === undefined) {
            const slash = at.lastIndexOf('/', at.length - 2);
            if (slash === -1) break;
            at = at.slice(0, slash + 1);
            owner = plans.get(at);
          }
          if (owner === undefined)
            return yield* new GateRefusal(
              'vocabulary-older',
              `the module-cards graph step cannot assign the floor rule ${blockName(row.uuid)} at ${String(check.params.base)} to one module`,
              [
                'open this graph with a Tagma release that understands its direction/boundaries rules and put the floor constraints inside their owning modules before reopening it here',
              ],
            );
          const checks = floorGroups.get(owner.module.id) ?? [];
          checks.push(check);
          floorGroups.set(owner.module.id, checks);
        }
        const orders = new Map<string, readonly (readonly string[])[]>();
        for (const { module, root } of planned) {
          const checks = floorGroups.get(module.id) ?? [];
          if (checks.length > 1)
            return yield* new GateRefusal(
              'vocabulary-older',
              `the module-cards graph step cannot migrate module ${module.id}: its ${checks.length} independent direction/boundaries rules cannot be represented by one module order without changing their constraints`,
              [
                `open this graph with a Tagma release that understands its direction/boundaries rules, manually combine the floor constraints of module ${module.id} into one rule, then reopen it here`,
              ],
            );
          const check = checks[0];
          if (check === undefined) continue;
          const base = dirOf(String(check.params.base));
          const prefix = base.slice(root.length);
          const floors = (check.params.floors as readonly (readonly string[])[]).map((floor) =>
            floor.map((at) => {
              const path = posix.join(prefix, at).replace(/\/+$/, '');
              return path === '.' || kindAt(posix.join(base, at)) !== 'dir' ? path : `${path}/`;
            }),
          );
          orders.set(module.id, check.builtin === 'boundaries' ? [...floors, [prefix || '.']] : floors);
        }
        const blockOf = new Map<string, number>();
        const nameOf = new Map<string, string>();
        const rowOf = new Map<string, BlockRow>();
        for (const { module, root } of planned) {
          const held = cardAt.get(root);
          if (held !== undefined) {
            blockOf.set(module.id, held.id);
            nameOf.set(module.id, blockName(held.uuid));
            rowOf.set(module.id, held);
            continue;
          }
          const parentId = projectRoot.id;
          const born = yield* db
            .insert(block)
            .values({
              uuid: mintBlockId(),
              projectId: project.id,
              parentId,
              ord: yield* rows.nextOrd(parentId),
              tags: ['module'],
              fields: {},
              title: module.id,
              body: '',
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          if (born === undefined) return yield* Effect.die('a module card insert returned no row');
          yield* references.syncRefs(born.id, born.body, { projectId: project.id });
          yield* projection.syncBorn(born, true);
          yield* act.record('create', born, { kind: 'module', chars: born.body.length, module: module.id }, now);
          yield* anchor(born.id, 'dir', root.replace(/\/$/, ''));
          keptModules.add(born.id);
          blockOf.set(module.id, born.id);
          nameOf.set(module.id, blockName(born.uuid));
          rowOf.set(module.id, born);
        }
        for (const { module, root, cuts } of planned) {
          const row = rowOf.get(module.id)!;
          const entries = (module.entries ?? []).flatMap((door) => {
            if (!door.at.startsWith(root) || kindAt(door.at) === null) return [];
            const only = (door.for ?? []).map((id) => nameOf.get(id) ?? '').filter((one) => one !== '');
            return [
              {
                at: door.at === root ? '.' : door.at.slice(root.length),
                for: only.length === 0 ? undefined : only,
                role: door.role,
              },
            ];
          });
          const order = orders.get(module.id);
          const fresh = yield* rows.blockById(row.id);
          yield* setFields(fresh, { ...fresh.fields, id: module.id, entries, order: order ?? fresh.fields.order });
          for (const cut of cuts) yield* anchor(row.id, 'file', cut);
        }
        for (const relation of relations) {
          const from = blockOf.get(relation.from);
          const to = blockOf.get(relation.to);
          if (from === undefined || to === undefined)
            return yield* Effect.die(`relation ${relation.from} -> ${relation.to} names an unknown module`);
          const kind = relation.role === 'testing' ? 'imports-tests' : 'imports';
          yield* db.insert(edge).values({ fromId: from, toId: to, kind, createdAt: now }).onConflictDoNothing();
          yield* act.record('link', from, { kind, toId: to }, now);
        }
        const ancestors = new Set<number>();
        for (const row of rowOf.values()) {
          for (let at = row.parentId; at !== null && !ancestors.has(at); at = byId.get(at)?.parentId ?? null) ancestors.add(at);
        }
        const containers = cards.filter((card) => ancestors.has(card.id));
        const mapped = new Set([...blockOf.values(), ...containers.map((card) => card.id)]);
        for (const card of cards) {
          if (mapped.has(card.id)) continue;
          exModules.add(card.id);
          keptModules.delete(card.id);
          yield* setFields(card, card.fields, []);
        }
        const { modules: _modules, relations: _relations, region: _region, ...policy } = check.params;
        const enforcement = modulesRule.fields.enforcement as { readonly checks: readonly Check[] };
        yield* setFields(modulesRule, {
          ...modulesRule.fields,
          enforcement: { ...enforcement, checks: [{ ...check, params: policy }, ...enforcement.checks.slice(1)] },
        });
        const roots = new Map(planned.map(({ module, root }) => [root, module.id] as const));
        for (const row of all) {
          const loads = checkOf(row);
          if (loads?.builtin !== 'loads' || !Array.isArray(loads.params.from)) continue;
          const base = dirOf(String(loads.params.base));
          const from = (loads.params.from as readonly unknown[]).map((at) => {
            const id = typeof at === 'string' ? roots.get(`${base}${at}`) : undefined;
            return id === undefined ? at : { module: id };
          });
          const enforcement = row.fields.enforcement as { readonly checks: readonly Check[] };
          yield* setFields(row, {
            ...row.fields,
            enforcement: { ...enforcement, checks: [{ ...loads, params: { ...loads.params, from } }, ...enforcement.checks.slice(1)] },
          });
        }
        for (const row of all) {
          const floors = checkOf(row);
          if (floors?.builtin !== 'boundaries' && floors?.builtin !== 'direction') continue;
          const { enforcement: _enforcement, ...rest } = row.fields;
          yield* db.update(block).set({ fields: rest, deletedAt: now }).where(eq(block.id, row.id));
          yield* projection.forgetVocabulary([row.id]);
          yield* act.record('delete', row.id, { ids: [row.id], wasEnforcement: row.fields.enforcement }, now);
        }
      }

      if (areaTag !== undefined) {
        const areas = new Set(all.filter((row) => row.tags.includes('area')).map((row) => row.id));
        for (const rule of all.filter((row) => row.tags.includes('rule'))) {
          if (sourcesOf(rule.id).length > 0) continue;
          for (let at = rule.parentId; at !== null; at = byId.get(at)?.parentId ?? null) {
            if (keptModules.has(at)) break;
            if (!areas.has(at) && !exModules.has(at)) continue;
            const drawn = sourcesOf(at);
            if (drawn.length === 0) continue;
            for (const one of drawn) yield* anchor(rule.id, one.kind as 'dir' | 'file', one.ref);
            yield* projection.syncSearch(rule.id);
            break;
          }
        }
        for (const id of areas) {
          const row = byId.get(id)!;
          yield* db.delete(source).where(eq(source.blockId, id));
          yield* setFields(row, row.fields, []);
          yield* projection.syncSearch(id);
        }
        const tagName = blockName(areaTag.uuid);
        yield* db.update(block).set({ deletedAt: now }).where(eq(block.id, areaTag.id));
        yield* projection.forgetVocabulary([areaTag.id]);
        yield* act.record('delete', areaTag.id, { ids: [areaTag.id] }, now);
        for (const catalog of all.filter((row) => row.tags.includes('catalog') && Array.isArray(row.fields.tags))) {
          const members = catalog.fields.tags as readonly string[];
          if (members.includes(tagName)) yield* setFields(catalog, { ...catalog.fields, tags: members.filter((one) => one !== tagName) });
        }
      }
      for (const stale of territorial) {
        if (stale.id === areaTag?.id) continue;
        const row = yield* rows.blockById(stale.id);
        const release = row.fields.release as Release | undefined;
        yield* setFields(row, {
          ...withoutTerritory(row.fields),
          release: release === undefined ? undefined : { ...release, tags: release.tags.map(withoutTerritory) },
        });
      }
    }),
  );
});
