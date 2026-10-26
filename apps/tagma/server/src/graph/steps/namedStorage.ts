import { join } from 'node:path';
import { graphsHome, mirrorFile, mirrorsHome, stealthTreeName } from '../storage/layout.js';

export type NamedStorage = {
  readonly graph: string;
  readonly mirror: string;
  readonly gitDir: string;
  readonly treeRoot: (worktree: string) => string;
  readonly mirrorOf: (treeRoot: string) => string;
};

export const namedStorage = (appHome: string, name: string): NamedStorage => {
  const graph = join(graphsHome(appHome), name);
  const mirror = join(mirrorsHome(appHome), name);
  return {
    graph,
    mirror,
    gitDir: join(graph, 'graph.git'),
    treeRoot: (worktree) => join(graph, 'trees', stealthTreeName(worktree)),
    mirrorOf: (treeRoot) => mirrorFile(mirror, treeRoot),
  };
};
