import { spawnSync } from 'node:child_process';
import { plugin } from 'bun';
import { PRELOAD_ROOT, PRELOAD_TREE, treeLoad } from './loading.js';

const root = process.env[PRELOAD_ROOT];
const tree = process.env[PRELOAD_TREE];

if (root !== undefined && tree !== undefined) {
  const judged = treeLoad(root, tree, (args) => {
    const ran = spawnSync('git', ['-C', root, ...args], { maxBuffer: 1024 * 1024 * 1024 });
    if (ran.error !== undefined) throw new Error(`git could not run in ${root}: ${ran.error.message}`);
    return ran.status === 0 ? ran.stdout : null;
  });
  if (judged !== null)
    plugin({
      name: 'tagma-judged-tree',
      setup: (build) => {
        build.onLoad({ filter: judged.filter }, judged.load);
      },
    });
}
