import { Sources } from '../contract/service/sources.js';
import type { BlockRecord } from '../contract/service/acts.js';
import { Effect } from 'effect';
import { syncGraph } from '../tree/commits.js';
import { TreeCommits } from '../tree/commits.js';
import { TREE_OPERATIONS, type TreePlace } from '../contract/wire/operations/tree.js';
import { pairsOf, routed, routesOf } from '../../platform/contract/service/routed.js';
import { READ_OPERATIONS } from '../contract/wire/operations/reads.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Tags } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { graphCommit } from '../settings.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import { CurrentGraph, GraphCall, ServedTree, VocabularyFormat } from '../contract/service/serving.js';
import { writableAt } from '../serving/writing.js';
import { TreeGuard } from '../contract/service/acts.js';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { projectToTree } from '../tree/projection.js';
import { refused } from '../serving/refusal.js';
import { served } from './served.js';

const treePlace = Effect.gen(function* () {
  const call = yield* yield* GraphCall;
  const tree = yield* ServedTree;
  return { project: call.project.name, root: tree?.treeRoot ?? null } satisfies TreePlace;
});

type Rewritten = { readonly blocks: number; readonly written: number; readonly removed: number };

const TREE_ROUTED = {
  sync_graph: routed(TREE_OPERATIONS.sync_graph, {
    prepare: () => treePlace,
    execute: Effect.fnUntraced(function* () {
      const call = yield* yield* GraphCall;
      const settings = yield* Settings;
      yield* writableAt(yield* CurrentGraph);
      const report = yield* syncGraph({
        commits: yield* TreeCommits,
        policy: Effect.map(settings.read(graphCommit, call.project.id), (resolved) => resolved.value),
      });
      return { status: 'ok' as const, sync: report };
    }),
    answer: (synced: {
      readonly status: 'ok';
      readonly sync: { readonly commit: string | null; readonly sessions: readonly string[]; readonly files: number };
    }) => synced,
    settle: () => Effect.succeed({ status: 'unknown' as const, current: null }),
  }),
  rewrite_graph_files: routed<
    typeof TREE_OPERATIONS.rewrite_graph_files,
    Rewritten,
    TreePlace,
    GraphCall | GraphStore | Tags,
    GateRefusal<OpenRefusal | 'graph-required'>
  >(TREE_OPERATIONS.rewrite_graph_files, {
    prepare: () => treePlace,
    execute: Effect.fnUntraced(function* () {
      const graph = yield* served;
      yield* writableAt(graph);
      const tree = yield* ServedTree;
      const floor = yield* TreeGuard;
      if (tree === null || floor === undefined) {
        return yield* new GateRefusal('not-served', 'this graph stands over no served tree', [
          'run the operation against the tagma server, which serves the tree',
        ]);
      }
      yield* graph.settled(true);
      const format = yield* VocabularyFormat;
      if (format !== null) yield* format.writable;
      const standing = yield* refused(tree.conflicts());
      if (standing.length > 0) {
        return yield* new GateRefusal('tree-mid-merge', `the tree stands mid-merge with ${standing.length} unmerged path(s)`, [
          'conclude the merge in the tree, then rewrite the files',
        ]);
      }
      const projected = yield* floor.guard(refused(projectToTree({ projectId: graph.projectId, treeRoot: tree.treeRoot })));
      return { blocks: projected.blocks, written: projected.written, removed: projected.removed };
    }),
    answer: (rewritten: Rewritten) => ({
      status: 'ok' as const,
      rewritten,
    }),
  }),
};

export const TREE_PAIRS = pairsOf(TREE_ROUTED);
export const TREE_ROUTES = routesOf(TREE_ROUTED);

const READS = READ_OPERATIONS;

const OWNER_ROUTED = {
  read_owners: routed(READS.read_owners, {
    execute: Effect.fnUntraced(function* (input: (typeof READS.read_owners)['input']['Type']) {
      const call = yield* yield* GraphCall;
      const owners = yield* (yield* Sources).ownersOf(call.project.id, input.path);
      const table = yield* (yield* Tags).of(call.project.id);
      return {
        owners,
        overview:
          owners.length === 0
            ? `nothing owns ${input.path}`
            : owners.map((owner) => `${blockName(owner.uuid)} [${tagLabel(table.tagOf(owner))}] ${owner.title}`).join('\n'),
      };
    }),
    answer: (reading: { readonly owners: readonly BlockRecord[]; readonly overview: string }) => ({
      status: 'ok' as const,
      overview: reading.overview,
    }),
  }),
};

export const OWNER_PAIRS = pairsOf(OWNER_ROUTED);
export const OWNER_ROUTES = routesOf(OWNER_ROUTED);
