import { it } from '@runlith/effect-test';
import { branchRefContract } from '../testing/refContract.js';
import { memoryBranchRefs } from '../testing/refs.js';

it.effect('the in-memory branch refs preserve names, publication and rename failures', () => {
  const path = '/repo';
  const commit = '1'.repeat(40);
  const base = '2'.repeat(40);
  const work = '3'.repeat(40);
  const tree = '4'.repeat(40);
  const squash = '5'.repeat(40);
  const refs = memoryBranchRefs(
    new Map([
      [
        path,
        {
          head: { ref: 'refs/heads/topic', commit },
          refs: new Map([
            ['refs/heads/topic', commit],
            ['refs/heads/tracked', commit],
            ['refs/heads/taken', squash],
            ['refs/heads/occupied/child', commit],
            ['refs/remotes/origin/topic', commit],
          ]),
          tracking: new Set(['tracked']),
          facts: {
            objects: new Set([base, work, commit, squash]),
            changes: new Map([
              [`${base}|${commit}`, ['.tagma/note.md', 'work.txt']],
              [`${commit}|${tree}`, []],
              [`${commit}|${squash}`, []],
              [`${squash}|${tree}`, []],
            ]),
            history: new Map([
              [
                `${base}|${commit}`,
                [
                  { sha: commit, subject: 'tagma: graph @ 7 (amber-fox)' },
                  { sha: work, subject: 'user work' },
                ],
              ],
            ]),
          },
        },
      ],
    ]),
  );
  return branchRefContract({ refs, path, commit, base, work, tree, squash, merged: tree });
});
