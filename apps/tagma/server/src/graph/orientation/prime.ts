import { Effect, Layer } from 'effect';
import { blockName } from '../contract/wire/references.js';
import { mapBudget } from '../settings.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { Doctrine } from '../../platform/contract/service/sections.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { Settings } from '../../settings/contract/service/values.js';
import { GLOBAL_PROJECT, type ProjectGroup, type ProjectRow, reaching } from '../../projects/contract/wire/project.js';
import { mapHeading, mapLines, mapNodes, mapRegions, regionAbove, regionsHeading, type MapCut, type MapNode, type MapRow } from './map.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { block, edge, source } from '../store/tables.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { InstalledCatalogs, Tags } from '../contract/service/vocabulary.js';
import { Act } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { ProjectPolicy, measuredRoot } from '../contract/service/serving.js';
import { ProjectGroups, Projects } from '../../projects/contract/service/registry.js';
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

const TOP = 0;

const skeletonRows = Effect.fn('Orientation.skeletonRows')(function* (
  projectId: number,
): Effect.fn.Return<readonly SkeletonRow[], StoreFailure, GraphStore> {
  const { db } = yield* GraphStore;
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
): Effect.fn.Return<readonly MapNode[], StoreFailure, GraphStore> {
  const { db } = yield* GraphStore;
  const regions = mapRegions(table, rows, rootId);
  const drawn = rows.filter((row) => regions.has(row.id));
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
  return mapNodes(rows, regions, rootId, places, kinds);
});

const regionsOf = Effect.fnUntraced(function* (projectId: number) {
  const root = yield* (yield* BlockRows).rootBlockOf(projectId);
  const rows = yield* skeletonRows(projectId);
  const table = yield* (yield* Tags).of(projectId);
  return { root, rows, table, nodes: yield* readMap(rows, table, root.id) };
});

const spent = (map: MapCut): number => map.lines.reduce((sum, line) => sum + line.length + 1, 0);

const orientationReads = Effect.fnUntraced(function* (law: LawReads) {
  const blockRows = yield* BlockRows;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const groups = yield* ProjectGroups;
  const selection = yield* Selection;
  const sessions = yield* WriterRegister;
  const identity = yield* SessionIdentity;
  const standings = yield* HolderStandings;
  const { graphOf, ownGraph, policyOf, doctrineText } = law;

  const heading = Effect.fnUntraced(function* (row: ProjectRow) {
    return `## ${row.name} (id ${row.id}, ${yield* measuredRoot(row)})`;
  });

  const section = (title: string, body: string) => (body ? `${title}\n${body.trim()}` : title);

  const groupRoot = Effect.fn('Orientation.groupRoot')(function* (group: ProjectGroup, named: readonly ProjectRow[]) {
    const root = yield* Effect.provide(
      Effect.flatMap(BlockRows, (reader) => reader.rootBlockOf(group.graph.id)),
      yield* graphOf(group.graph.id),
    );
    const members = named.map((member) => member.name).join(', ');
    return section(
      `## ${group.graph.name} (id ${group.graph.id}) — group root ${blockName(root.uuid)} of ${members}: what spans them is kept here, linked to the member blocks that own the code`,
      root.body,
    );
  });

  const memberSection = Effect.fn('Orientation.member')(function* (member: ProjectRow, budget: number) {
    const { root, nodes } = yield* Effect.provide(regionsOf(member.id), yield* graphOf(member.id));
    const map = mapLines(nodes, budget, undefined, TOP);
    const parts = [section(yield* heading(member), root.body)];
    if (map.lines.length > 0) parts.push([regionsHeading(map.left), ...map.lines].join('\n'));
    return { text: parts.join('\n\n'), spent: spent(map) };
  });

  const render = Effect.fn('Orientation.render')(function* (input: {
    projectId: number;
    scopeId?: number;
    law?: InstructionSet;
  }): Effect.fn.Return<string, StoreFailure | GateRefusal> {
    const proj = yield* projects.byId(input.projectId);
    const live = input.scopeId === undefined ? undefined : yield* blockRows.liveBlock(input.scopeId);
    const scope = live?.projectId === proj.id ? live : undefined;
    const { root, rows, nodes } = yield* Effect.provide(regionsOf(proj.id), ownGraph);
    const sections: string[] = ['# Tagma prime'];

    const crossGraph = yield* projects.global();
    if (crossGraph !== undefined) {
      const globalRoot = yield* Effect.provide(
        Effect.flatMap(BlockRows, (reader) => reader.rootBlockOf(crossGraph.id)),
        yield* graphOf(crossGraph.id),
      );
      sections.push(`${GLOBAL_PROJECT.name}: ${blockName(globalRoot.uuid)} — cross-project law and notes`);
    }

    const found = yield* groups.of(proj.id);
    const group = found !== undefined && found.graph.id !== proj.id ? found : undefined;
    const budget = yield* settings.value(mapBudget, proj.id);
    const others = group === undefined ? [] : reaching(group, proj.id, 'map');
    const share = Math.floor(budget / (others.length + 1));
    const drawn: string[] = [];
    let left = budget;
    for (const member of others) {
      const { text, spent } = yield* memberSection(member, share);
      drawn.push(text);
      left -= spent;
    }
    if (group !== undefined) {
      sections.push(
        yield* groupRoot(
          group,
          group.members.filter((member) => member.id === proj.id || others.includes(member)),
        ),
      );
    }

    const shown = scope ?? root;
    const here = group === undefined ? '' : ' — you stand here';
    const title = `${yield* heading(proj)}${here}${scope === undefined ? '' : ` — scope ${blockName(scope.uuid)} ${scope.title}`}`;
    sections.push(section(title, shown.body));

    const map = mapLines(nodes, left, scope === undefined ? undefined : regionAbove(rows, nodes, root.id, scope.id));
    if (map.lines.length > 0) {
      sections.push([mapHeading(map.left, scope === undefined ? undefined : blockName(scope.uuid)), ...map.lines].join('\n'));
    } else if (map.left > 0) {
      sections.push(`Map: none of this project's ${map.left} regions fit its map budget.`);
    }
    sections.push(...drawn);

    const inside = scope === undefined ? undefined : yield* selection.subtree(scope.id);
    const table = yield* Effect.provide(
      Effect.flatMap(Tags, (tags) => tags.of(proj.id)),
      ownGraph,
    );
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
    let abandonedCount = 0;
    for (const task of working) {
      const id = table.holderOf(task);
      const holder = id === null ? undefined : holders.get(id);
      if (abandoned(holder?.state)) abandonedCount += 1;
      else
        held.push(`- ${blockName(task.uuid)} ${task.title} — ${holder === undefined ? 'operator' : sessionName(holder.session, identity)}`);
    }
    if (abandonedCount > 0) held.push(`${abandonedCount} more in work by sessions that stopped working — ready_work names them`);
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
  | ProjectGroups
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
