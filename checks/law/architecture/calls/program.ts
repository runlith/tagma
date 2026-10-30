import { defineProgram } from '@runlith/tagma/rules';
import { snapshots } from '../snapshot';
import type { CallParams } from './params';
import { callReading } from './reading';

const snapshotOf = snapshots(process.cwd());

export default defineProgram<{ 'ask-calls': CallParams }>({
  'ask-calls': (input) => {
    const tree = callReading(snapshotOf(input.tree), input.tree, input.params);
    return input.base === null ? { tree } : { tree, base: callReading(snapshotOf(input.base), input.base, input.params) };
  },
});
