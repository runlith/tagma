import { defineProgram, type Side } from '@runlith/tagma/rules';
import type { CallParams } from './params';
import { judgements } from './revision';

const root = process.cwd();

export default defineProgram<{ 'ask-calls': CallParams }>({
  'ask-calls': (input) => {
    const found = judgements(root, input.params, input.tree.commit);
    const { tree, base } = input;
    if (tree.whole || base === null || base.whole)
      return {
        tree: { covered: 'reach', findings: found.whole(tree.commit) },
        base: base === null ? undefined : { covered: 'reach', findings: found.whole(base.commit) },
      };
    const answer = found.affected(base.commit, tree.commit);
    const covered = (side: Side): readonly string[] => [...new Set([...answer.paths, ...side.paths])];
    return {
      tree: { covered: covered(tree), findings: answer.tree },
      base: { covered: covered(base), findings: answer.base },
    };
  },
});
