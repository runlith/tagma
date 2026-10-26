import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { memoryMerges } from '../testing/memoryMerges.js';
import { verifyMergeGit } from '../testing/mergeConformance.js';
import { verifyMergeJournal } from '../testing/journalConformance.js';
import { memoryMergeJournal } from '../testing/memoryJournal.js';

it.effect('the memory merge repository preserves publication, checkout and recovery semantics', () =>
  Effect.gen(function* () {
    yield* verifyMergeJournal({ projectId: 1, ...memoryMergeJournal() });
    const memory = memoryMerges();
    const base = memory.commit({ tree: memory.tree({ 'seed.txt': 'seed\n' }), parents: [], message: 'base', sign: false });
    const tree = memory.tree({ 'seed.txt': 'seed\n', 'feature.txt': 'feature\n' });
    const tip = memory.commit({ tree, parents: [base], message: 'feature', sign: false });
    memory.place('/main', 'refs/heads/main', base);
    memory.place('/side', 'refs/heads/side', tip);
    memory.replayed(base, tip, tip);
    const checkout = memory.checkouts.get('/main')!;
    yield* verifyMergeGit({
      git: memory.git,
      main: '/main',
      side: '/side',
      base,
      tip,
      tree,
      write: (path, text) =>
        Effect.sync(() => {
          checkout.files[path] = text;
        }),
      read: (path) => Effect.sync(() => checkout.files[path]!),
      stage: (path, text) =>
        Effect.sync(() => {
          checkout.index = { ...memory.trees.get(memory.commits.get(memory.refs.get('refs/heads/main')!)!.tree)!, [path]: text };
          checkout.files[path] = text;
          return memory.tree(checkout.index);
        }),
      interrupt: (sequenced) =>
        Effect.sync(() => {
          checkout.operation = sequenced ? 'rebase' : 'merge';
          checkout.interruption = { ref: 'refs/heads/main', roots: ['side-root'] };
        }),
    });
  }),
);
