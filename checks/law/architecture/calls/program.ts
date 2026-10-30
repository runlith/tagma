import { defineProgram, type Reading, type Side } from '@runlith/tagma/rules';
import { isManifest } from '../../declarations/corpus';
import { production } from '../snapshot';
import type { CallParams } from './params';
import { judgements } from './revision';

const root = process.cwd();

export default defineProgram<{ 'ask-calls': CallParams }>({
  'ask-calls': (input) => {
    const found = judgements(root, input.params, input.tree.commit);
    const reading = (side: Side): Reading => ({
      covered: 'reach',
      findings: (side.whole ? found.whole(side.commit) : found.at(side.commit)).findings,
    });
    const base = input.base;
    if (
      base !== null &&
      !input.tree.whole &&
      !base.whole &&
      ![...input.tree.paths, ...base.paths].some((path) => production(path) || isManifest(path))
    )
      found.save(input.tree.commit, found.at(base.commit));
    return base === null ? { tree: reading(input.tree) } : { tree: reading(input.tree), base: reading(base) };
  },
});
