import { Schema } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { GRAPH_ACT, graphInput } from './shared.js';

export type TreePlace = { readonly project: string; readonly root: string | null };

const treeLabel = (place: TreePlace): string => `project “${place.project}”${place.root === null ? '' : ` at ${place.root}`}`;

export const TREE_OPERATIONS = {
  sync_graph: operation('sync_graph', {
    ...GRAPH_ACT,
    identity: 'manual',
    deadline: 'pass-wait',
    meaning: 'Commit all graph block files on the current branch as Tagma, without taking other staged work.',
    grammar:
      'Returns the commit, contributing sessions and changed-file count; commit is null if already clean. Never merges, resolves or pushes. Use for manual graph commits or to commit before automatic sync.',
    input: graphInput({}),
    answer: arms({
      ok: {
        sync: Schema.Struct({ commit: Schema.NullOr(Schema.String), sessions: Schema.Array(Schema.String), files: Schema.Number }),
      },
    }),
    refusals: ['not-a-team-tree', 'commit-off', 'graph-commit', 'tree-mid-merge', 'no-branch', 'graph-required'],
    confirmation: (_input, prepared: TreePlace) => ({
      summary: `Commit the block tree of ${treeLabel(prepared)} now?`,
      consequence: 'One commit lands on that tree’s branch, carrying every block file it holds.',
    }),
    confirmLabel: 'Commit',
    presentation: { running: 'Committing the block tree', done: 'Committed the block tree' },
    subjects: () => [],
  }),

  rewrite_graph_files: operation('rewrite_graph_files', {
    ...GRAPH_ACT,
    deadline: 'pass-wait',
    meaning: 'Rewrite every block file of the project from the graph in the current file form, touching only the files whose bytes change.',
    grammar:
      'Driven only by a caller’s hand: nothing in the server calls it. No block changes; a second call answers written 0. The rewritten files stay uncommitted until the tree is committed, which `sync_graph` does.',
    input: graphInput({}),
    answer: arms({
      ok: {
        rewritten: Schema.Struct({ blocks: Schema.Number, written: Schema.Number, removed: Schema.Number }),
      },
    }),
    refusals: ['graph-required'],
    confirmation: (_input, prepared: TreePlace) => ({
      summary: `Rewrite the block files of ${treeLabel(prepared)} in the current form?`,
      consequence: 'Files whose bytes change are rewritten in the working tree; no block changes.',
    }),
    confirmLabel: 'Rewrite',
    presentation: { running: 'Rewriting the block files', done: 'Rewrote the block files' },
    subjects: () => [],
  }),
};
