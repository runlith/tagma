import { Effect, Layer } from 'effect';
import { blockName } from '../contract/wire/references.js';
import { mapBudget } from '../settings.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { Doctrine } from '../../platform/contract/service/sections.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { Settings } from '../../settings/contract/service/values.js';
import { GLOBAL_PROJECT } from '../../projects/contract/wire/project.js';
import { drawsRegion, mapHeading, mapLines, mapNodes, regionAbove, type MapNode, type MapRow } from './map.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { block, edge, source } from '../store/tables.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { InstalledCatalogs, Tags } from '../contract/service/vocabulary.js';
import { Act } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { ProjectPolicy, measuredRoot } from '../contract/service/serving.js';
import { Projects } from '../../projects/contract/service/registry.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Selection } from '../contract/service/reads.js';
import { Orientation } from '../contract/service/orientation.js';
import { type LawReads, lawReads } from './law.js';
import { instructionText, instructionsReads } from './Instructions.js';
import { WORK } from '../contract/wire/tags/work.js';
import type { InstructionSet } from '../contract/wire/instructions.js';
import { HolderStandings } from '../contract/service/holders.js';
import { abandoned } from '../contract/wire/holders.js';
import { holdersOf } from '../work/tasks/holders.js';

type SkeletonRow = MapRow & { readonly fields: Readonly<Record<string, unknown>> };

const orientationReads = Effect.fnUntraced(function* (law: LawReads) {
  const { db } = yield* GraphStore;
  const blockRows = yield* BlockRows;
  const vocabulary = yield* Tags;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const selection = yield* Selection;
  const sessions = yield* WriterRegister;
  const identity = yield* SessionIdentity;
  const standings = yield* HolderStandings;
  const { graphOf, policyOf, doctrineText } = law;

  const skeletonRows = Effect.fn('Orientation.skeletonRows')(function* (
    projectId: number,
  ): Effect.fn.Return<readonly SkeletonRow[], StoreFailure> {
    return yield* db
      .select({
        id: block.id,
        uuid: block.uuid,
        parentId: block.parentId,
        ord: block.ord,
        tags: block.tags,
        fields: block.fields,
        title: block.title,
        superseded: sql<number>`(select count(*) from ${edge} e where e.kind = 'supersedes' and e.to_id = ${block.id})`,
      })
      .from(block)
      .where(and(eq(block.projectId, projectId), isNull(block.deletedAt)));
  });

  const readMap = Effect.fn('Orientation.readMap')(function* (
    rows: readonly SkeletonRow[],
    table: TagTable,
    rootId: number,
  ): Effect.fn.Return<readonly MapNode[], StoreFailure> {
    const drawn = rows.filter((row) => drawsRegion(table, row));
    const held = drawn.map((row) => row.id);
    if (held.length === 0) return [];
    const places = new Map<number, string[]>();
    for (const row of yield* db
      .select({ blockId: source.blockId, ref: source.ref })
      .from(source)
      .where(and(inArray(source.blockId, held), inArray(source.kind, ['dir', 'file'])))) {
      places.set(row.blockId, [...(places.get(row.blockId) ?? []), row.ref]);
    }
    const kinds = new Map<number, string>();
    for (const row of drawn) {
      const kind = row.fields['kind'];
      if (typeof kind === 'string') kinds.set(row.id, kind);
    }
    return mapNodes(table, rows, rootId, places, kinds);
  });

  const render = Effect.fn('Orientation.render')(function* (input: {
    projectId: number;
    scopeId?: number;
    law?: InstructionSet;
  }): Effect.fn.Return<string, StoreFailure | GateRefusal> {
    const proj = yield* projects.byId(input.projectId);
    const root = yield* blockRows.rootBlockOf(proj.id);
    const live = input.scopeId === undefined ? undefined : yield* blockRows.liveBlock(input.scopeId);
    const scope = live?.projectId === proj.id ? live : undefined;
    const rows = yield* skeletonRows(proj.id);
    const table = yield* vocabulary.of(proj.id);
    const sections: string[] = ['# Tagma prime'];

    const crossGraph = yield* projects.global();
    if (crossGraph !== undefined) {
      const globalRoot = yield* Effect.provide(
        Effect.flatMap(BlockRows, (reader) => reader.rootBlockOf(crossGraph.id)),
        yield* graphOf(crossGraph.id),
      );
      sections.push(`${GLOBAL_PROJECT.name}: ${blockName(globalRoot.uuid)} — cross-project law and notes`);
    }

    const shown = scope ?? root;
    const heading = `## ${proj.name} (id ${proj.id}, ${yield* measuredRoot(proj)})${scope === undefined ? '' : ` — scope ${blockName(scope.uuid)} ${scope.title}`}`;
    sections.push(shown.body ? `${heading}\n${shown.body.trim()}` : heading);

    const nodes = yield* readMap(rows, table, root.id);
    const map = mapLines(
      nodes,
      yield* settings.value(mapBudget, proj.id),
      scope === undefined ? undefined : regionAbove(rows, nodes, root.id, scope.id),
    );
    if (map.lines.length > 0) {
      sections.push([mapHeading(map.left, scope === undefined ? undefined : blockName(scope.uuid)), ...map.lines].join('\n'));
    } else if (map.left > 0) {
      sections.push(`Map: none of this project's ${map.left} regions fit its map budget.`);
    }

    const inside = scope === undefined ? undefined : yield* selection.subtree(scope.id);
    const working = rows.filter((row) => table.standsAt(row, WORK, 'active') && (inside === undefined || inside.has(row.id)));
    const holders = yield* holdersOf(
      sessions,
      standings,
      working.flatMap((task) => {
        const held = table.holderOf(task);
        return held === null ? [] : [held];
      }),
    );
    const held: string[] = [];
    let left = 0;
    for (const task of working) {
      const id = table.holderOf(task);
      const holder = id === null ? undefined : holders.get(id);
      if (abandoned(holder?.state)) left += 1;
      else
        held.push(`- ${blockName(task.uuid)} ${task.title} — ${holder === undefined ? 'operator' : sessionName(holder.session, identity)}`);
    }
    if (left > 0) held.push(`${left} more in work by sessions that stopped working — ready_work names them`);
    if (held.length > 0) sections.push(['In work:', ...held].join('\n'));

    if (input.law !== undefined) {
      if ((yield* policyOf(proj.id)).private) sections.push(yield* doctrineText(proj.id));
      sections.push(instructionText(input.law));
    }

    return sections.join('\n\n');
  });

  return { render };
});

export const orientationLayer: Layer.Layer<
  Orientation,
  never,
  | GraphStore
  | GraphUnits
  | Act
  | BlockRows
  | Projects
  | ProjectPolicy
  | Selection
  | WriterRegister
  | Settings
  | Tags
  | SessionIdentity
  | InstalledCatalogs
  | HolderStandings
> = Layer.effect(
  Orientation,
  Effect.gen(function* () {
    const doctrine = yield* Doctrine;
    const law = yield* lawReads(doctrine);
    const instructions = yield* instructionsReads(law);
    const orientation = yield* orientationReads(law);
    return Orientation.of({
      instructions,
      render: orientation.render,
      law: law.lawText,
      rules: (projectId) => Effect.map(law.forest(projectId), (entries) => entries.map((entry) => entry.rule)),
      rulesOff: law.off,
      ruleReach: law.ruleReachOf,
    });
  }),
);
