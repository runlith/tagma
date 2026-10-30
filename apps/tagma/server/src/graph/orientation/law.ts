import { Context, Effect } from 'effect';
import { blockName } from '../contract/wire/references.js';
import { autoCommit, checkoutMode, commentPolicy, globalRules, rulesOff } from '../settings.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { Settings } from '../../settings/contract/service/values.js';
import { LAW_END, LAW_START } from '../contract/wire/law.js';
import { doctrineOf, type DoctrineText } from '../../platform/contract/service/sections.js';
import { GLOBAL_PROJECT } from '../../projects/contract/wire/project.js';
import { and, eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { InstalledCatalogs, Tags } from '../contract/service/vocabulary.js';
import { carriesTag } from '../vocabulary/projection.js';
import { isEnabled, type LawReach, type RuleReach } from '../contract/wire/tags/law.js';
import { Act } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import type { BlockRecord } from '../contract/service/acts.js';
import { ProjectPolicy } from '../contract/service/serving.js';
import { lawReach, ruleReach } from './reach.js';
import { OtherGraphs } from '../serving/policy.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { Selection } from '../contract/service/reads.js';
import { readsOf, readsThrough } from '../acts/reads.js';
import { deriveLaw } from './derived.js';

export type LawEntry = { rule: BlockRecord; depth: number; reach: RuleReach };

type RuleRowLite = { id: number; parentId: number | null; ord: number; tags: readonly string[]; fields: Readonly<Record<string, unknown>> };

function familyEntries(rows: readonly RuleRowLite[], standing: readonly BlockRecord[], reach: LawReach): LawEntry[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const standingIds = new Set(standing.map((rule) => rule.id));
  const familyParents = new Map<number, number | null>();
  const familyParent = (row: RuleRowLite): number | null => {
    const known = familyParents.get(row.id);
    if (known !== undefined) return known;
    const walked: number[] = [row.id];
    const onPath = new Set<number>([row.id]);
    let cursor = row.parentId;
    let answer: number | null = null;
    while (cursor !== null && byId.has(cursor) && !onPath.has(cursor)) {
      if (standingIds.has(cursor)) {
        answer = cursor;
        break;
      }
      const cached = familyParents.get(cursor);
      if (cached !== undefined) {
        answer = cached;
        break;
      }
      walked.push(cursor);
      onPath.add(cursor);
      cursor = (byId.get(cursor) as RuleRowLite).parentId;
    }
    for (const id of walked) familyParents.set(id, answer);
    return answer;
  };
  const children = new Map<number, BlockRecord[]>();
  const tops: BlockRecord[] = [];
  for (const rule of standing) {
    const parent = familyParent(byId.get(rule.id) as RuleRowLite);
    if (parent === null || !standingIds.has(parent)) tops.push(rule);
    else {
      const kin = children.get(parent);
      if (kin === undefined) children.set(parent, [rule]);
      else kin.push(rule);
    }
  }
  const reached = new Set<number>();
  const walkFrom: number[] = tops.map((rule) => rule.id);
  while (walkFrom.length > 0) {
    const id = walkFrom.pop() as number;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const kid of children.get(id) ?? []) walkFrom.push(kid.id);
  }
  const orphaned = standing.filter((rule) => !reached.has(rule.id));
  if (orphaned.length > 0) {
    const seen = new Set<number>();
    for (const rule of orphaned) {
      if (seen.has(rule.id)) continue;
      let cursor: number | null = rule.id;
      const ring: number[] = [];
      while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor);
        ring.push(cursor);
        cursor = (byId.get(cursor) as RuleRowLite | undefined)?.parentId ?? null;
      }
      const opener = Math.min(...ring.filter((id) => standingIds.has(id)));
      for (const member of ring) {
        const kin = children.get(member);
        if (kin !== undefined)
          children.set(
            member,
            kin.filter((kid) => !ring.includes(kid.id)),
          );
      }
      const below: BlockRecord[] = [];
      for (const member of orphaned) {
        if (!ring.includes(member.id)) continue;
        if (member.id === opener) tops.push(member);
        else below.push(member);
      }
      if (below.length > 0) children.set(opener, [...(children.get(opener) ?? []), ...below]);
    }
  }
  const outline = (a: BlockRecord, b: BlockRecord): number => {
    const rowA = byId.get(a.id) as RuleRowLite;
    const rowB = byId.get(b.id) as RuleRowLite;
    return rowA.ord === rowB.ord ? a.id - b.id : rowA.ord - rowB.ord;
  };
  for (const list of children.values()) list.sort(outline);
  tops.sort(outline);
  const entries: LawEntry[] = [];
  const pending: { rule: BlockRecord; depth: number }[] = [...tops].reverse().map((rule) => ({ rule, depth: 0 }));
  while (pending.length > 0) {
    const { rule, depth } = pending.pop() as { rule: BlockRecord; depth: number };
    entries.push({ rule, depth, reach: reach.get(rule.id) as RuleReach });
    const kids = children.get(rule.id) ?? [];
    for (let index = kids.length - 1; index >= 0; index -= 1) {
      pending.push({ rule: kids[index] as BlockRecord, depth: depth + 1 });
    }
  }
  return entries;
}

const lawFamilies = deriveLaw(
  Effect.fn('Orientation.lawFamilies')(function* (projectId: number) {
    const { db } = yield* GraphStore;
    const selection = yield* Selection;
    const table = yield* (yield* Tags).of(projectId);
    const ruleRows = yield* db
      .select({
        id: block.id,
        parentId: block.parentId,
        ord: block.ord,
        tags: block.tags,
        fields: block.fields,
        deleted: block.deletedAt,
      })
      .from(block)
      .where(and(eq(block.projectId, projectId), carriesTag(table.lawBearingTypes(), block.id)));
    const live = ruleRows.filter((row) => row.deleted === null);
    const enabled = new Set(live.filter((row) => isEnabled(table.lawProjection(row), row)).map((row) => row.id));
    const records = (yield* selection.records(live.map((row) => row.id))).filter((rule) => !rule.superseded);
    const standing = records.filter((rule) => enabled.has(rule.id));
    const reach = yield* lawReach(projectId);
    const prompt = standing.filter((rule) => reach.get(rule.id)?.delivery === 'prompt');
    return {
      rows: ruleRows,
      standing,
      off: records.filter((rule) => !enabled.has(rule.id)),
      reach,
      entries: familyEntries(ruleRows, standing, reach),
      prompt: familyEntries(ruleRows, prompt, reach),
    };
  }),
);

export const lawForest = readsThrough(GraphUnits)(
  Effect.fn('Orientation.lawForest')(function* (projectId: number) {
    return (yield* lawFamilies(projectId)).entries;
  }),
);

export const lawOff = readsThrough(GraphUnits)(
  Effect.fnUntraced(function* (projectId: number) {
    return (yield* lawFamilies(projectId)).off;
  }),
);

export const promptLaw = readsThrough(GraphUnits)(
  Effect.fnUntraced(function* (projectId: number) {
    return (yield* lawFamilies(projectId)).prompt;
  }),
);

export const ruleLine = (entry: LawEntry, mark: string, form: 'whole' | 'pointer' = 'whole'): string => {
  const rule = entry.rule;
  const pad = '  '.repeat(entry.depth);
  const head = `- ${blockName(rule.uuid)} ${rule.title}${mark}`;
  const whole = `${head}: ${rule.body.trim()}`;
  return (form === 'pointer' ? head : whole)
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
};

export const lawReads = Effect.fnUntraced(function* (doctrine: DoctrineText | null) {
  const vocabulary = yield* Tags;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const policy = yield* ProjectPolicy;
  const reads = readsOf(yield* GraphUnits);
  const filtered = new Map<number, { family: Effect.Success<ReturnType<typeof lawFamilies>>; disabled: string; rules: LawEntry[] }>();
  const policyOf = Effect.fn('Orientation.policyOf')(function* (projectId: number) {
    const registered = yield* projects.byId(projectId);
    const row = (yield* policy.read([registered.id])).get(registered.id);
    if (row === undefined)
      return yield* new GateRefusal('not-found', `project ${projectId} is not in this store's registry`, [
        'read the project registry again',
      ]);
    return row;
  });
  const ownGraph = yield* Effect.context<GraphStore | GraphUnits | Selection | Act | Tags | BlockRows | InstalledCatalogs>();
  const ruleReachOf = (projectId: number) => Effect.provide(ruleReach(projectId), ownGraph);
  const graphOf = Effect.fn('Orientation.graphOf')(function* (projectId: number) {
    const reach = yield* OtherGraphs;
    return reach === null ? Context.omit(GraphUnits)(ownGraph) : yield* reach(projectId);
  });
  const forest = (projectId: number) => Effect.provide(lawForest(projectId), ownGraph);
  const prompted = (projectId: number) => Effect.provide(promptLaw(projectId), ownGraph);
  const off = (projectId: number) => Effect.provide(lawOff(projectId), ownGraph);

  const globalLaw = reads(
    Effect.fn('Orientation.globalLaw')(function* (
      projectId: number,
    ): Effect.fn.Return<{ scope: string; mark: string; rules: LawEntry[]; own: boolean }, StoreFailure | GateRefusal<OpenRefusal>> {
      const graph = yield* projects.global();
      const scope = `prompt · ${GLOBAL_PROJECT.name}`;
      const mark = ` [${scope}]`;
      if (graph === undefined) return { scope, mark, rules: [], own: false };
      const own = graph.id === projectId;
      if (!own && !(yield* settings.value(globalRules, projectId))) return { scope, mark, rules: [], own };
      const off = own ? [] : (yield* settings.value(rulesOff, projectId)).map((name) => name.toLowerCase());
      const turnedOff = (uuid: string) => {
        const id = uuid.replaceAll('-', '').toLowerCase();
        return off.some((name) => id.endsWith(name));
      };
      const family = yield* Effect.provide(lawFamilies(graph.id), yield* graphOf(graph.id));
      if (off.length === 0) {
        filtered.delete(projectId);
        return { scope, mark, rules: family.prompt, own };
      }
      const disabled = JSON.stringify(off);
      const known = filtered.get(projectId);
      if (known?.family === family && known.disabled === disabled) return { scope, mark, rules: known.rules, own };
      const rules = familyEntries(
        family.rows,
        family.standing.filter((rule) => family.reach.get(rule.id)?.delivery === 'prompt' && !turnedOff(rule.uuid)),
        family.reach,
      );
      filtered.set(projectId, { family, disabled, rules });
      return { scope, mark, rules, own };
    }),
  );

  const promptOf = reads(
    Effect.fn('Orientation.promptOf')(function* (projectId: number) {
      return (yield* Effect.provide(lawFamilies(projectId), yield* graphOf(projectId))).prompt;
    }),
  );

  const doctrineText = Effect.fn('Orientation.doctrine')(function* (
    projectId?: number,
  ): Effect.fn.Return<string, StoreFailure | GateRefusal> {
    const proj = projectId === undefined ? undefined : yield* policyOf(projectId);
    const checkout = projectId === undefined ? checkoutMode.fallback : yield* settings.value(checkoutMode, projectId);
    const comments = projectId === undefined ? commentPolicy.fallback : yield* settings.value(commentPolicy, projectId);
    const commitsOwnWork = projectId === undefined ? autoCommit.fallback : yield* settings.value(autoCommit, projectId);
    const graphOverCode = projectId === undefined ? true : (yield* vocabulary.of(projectId)).bindsCode();
    return [
      ...doctrineOf(doctrine).law({ checkout, autoCommit: commitsOwnWork, comments, graphOverCode }),
      ...(proj?.strictProvenance
        ? [
            '- Every task here carries its origin: the spec it implements for planned work, the block it was discovered from for what you find mid-flight (create_block).',
          ]
        : []),
    ].join('\n');
  });

  const lawText = Effect.fn('Orientation.law')(function* (
    input: { projectId?: number } = {},
  ): Effect.fn.Return<string, StoreFailure | GateRefusal> {
    return [LAW_START, yield* doctrineText(input.projectId), LAW_END].join('\n');
  });

  return { policyOf, graphOf, forest, prompted, promptOf, off, globalLaw, doctrineText, lawText, ownGraph, ruleReachOf };
});

export type LawReads = Effect.Success<ReturnType<typeof lawReads>>;
